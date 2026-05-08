# Exploration: inbox-redesign-cycle-c

> Phase: sdd-explore · Date: 2026-05-02
> Covers KAN-27 (Current cycle rail card), KAN-28 (Dep graph + Plan next cycle quick actions), KAN-29 (Mentions section).

---

## 1. Design Intent (what the bundle says)

### Inbox layout

The design (`view-inbox.jsx`) is a two-column flex layout:
- **Left column** (`flex: 1`, scrollable): header strip → stat strip (4 counts) → sections (MCP proposals, Assigned to you, Mentions).
- **Right rail** (`width: 320`, fixed): 3 `RailCard` components stacked vertically.

### Right rail composition

| Card | Current code | Design |
|------|--------------|--------|
| Current cycle | **MISSING** | Present — first card |
| Active agents | Present | Present — second card |
| Quick actions | Present (3 items) | Present — third card (4 items) |

### Current cycle card (KAN-27)

Visual layout:
```
Current cycle   [Cycle 14 · Apr 21 – May 4]
────────────────────────────────────────────
[sparkline — SVG area chart, 280×36, accent fill]
62%     3.4d      +2
Done  Avg lead  Velocity
```

- **Sparkline**: inline SVG (`280×36` viewBox), monotone area path from a `pts` array. The pts represent daily Done% values (ascending, so it reads as a burnup progress curve). Stroke: `var(--accent)`, fill: `var(--accent-2)`.
- **Mini stats row**: 3 `Mini` components with flex-1 each — `Done %`, `Avg lead` (days), `Velocity` (delta points, colored `var(--ok)` when positive).
- Subtitle shows `cyclaName · startDate – endDate`.

### Quick actions (KAN-28)

Design has 4 rows (current code has 3):
1. New issue — kbd `C` (already present)
2. Ask Kanon — kbd `⌘J` (already present)
3. **Open dependency graph** — `Icon.Graph`, `onClick={() => setView("graph")}` → navigates to `/dependencies/$projectKey`
4. **Plan next cycle** — `Icon.Road`, `ai` flag → accent `var(--ai)`, no kbd → either opens dialog or MCP tool call

### Mentions section (KAN-29)

Design renders mentions as `InboxRow` components inside the existing `Section`. Each row carries a `mention` prop — the text is a verbatim quote of the @-mention context (`"@ines proposed dependency"`).

User confirmed: mentions are **user-to-user** (`@username`). Clicking a mention row navigates to the issue detail view (`/issue/$key`). The existing issue detail already has a 380px right sidebar for Properties + AgentThread — this sidebar serves the "context preview" described by the user. No new sidebar column is needed on the issue page itself.

Navigation target from Inbox mention row → `/issue/$key?from=inbox` (same pattern as InboxRow for assigned issues).

---

## 2. Current State (what we have)

### Inbox file map

| File | Renders | Notes |
|------|---------|-------|
| `packages/web/src/features/inbox/inbox-view.tsx` | Full Inbox layout | Right rail has 2 cards (agents + quick actions); Mentions = static placeholder |
| `packages/web/src/features/inbox/proposal-row.tsx` | MCP proposal card | Complete |
| `packages/web/src/features/inbox/use-dashboard-query.ts` | TanStack Query hooks | `DashboardData.mentions` typed as `unknown[]`, returns `[]` from API |
| `packages/web/src/features/inbox/use-dashboard-query.test.tsx` | Mutation invalidation tests | Comprehensive, covers all 3 ProposalContext variants |

### Dashboard API endpoint

`GET /api/workspaces/:id/dashboard` (`packages/api/src/modules/dashboard/routes.ts`) returns:
- `counts`: openIssues, inProgress, awaitingReview, activeAgents
- `assigned`: array of Issue
- `mentions`: hardcoded `[]` — placeholder
- `proposals`: McpProposal[]
- `agents`: WorkSession[]

**Missing from response**: active cycle data (name, dates, Done %, velocity), mention events.

### Existing cycle KPI math

Full cycle detail machinery already exists in `packages/api/src/modules/cycle/service.ts`:
- `getCycle(id)` returns `{ completed, scope, velocity, dayIndex, days, scopeAdded, scopeRemoved, burnup, scopeLine, risks }`.
- `burnup[]` is a per-day cumulative completed-points array — this is the sparkline data source.
- Done % = `Math.round((completed / scope) * 100)` (used in `CycleStatStrip`).
- Velocity = `sumPoints(issues where state === "done")` — stored on the cycle after close.
- **Lead time**: NOT computed anywhere in the codebase today. The design shows `3.4d Avg lead`. No `leadTime` column in Prisma Issue, no work-session duration aggregation for "cycle lead time". This is a **new computation** (time from issue creation or todo → done, within the cycle).

Frontend `useCycleQuery(cycleId)` → `GET /api/cycles/:id` returns `CycleDetail` (fully typed). The Cycles view already renders a burnup chart and stat strip using this data. No equivalent "active cycle for workspace" endpoint exists — the Cycles view requires a `projectKey`.

### Issue detail page

`packages/web/src/routes/_authenticated/issue.tsx`:
- Layout: `grid-template-columns: 1fr 380px` — main pane left, right pane right.
- Right pane = "Properties" (MetadataSection) + "Agent thread" (AgentThread) — always rendered.
- Already supports `?from=inbox` search param for back navigation.
- **No dedicated "mention context" panel** exists or is needed per user: the existing right sidebar IS the context preview.

### Dependency graph

Route `/dependencies/$projectKey` exists (`packages/web/src/routes/_authenticated/dependencies.tsx`). Renders `GraphView` with roadmap items. Navigation from Inbox quick action can call:
```ts
navigate({ to: "/dependencies/$projectKey", params: { projectKey } })
```
The Inbox view doesn't currently have access to `projectKey` — it is workspace-scoped. This requires a decision (see §4 and §5).

### Query key factories

`cycleKeys.list(projectKey)` and `cycleKeys.detail(cycleId)` exist in `lib/query-keys.ts`. A new `dashboardKeys.cycle(workspaceId)` key will be needed if we add active cycle to the dashboard response, or we reuse `cycleKeys.detail(activeCycleId)` from a separate query.

### Mention parsing

No `@username` parsing logic exists anywhere in `packages/web`. The `InboxRow` design merely renders a `mention` string prop — the actual detection and storage of mentions is the backend concern. No `Mention` model in Prisma. `mentions: []` is hardcoded in the dashboard route.

### Analytics data hooks

`packages/web/src/features/roadmap/analytics/use-analytics-data.ts` provides `useEffortImpactData`, `useHorizonData`, `useStatusData`, `usePromotionData`, `useAgingData` — all computed from `RoadmapItem[]`. None are cycle-oriented. The `AnalyticsKPIStrip` computes roadmap-level KPIs. These hooks are **not reusable** for cycle KPIs, which come from a different data source (`CycleDetail`).

---

## 3. Gaps

### KAN-27 — Current cycle rail card

**Frontend gaps:**
- `CurrentCycleCard` component (sparkline + 3 mini KPIs) — new component.
- `useActiveCycleForInbox` hook — resolves active cycle for the workspace (needs either API extension or a two-step query: projects list → active cycle per project).
- Sparkline subcomponent (inline SVG) — new, reuse the `Sparkline` pattern from the design.
- Lead time computation: **not implemented anywhere**. Either compute server-side and add to the dashboard/cycle response, or compute client-side from activity logs (not currently returned by dashboard).

**Backend gaps:**
- `GET /api/workspaces/:id/dashboard` must include active cycle data: `activeCycle?: { id, name, startDate, endDate, completed, scope, velocity, burnup }`.
- OR: add `GET /api/workspaces/:id/active-cycle` as a separate endpoint.
- Lead time: add server-side computation — iterate cycle issues, find `state_changed → done` activity log, diff against issue `createdAt` or cycle `startDate`, average across done issues. Requires querying `activityLogs` for each done issue in the cycle (this pattern already exists in `computeBurnup`).

**Shared gaps:**
- `DashboardData` interface in `use-dashboard-query.ts` needs `activeCycle` field with `CycleKPIs` shape.
- Possibly a new Zod type in `@kanon/bridge` for `ActiveCycleKPIs`.

**MCP gaps:** None for KAN-27.

---

### KAN-28 — Quick actions (dep graph + plan next cycle)

**Frontend gaps:**
- "Open dependency graph" `QuickRow` — needs `projectKey` in Inbox context. Inbox is workspace-scoped; no current project is tracked at workspace level. Two options (see §4).
- "Plan next cycle" `QuickRow` — action is undefined. Options: open a dialog, navigate to `/cycles/$projectKey`, or trigger MCP tool call (see §4).
- Icon: `Icon.Graph` and `Icon.Road` — verify these exist in `packages/web/src/components/ui/icons.tsx`.

**Backend gaps:** None for dep graph navigation. For "Plan next cycle" MCP path: no new endpoint needed (existing `POST /api/projects/:key/cycles` is sufficient).

**Shared gaps:** None.

**MCP gaps (if "Plan next cycle" triggers MCP):** `kanon_create_cycle` already exists. The action would open the command palette in AI mode or send a pre-prompted MCP call. No new MCP tool needed.

---

### KAN-29 — Mentions section

**Frontend gaps:**
- `MentionRow` component (extends or wraps `InboxRow`) — renders `@username mention-text`, navigates to `/issue/$key?from=inbox`.
- `@username` parser — regex `/@(\w+)/g` scan on Issue `description` and `Comment.body`. Decision: parse on read (client) vs denormalized (backend).
- `useMentionsQuery` or extend `DashboardData.mentions` with a real type.

**Backend gaps:**
- Mention detection logic — either in the dashboard route (parse descriptions/comments on every request) or as a stored table.
- No `Mention` model in Prisma. A new model is required for the stored approach.
- Dashboard route must return `mentions: Mention[]` instead of `[]`.

**Shared gaps:**
- `Mention` type: `{ issueKey: string; issueTitle: string; mentionedByUsername: string; context: string; createdAt: string }`.

**MCP gaps:** None.

---

## 4. Approach Options

### A. Mention storage: parse-on-read vs denormalized table

**Option A1 — Parse on read (client-side)**
- Fetch recent comments/descriptions for assigned or watched issues; regex-scan on the frontend.
- Pros: no migration, zero schema change, immediate to implement.
- Cons: expensive per request (N issues × M comments), inconsistent ordering, hard to persist "read" state, scales poorly.
- Effort: Low (implementation) / High (future pain).

**Option A2 — Denormalized `Mention` table (backend, on write)**
- Add `model Mention { id, workspaceId, issueKey, mentionedMemberId, mentionedByMemberId, context String, createdAt, read Boolean }`.
- Parse @-mentions when Comment or Issue description is saved; upsert Mention rows.
- Dashboard route queries `Mention where mentionedMemberId = currentMember, read = false`.
- Pros: fast reads, sortable, supports "mark as read", clean type, SSE-friendly.
- Cons: requires Prisma migration, parsing logic in Issue/Comment service.
- Effort: Medium.

**Recommendation: A2.** The parse-on-read approach doesn't survive real usage. The Mention table is the right foundation — it enables unread counts, SSE push, and "mark all read" in future cycles. Migration cost is small (one new model, one trigger point on Comment.create + Issue.update).

---

### B. Right sidebar on issue view (KAN-29 navigation target)

**Option B1 — Use existing right pane as-is**
- The issue detail page already has a 380px right sidebar (Properties + AgentThread).
- Clicking a mention navigates to `/issue/$key?from=inbox`. The user sees the issue with the existing right pane — this IS the context preview.
- No code change to the issue route required.
- Pros: zero effort, consistent with current behavior.
- Cons: the right pane is always "Properties + Agent thread", not mention-specific context. User may expect to see the specific @mention highlighted.

**Option B2 — Add `?highlight=mention&at=<commentId>` URL param**
- Extend `issueRoute.validateSearch` to accept `highlight` and `at` params.
- When `highlight=mention`, auto-scroll to and highlight the relevant comment/description snippet.
- Pros: better UX — user lands on the exact context of the mention.
- Cons: requires extending route search schema, adding scroll-to logic in `IssueDetailPage`, and knowing the comment ID at link-generation time.
- Effort: Medium.

**Recommendation: B1 for Cycle C** — keeps scope tight. B2 is a natural KAN-30 follow-up. The user's statement ("todo eso está contemplado en el design") refers to the right sidebar layout, which already exists. Add it as a post-cycle item.

---

### C. Current cycle KPIs: extend dashboard endpoint vs new endpoint

**Option C1 — Extend `GET /api/workspaces/:id/dashboard`**
- Add `activeCycle` key to the dashboard response. Server resolves the active cycle across all workspace projects and computes KPIs inline.
- Pros: single round-trip for Inbox, no new endpoint, cache key is `dashboardKeys.detail(workspaceId)` (already used).
- Cons: dashboard handler grows; workspace may have multiple active cycles (one per project) — need a resolution strategy (e.g., "most recently started active cycle").
- Effort: Low.

**Option C2 — New `GET /api/workspaces/:id/active-cycle` endpoint**
- Dedicated endpoint for active cycle KPIs. Frontend calls it separately.
- Pros: separation of concerns, easy to cache independently.
- Cons: extra round-trip, new route, new query key.
- Effort: Medium.

**Recommendation: C1.** Keep the Inbox to a single fetch. If multiple active cycles exist, return the one with the most recent `startDate`. The dashboard handler already has workspace-scoped project resolution. KPI shape: `{ id, name, startDate, endDate, completed, scope, donePct, velocity, avgLeadDays, burnup }`.

---

### D. "Plan next cycle" action

**Option D1 — Navigate to `/cycles/$projectKey`**
- Opens the Cycles view for the user to manually create a cycle.
- Pros: zero new code, uses existing UI.
- Cons: requires knowing `projectKey` (same problem as dep graph); feels like it "drops" the user into a different context rather than assisting them.
- Effort: Low.

**Option D2 — Open command palette in AI mode**
- Calls `openPalette("ai")` with a pre-seeded prompt like `"Plan next cycle"`.
- Pros: AI-native, uses existing palette infrastructure, no projectKey needed.
- Cons: requires palette to handle pre-seeded prompts (may not exist).
- Effort: Low-Medium.

**Option D3 — MCP tool trigger (background)**
- Calls `kanon_create_cycle` via a button that shows a confirmation dialog.
- Pros: most automated, fits Kanon's AI-native philosophy.
- Cons: needs projectKey, dialog UX to confirm dates/name, more complex.
- Effort: High.

**Recommendation: D2 for Cycle C** — opens palette in AI mode with pre-seeded text. It requires no projectKey, fits the AI-native brand, and is low-risk. D3 is the right long-term vision but scoped to a future cycle.

---

### E. "Open dependency graph" — projectKey resolution

**Problem:** The Inbox is workspace-scoped (`/inbox`), but the dependency graph route is `/dependencies/$projectKey`. The Inbox has no `projectKey` in context.

**Option E1 — Navigate to the first/default project's graph**
- Resolve the workspace's projects list (already available via `useProjectsQuery`) and navigate to the first project's dep graph.
- Pros: simple.
- Cons: arbitrary if multiple projects exist; feels wrong.

**Option E2 — Show a project picker modal**
- Quick popover listing workspace projects; user picks one.
- Pros: correct for multi-project workspaces.
- Cons: extra UI; adds friction to what should be a quick action.

**Option E3 — Navigate to a workspace-level dependency graph**
- Add route `/dependencies` (without projectKey) that aggregates all roadmap items across workspace.
- Pros: most correct, scales.
- Cons: requires new route and new query.

**Recommendation: E2 for Cycle C** — a lightweight project picker popover on the quick action button. If the workspace has exactly one project, skip the picker. This is the correct UX without over-engineering a new route. Keep it: `<ProjectPickerPopover onSelect={(key) => navigate(...)} />`.

---

## 5. Risks & Open Questions

- **Lead time computation**: Zero precedent in the codebase. Requires scanning `activityLogs` per issue. If issues have no `state_changed → done` event (e.g., imported or manually set), lead time will be null. Need to define fallback (omit from avg, or use cycle start as proxy). **Decision needed before spec.**
- **Multi-project active cycle**: If the workspace has multiple active cycles (one per project), which one does the rail card show? Need a resolution rule. **Decision needed.**
- **Prisma migration for Mention table**: Any migration requires coordinating with API deployment. Low risk (additive), but must be flagged.
- **Icons availability**: `Icon.Graph` and `Icon.Road` — not verified in `packages/web/src/components/ui/icons.tsx`. Must check before apply phase.
- **`from=inbox` nav param on mention click**: Issue route already handles `from` — but does the back button navigate back to inbox correctly when coming from a mention? Should verify the `handleBack` logic in `issue.tsx` covers this. Currently `from === "board"` is the only handled case; everything else falls through to `window.history.back()`, which will work.
- **Dashboard response growth**: Adding `activeCycle` to the dashboard response increases payload and query complexity. If the cycle query is slow (due to `activityLogs` join for lead time), consider making lead time a separate async enrichment or approximating it (e.g., `cycle.days * donePct` as a proxy).
- **`mentions: unknown[]` type in `DashboardData`**: Must be properly typed in `use-dashboard-query.ts` before the mentions section can be rendered correctly. This is a shared type change.

---

## 6. Recommended Scope Split

The three issues are largely independent but share a backend dependency:

```
KAN-27 (cycle card)  ─── extends dashboard endpoint ───┐
KAN-28 (quick actions)  ── no backend ────────────────┤
KAN-29 (mentions)  ──── adds Mention model ────────────┘
```

**Recommended order (single phase, sequential subtasks):**

1. **KAN-29 backend first**: Add Mention Prisma model (migration) + parse-on-write logic in Comment/Issue service + dashboard mentions response. This unblocks the frontend for KAN-29.
2. **KAN-27 backend**: Extend dashboard endpoint with `activeCycle` (including lead time computation from activityLogs). Reuses existing `getCycle` logic.
3. **KAN-27 frontend**: `CurrentCycleCard` + `Sparkline` + `useActiveCycleForInbox`.
4. **KAN-28 frontend**: Two new `QuickRow` items + `ProjectPickerPopover` + palette AI mode pre-seed.
5. **KAN-29 frontend**: `MentionRow` component + wire `DashboardData.mentions` array to render.

No sub-phase split is needed. The three issues CAN ship as one change since the backend migration is additive. However, if the Mention migration is a concern, it can be shipped as a standalone PR first.

---

## Affected Files

### New files (frontend)
- `packages/web/src/features/inbox/current-cycle-card.tsx` — KAN-27 rail card component
- `packages/web/src/features/inbox/mention-row.tsx` — KAN-29 mention row (or extend InboxRow)
- `packages/web/src/features/inbox/project-picker-popover.tsx` — KAN-28 project picker
- `packages/web/src/features/inbox/__tests__/current-cycle-card.test.tsx`
- `packages/web/src/features/inbox/__tests__/mention-row.test.tsx`

### Modified files (frontend)
- `packages/web/src/features/inbox/inbox-view.tsx` — add CurrentCycleCard to rail, MentionRow to section, 2 new QuickRows
- `packages/web/src/features/inbox/use-dashboard-query.ts` — add `activeCycle`, type `mentions`
- `packages/web/src/lib/query-keys.ts` — possibly add `dashboardKeys.activeCycle` (TBD by approach chosen)

### New files (backend)
- `packages/api/prisma/migrations/*_add_mention.sql` — Mention model migration

### Modified files (backend)
- `packages/api/prisma/schema.prisma` — add `model Mention`
- `packages/api/src/modules/dashboard/routes.ts` — extend response with `activeCycle` + `mentions`
- `packages/api/src/modules/comment/service.ts` (or issue service) — @mention parse-on-write
- `packages/api/src/modules/cycle/service.ts` — add `avgLeadDays` computation helper

### Shared types
- `packages/web/src/types/cycle.ts` — add `ActiveCycleKPIs` interface (or extend `Cycle`)
- `packages/bridge/src/types.ts` — add `Mention` Zod schema + `ActiveCycleKPIs` Zod schema

---

## Open Decisions Required Before Proposal

1. **Lead time definition**: time from issue `createdAt` → `done`, or time from cycle `startDate` → `done`, averaged across done issues in the cycle?
2. **Multi-project active cycle**: if workspace has multiple active cycles, show the most recent? Show all? Show from the "primary" project?
3. **"Plan next cycle" action**: palette AI mode (D2, recommended) or navigate to cycles view (D1)?
4. **Mention model**: go with A2 (stored table, recommended) or defer to parse-on-read for Cycle C?
