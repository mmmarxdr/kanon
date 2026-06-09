# Design: KAN-32 — Unified Issue Timeline

## Status: draft — Date: 2026-06-09

## Approach
Client-side merge (Approach A). Two existing queries (`useCommentsQuery`, `useActivityQuery`) feed a new `useUnifiedTimeline(issueKey)` hook that maps + merges their cached rows into `TimelineItem[]`, ordered `createdAt` ASC. A new `UnifiedTimeline` component renders the feed and replaces the Activity + Comments tabs in `IssuePage`. One API edit: activity serializer exposes `via`.

---

## Verified facts (drove the corrections below)
- **Comment AI sources** (`agent-thread.tsx:11`): `AGENT_SOURCES = {mcp, engram_sync, system, adr}`. `CommentSource = "human" | "mcp" | "engram_sync" | "system" | "adr"` (`types/issue.ts:85`). Comment is **agent** iff `source ∈ AGENT_SOURCES`, else **human**.
- **Real ActivityLog `action` values** (grep of `createActivityLog` call sites): `state_changed`, `created`, `assigned`, `edited`, `delete`, `commented`, `document_added`. **There is NO `sync` action.** (Spec's `sync` kind is dropped — see correction 1.)
- **`commented` activity rows are SHADOW entries**: `comment/service.ts:56` writes an activity row `action:"commented", details:{commentId, source}` for every comment. The real comment body comes from the comments endpoint. → these rows MUST be filtered out of the merge to avoid duplication (correction 2).
- **IDs** are UUID strings (`@db.Uuid`) on both `Comment` and `ActivityLog` → tiebreak = lexicographic string compare on `id`.
- **`via` scalar** exists on both Prisma models (`Comment.via String?`, `ActivityLog.via String?`) → no Prisma `select` excludes it; serializer can read `log.via` directly.
- **Icons**: web uses a custom module `@/components/ui/icons` (`Icon.Spark`, etc.) with CSS var `var(--ai)`. No external icon lib (no lucide/radix). No standalone `Badge` component exists.

---

## Corrections to the spec (spec was written before action values were verified)
1. **No `sync` kind.** Provenance ("synced via a tool") is carried by the `via` badge on ANY item, not by a distinct timeline kind. Remove `sync` from the union.
2. **Drop `commented` activity rows in the merge.** The canonical comment comes from the comments query; the `commented` activity row is a shadow audit entry. Including both = duplicate feed items. The hook filters `action === "commented"` out of the activity stream.
3. **Union kinds aligned to real actions**: `state-change` (state_changed), `created`, `assigned`, `field-change` (edited — generic), `deleted` (delete), `document-added` (document_added), plus `human-comment` / `agent-comment` from the comments stream.

These corrections are reflected here and must override the spec's union table during apply. The spec's via-badge rules (REQ-VB-*), ordering (REQ-TL-02/03), composer (REQ-CM-*), and non-goals stand unchanged.

---

## TimelineItem union (authoritative)
```typescript
// packages/web/src/features/issue-detail/timeline-types.ts
type Actor = { id: string; username: string } | null;

type TimelineBase = { id: string; via: string | null; createdAt: string };

export type TimelineItem =
  | (TimelineBase & { kind: "human-comment"; body: string; author: Actor })
  | (TimelineBase & { kind: "agent-comment"; body: string; source: CommentSource; author: Actor })
  | (TimelineBase & { kind: "state-change"; from: string | null; to: string | null; actor: Actor })
  | (TimelineBase & { kind: "created"; actor: Actor })
  | (TimelineBase & { kind: "assigned"; field: string | null; newValue: string | null; actor: Actor })
  | (TimelineBase & { kind: "field-change"; field: string | null; from: string | null; to: string | null; actor: Actor })
  | (TimelineBase & { kind: "deleted"; actor: Actor })
  | (TimelineBase & { kind: "document-added"; field: string | null; actor: Actor });
```

### Mapping
**Comment → item** (`source ∈ AGENT_SOURCES ? "agent-comment" : "human-comment"`); carry `body`, `author`, `via`, `createdAt`, `id`.

**ActivityLog (SerializedActivityLog) → item** by `action`:
| action | kind | fields from SerializedActivityLog |
|---|---|---|
| `commented` | **(dropped)** | — filtered out before merge |
| `state_changed` | `state-change` | `from`=oldValue, `to`=newValue |
| `created` | `created` | — |
| `assigned` | `assigned` | `field`, `newValue` |
| `edited` | `field-change` | `field`, `from`=oldValue, `to`=newValue |
| `delete` | `deleted` | — |
| `document_added` | `document-added` | `field` |
| _any other_ | `field-change` | `field`, `from`, `to` (safe fallback) |

`actor` ← serialized `actor`; `via` ← serialized `via` (NEW field); `createdAt` ← `createdAt`.

---

## `useUnifiedTimeline(issueKey)` hook
```
File: packages/web/src/features/issue-detail/use-unified-timeline.ts
```
- Calls existing `useCommentsQuery(issueKey)` + `useActivityQuery(issueKey)` — reuses caches, NO new fetch.
- `items = useMemo(() => merge(comments, activity), [comments, activity])`:
  1. map comments → items
  2. filter activity to `action !== "commented"`, map → items
  3. concat, sort by `createdAt` ASC; tiebreak `a.id.localeCompare(b.id)`
- Returns `{ items, isLoading: comments.isLoading || activity.isLoading, isError: comments.isError || activity.isError }`.
- Export a pure `mergeTimeline(comments, activity)` function (testable without React).

---

## `UnifiedTimeline` + `ViaBadge`
```
File: packages/web/src/features/issue-detail/unified-timeline.tsx
File: packages/web/src/features/issue-detail/via-badge.tsx
```
- `UnifiedTimeline({ items, isLoading, isError })`: empty-state (no items), loading indicator, error state; renders each item via a per-kind row renderer; mounts `<ViaBadge via={item.via} />` on every row.
- **ViaBadge** — single source of truth for provenance display:
  ```typescript
  const VIA_LABELS: Record<string, string> = {
    "claude-code": "Claude Code", cursor: "Cursor",
    antigravity: "Antigravity", cli: "CLI",
  };
  // render null when via == null || via === "web" || !(via in VIA_LABELS)
  ```
  Cobalt treatment via a CSS class (e.g. `.via-badge { color: oklch(0.52 0.11 245); border-color: …}`) + `Icon.Spark` from `@/components/ui/icons`. Mirror the existing agent-thread badge markup (`className="mono"`, `Icon.Spark`) but with cobalt instead of `var(--ai)`.
- Row renderer: `switch (item.kind)` — comment kinds show author + body; activity kinds show a one-line descriptor (e.g. "changed state from X to Y"). Oldest-first.

---

## API change (only one)
```
File: packages/api/src/modules/activity/serializer.ts
```
- Add `via: string | null;` to `SerializedActivityLog` interface.
- Add `via: log.via ?? null,` to the `serializeActivityLog()` return.
- `RawActivityLog` must include `via` — verify the activity `findMany`/type carries the scalar (it does at the DB level; confirm the TS `RawActivityLog` type includes it, add if the type is hand-written).

---

## IssuePage integration
```
File: packages/web/src/routes/_authenticated/issue.tsx
```
- Replace the **Activity** + **Comments** tab panels with a single timeline panel rendering `<UnifiedTimeline {...useUnifiedTimeline(key)} />`. Collapse the two tabs into one (or make timeline the default/only conversational surface).
- **Keep** the bottom-bar composer; ensure its mutation invalidates BOTH comment + activity caches (already does per `use-issue-mutations.ts` — verify).
- **AgentThread right pane: UNTOUCHED** (non-goal; transitional duplication accepted).

### Removals
- `comment-list.tsx`: remove the embedded compose form (REQ-CM-02). If `CommentList` is no longer rendered anywhere after the tab collapse, delete it; otherwise keep it composer-free. Verify importers during apply.
- `tabs-section.tsx`: **delete** (no importers — verified).

### Web types
```
File: packages/web/src/types/issue.ts
```
- Add `via: string | null` to `Comment` and `ActivityLog`.

---

## Test strategy (strict TDD — write RED first)
Runner: `pnpm --filter @kanon/web test` (web), `cd packages/api && pnpm vitest run` (api). Pattern: vitest + @testing-library/react + user-event; mock api via `vi.mock("@/lib/api-client")`; existing examples under `packages/web/src/features/issue-detail/__tests__`.

**Unit — `mergeTimeline` (pure)** `use-unified-timeline.test.ts`:
1. interleaves comments + activity by createdAt ASC (Scenario 1)
2. **drops `commented` activity rows** (no duplicate with the comment) — correction 2
3. stable tiebreak: equal createdAt → lower id first (Scenario 9)
4. classifies comment source → human-comment vs agent-comment
5. maps each action → correct kind (state_changed→state-change, edited→field-change, unknown→field-change fallback)

**Unit — `ViaBadge`** `via-badge.test.tsx`:
6. via=claude-code → "Claude Code" cobalt badge (Scenario 2)
7. cursor/antigravity/cli → respective labels (Scenario 3)
8. via="web" → renders nothing (Scenario 4)
9. via=null → renders nothing (Scenario 5)
10. via="some-future-tool" → renders nothing (Scenario 14)

**Component — `UnifiedTimeline`** `unified-timeline.test.tsx`:
11. mixed feed renders all items oldest-first (Scenario 1)
12. empty state when no items (Scenario 7)
13. loading state (Scenario 8)

**API — serializer** `packages/api/src/modules/activity/__tests__/serializer.test.ts` (or existing):
14. via="cli" passed through (Scenario 10)
15. via=null passed through (Scenario 11)

**Integration (optional, if CommentList stays)**: exactly one composer in DOM (Scenario 12).

---

## File change list
| File | New/Mod | What |
|---|---|---|
| `web/.../timeline-types.ts` | NEW | TimelineItem union + Actor |
| `web/.../use-unified-timeline.ts` | NEW | hook + pure mergeTimeline |
| `web/.../unified-timeline.tsx` | NEW | feed component |
| `web/.../via-badge.tsx` | NEW | provenance badge + label map |
| `web/src/routes/_authenticated/issue.tsx` | MOD | collapse tabs → timeline; keep composer |
| `web/.../comment-list.tsx` | MOD/DEL | remove embedded composer; delete if unused |
| `web/.../tabs-section.tsx` | DEL | dead code |
| `web/src/types/issue.ts` | MOD | +via on Comment, ActivityLog |
| `api/.../activity/serializer.ts` | MOD | +via in interface + return |
| test files above | NEW | RED-first |

---

## Risks / tradeoffs / rollback
- **Dedup correctness**: dropping `commented` activity rows is the linchpin — if a future code path stops writing comments to the comments endpoint, those comments vanish. Low risk (comments endpoint is canonical).
- **AgentThread duplication** (transitional, accepted) — agent comments show in both feed and right pane until sidebar rework.
- **Ordering**: build fresh; do NOT reuse `ActivityList` (DESC).
- **UUID tiebreak** is stable but arbitrary (UUIDs not time-ordered) — acceptable; only matters for identical-timestamp ties.
- **Rollback**: pure-additive web components + one additive API field. Revert = restore tabs in `issue.tsx`, drop new files, revert serializer. No DB/migration.
