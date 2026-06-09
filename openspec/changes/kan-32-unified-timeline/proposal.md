# Proposal: KAN-32 — Unify issue timeline (comments + activity + synced events)

## Intent

The issue detail page splits conversation across separate tabs (Comments / Agent / Activity). The "Agent" view is just a source-filtered view of comments. This fragments a single conversation into three places and reinforces a mental model the product explicitly rejects: there is **no "Kanon agent"** — agent actions are the human's actions carried out *through* an AI tool, labeled `via [tool]` (the locked provenance decision from KAN-30).

Replace the split with ONE chronological timeline in the issue's main pane: human comments, state changes, creation, assignment, and every other activity entry interleaved by time. Items that originated through an AI tool carry a cobalt `via [tool]` badge. The comment composer stays pinned at the bottom; posting drops into the same feed. No nested replies — the timeline IS the thread.

## Approach

**Client-side merge (Approach A).** Keep the two existing endpoints (`GET /api/issues/:key/comments`, `GET /api/issues/:key/activity` — neither paginated). A new `useUnifiedTimeline(issueKey)` hook merges the two cached arrays into a `TimelineItem` discriminated union ordered by `createdAt` ASC (oldest first). A new `UnifiedTimeline` component renders the feed and replaces the Activity + Comments tabs in the main pane.

The only API change: the activity serializer currently drops the `via` column (KAN-30). Add `via` to `SerializedActivityLog` + the serialize return. The comment endpoint already serves `via` (raw `include`, route returns unmapped) — no comment API change.

### Decisions (from product question round)
1. **Order**: oldest-first (chat style), composer at bottom. Inverts the current `ActivityList` DESC ordering.
2. **What shows inline**: ALL activity kinds (comments, state changes, created, assigned, label/priority/estimate changes, sync) — full audit + conversation in one feed.
3. **`via` badge**: pretty display label + icon (`claude-code`→"Claude Code", `cursor`→"Cursor", `antigravity`→"Antigravity", `cli`→"CLI"). Shown only when `via ∈ {claude-code, cursor, antigravity, cli}`; `web` and `null` render no badge. Color: cobalt `oklch(0.52 0.11 245)`.
4. **Right pane / sidebar**: NOT restructured here. `AgentThread` stays in place. The sidebar rework (removing agent references entirely) has its own design and lands in a separate change/session.

## Scope

### In scope
- New `UnifiedTimeline` component (main pane) — interleaved, oldest-first, typed by kind.
- New `useUnifiedTimeline(issueKey)` hook — merges comments + activity from existing query caches into `TimelineItem[]`.
- `via` display mapping + cobalt badge component (token → label + icon).
- Activity serializer: add `via` to `SerializedActivityLog` and the serialize return (API).
- Web types: add `via` to `Comment` and `ActivityLog`; add the `TimelineItem` union.
- Replace the Activity + Comments tabs in `IssuePage` with the single timeline; remove the redundant embedded composer in `CommentList` (bottom-bar composer in `IssuePage` is the single source of truth).
- Delete dead `tabs-section.tsx` (verified: no importers).
- Tests (strict TDD): merge/order/badge logic + component render.

### Out of scope (non-goals)
- **Right pane / sidebar restructure** — removing `AgentThread` and all "agent" references. Separate design, separate session. `AgentThread` is left untouched (transitional: its agent comments also appear in the unified feed; accepted until the sidebar rework lands).
- Issue-level real-time SSE for comments/activity — refresh stays pull-based (mutation invalidation), consistent with current behavior. Known gap.
- Server-side combined `/timeline` endpoint (Approach B) and pagination — not needed; neither source paginates today.
- Comment edit/delete behavior changes — preserved as-is.
- Backfill of `via` on historical rows — null means pre-provenance (per KAN-30).

## First slice
Single PR. All web + the one activity-serializer API change land together (the timeline is non-functional without `via` in the activity response). Estimated medium size; if the diff exceeds the 400-line budget, split the API serializer fix + types as PR 1 and the timeline component + composer as PR 2.

## Risks
- **Ordering inversion**: current `ActivityList` is DESC; unified feed is ASC. Any component reused must not assume DESC.
- **Transitional duplication**: agent comments appear both in `AgentThread` (right pane, untouched) and the unified feed until the sidebar rework. Accepted, documented.
- **`via` on activity query**: `RawActivityLog`/the activity `findMany` must carry the `via` scalar for the serializer to read it — verify the query has no `select` excluding it (apply phase).
- **Strict TDD**: `useUnifiedTimeline` + `UnifiedTimeline` + badge mapping are new — tests first.
- Design mockup `view-issue.jsx` not in repo — build against acceptance criteria.

## Acceptance Criteria (from issue)
- One timeline replaces the Comments/Agent/Activity split in the main pane.
- Items typed by kind; sync/AI-tool items show the `via` badge (cobalt).
- Composer pinned at bottom; comment posts into the same timeline.
- No nested replies.
