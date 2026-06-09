# Exploration: KAN-32 — Unify Issue Timeline

## Goal

Replace the current split Comments / Agent / Activity tab layout on the issue detail page with a single chronological timeline that interleaves human comments, agent/sync events, and state-change entries. Each sync item is tagged with a `via [tool]` cobalt badge.

---

## Current Layout Map

| Layer | File | What exists today |
|---|---|---|
| Route / page | `packages/web/src/routes/_authenticated/issue.tsx` | `IssuePage` — multi-tab layout in main pane (Activity / Sub-issues / Dependencies / Comments / Design Records); default tab = Activity; persistent composer at bottom |
| Activity tab | `packages/web/src/features/issue-detail/activity-list.tsx` | `ActivityList` — renders `ActivityLog[]` sorted DESC by `createdAt` |
| Comments tab | `packages/web/src/features/issue-detail/comment-list.tsx` | `CommentList` — renders `Comment[]`; embedded compose form (redundant) |
| Right pane | `packages/web/src/features/issue-detail/agent-thread.tsx` | `AgentThread` — filters comments by agent sources, read-only |
| Possible dead code | `packages/web/src/features/issue-detail/tabs-section.tsx` | Old 3-tab (Comments / Agent / Activity) layout — VERIFY whether imported |
| Queries | `packages/web/src/features/issue-detail/use-issue-detail-queries.ts` | `useCommentsQuery` → `GET /api/issues/:key/comments`; `useActivityQuery` → `GET /api/issues/:key/activity` — fetched in parallel |
| Mutations | `packages/web/src/features/issue-detail/use-issue-mutations.ts` | `useAddCommentMutation` — invalidates comment + activity keys on success |
| Web types | `packages/web/src/types/issue.ts` | `Comment`/`ActivityLog` — no `via` field |

### Data Sources

| Feed | Endpoint | Order | Paginated |
|---|---|---|---|
| Comments | `GET /api/issues/:key/comments` | `createdAt ASC` | No |
| Activity | `GET /api/issues/:key/activity` | `createdAt DESC` | No |

No combined/interleaved feed endpoint exists today.

---

## Critical Finding: `via` serialization (VERIFIED — corrected)

The `via` column (KAN-30) exists on `ActivityLog` and `Comment` DB rows. Verified state:

- **Comment API ALREADY serves `via`**: `listComments()` (service.ts:270) uses `prisma.comment.findMany({ include: { author } })` with NO `select`, so all scalar columns (incl. `via`) return; `comment/routes.ts:53` returns the raw result unmapped. → **No API change needed for comments.** Only the web `Comment` type needs `via` added.
- **Activity serializer DROPS `via`** (CONFIRMED): `serializeActivityLog()` (serializer.ts:40-59) explicitly builds the return object and `SerializedActivityLog` (interface) has no `via`. → **API fix required**: add `via: string | null` to the interface + `via: log.via ?? null` to the return; ensure `RawActivityLog`/query carries `via` (scalar — present unless an explicit `select` excludes it; verify in apply).
- Web types (`Comment`, `ActivityLog`) lack `via` — both need it added.

So the only API change is the activity serializer.

`via` vocabulary (`packages/api/src/shared/via.ts`): `["claude-code", "cursor", "antigravity", "web", "cli"]`

Badge rule: show cobalt badge (oklch(0.52 0.11 245)) when `via ∈ {claude-code, cursor, antigravity, cli}` — NOT `"web"` and NOT `null`.

---

## Composer

Persistent textarea + Send pinned at the bottom of `IssuePage`'s main pane, outside the tab panel. Calls `useAddCommentMutation` → `POST /api/issues/:key/comments`. `CommentList`'s embedded compose form is redundant and must be removed; the bottom-bar composer is the single source of truth.

---

## SSE / Real-time

`IssuePage` has no SSE subscription today. Cache refresh is mutation-invalidation only (pull). KAN-40 added inbox SSE; no issue-level SSE for comments/activity. Real-time stays pull-based in Ola 2 (known gap).

---

## Test Setup

- Runner: vitest + `@testing-library/react` + `@testing-library/user-event`
- Pattern: export pure sub-components from route files, test in isolation; mock API via `vi.mock("@/lib/api-client")`
- Web test command: `pnpm --filter @kanon/web test`
- Strict TDD active — tests before implementation
- Design mockup `kanon/project/view-issue.jsx` NOT found in repo — reference AC directly

---

## Approaches

### Approach A — Client-side merge (RECOMMENDED)
Keep both endpoints. Add `via` to both responses (prerequisite). Add `useUnifiedTimeline(issueKey)` hook merging the two cached arrays by `createdAt` into a `TimelineItem` discriminated union. Replace the tab layout (Activity + Comments + AgentThread) with a single `UnifiedTimeline`.
- Pros: zero new API routes; minimal backend change (`via` only); both queries already parallel; `source` + `via` available client-side.
- Cons: two requests; pagination-instability in theory (neither endpoint paginated today).
- Effort: Low

### Approach B — New `/timeline` endpoint
`GET /api/issues/:key/timeline` queries both tables, sorts server-side, returns typed `TimelineItem[]`.
- Pros: single request; stable server ordering; future pagination.
- Cons: new route + service + serializer + tests; existing endpoints still needed by CLI/MCP.
- Effort: Medium

### Approach C — Extend activity endpoint with comment body
JOIN comment table for `commented` rows.
- Pros: reuses existing endpoint.
- Cons: `commented` row stores `{commentId, source}` only — body needs JOIN; agent markdown special-cased; leaky serializer.
- Effort: Medium-High

## Recommendation: Approach A — client-side merge
Neither endpoint paginated (no take/skip/cursor); zero new routes; merging is a `useMemo` over cached data; Approach C is architecturally leaky.

### TimelineItem kinds (proposed)
```
type TimelineItem =
  | { kind: "human-comment"; id; body; author; via; createdAt }
  | { kind: "agent-comment"; id; body; source; author; via; createdAt }
  | { kind: "state-change";  id; field?; from?; to?; actor; via; createdAt }
  | { kind: "created";       id; actor; via; createdAt }
  | { kind: "assigned";      id; field?; newValue?; actor; via; createdAt }
  | { kind: "sync";          id; action; actor; via; createdAt }
```
Ordering: sort unified array by `createdAt` ASC (oldest first, composer at bottom). Current `ActivityList` sorts DESC — must invert.

---

## Risks
- `via` absent from both serializers — prerequisite fix; no badge works without it.
- `TabsSection` possibly dead code — verify import before delete.
- `CommentList` embedded composer must be removed; bottom-bar composer is the only one.
- Right pane (`AgentThread`) purpose must be explicitly scoped once agent comments merge into the timeline (metadata-only or out of scope).
- No issue-level SSE — real-time stays pull-based.
- Strict TDD active — `UnifiedTimeline` + `useUnifiedTimeline` new → tests first.
- Design mockup not found — reference AC.

## Ready for Proposal: Yes. Recommend Approach A with `via` serializer fixes as a prerequisite task.
