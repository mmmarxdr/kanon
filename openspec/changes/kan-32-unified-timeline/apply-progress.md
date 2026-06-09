# Apply Progress: KAN-32 — Unified Issue Timeline

**Date**: 2026-06-09
**Mode**: Strict TDD
**Status**: All tasks complete — ready for sdd-verify
**Delivery**: single PR, size:exception granted

---

## Completed Tasks

- [x] A1 (RED) Serializer `via` passthrough test — 3 new test cases in `serializer.test.ts`
- [x] A2 (GREEN) `via: string | null` added to `RawActivityLog`, `SerializedActivityLog`, and `serializeActivityLog()` return
- [x] A3 `via: string | null` added to web `Comment` and `ActivityLog` types
- [x] B1 `timeline-types.ts` — `TimelineItem` union (8 kinds) + `Actor` — per design corrections (no sync kind)
- [x] B2 (RED) `use-unified-timeline.test.ts` — 18 tests covering all merge scenarios
- [x] B3 (GREEN) `use-unified-timeline.ts` — pure `mergeTimeline` + `useUnifiedTimeline` hook
- [x] C1 (RED) `via-badge.test.tsx` — 7 tests covering all via label / null / unknown scenarios
- [x] C2 (GREEN) `via-badge.tsx` — `VIA_LABELS` map, cobalt `oklch(0.52 0.11 245)`, `Icon.Spark`
- [x] D1 (RED) `unified-timeline.test.tsx` — 3 tests (mixed feed, empty state, loading state)
- [x] D2 (GREEN) `unified-timeline.tsx` — per-kind renderers, `ViaBadge` on every row, empty/loading/error states
- [x] E1 `issue.tsx` — Activity + Comments tabs collapsed into single "Timeline" tab wired to `useUnifiedTimeline`
- [x] E2 `use-issue-mutations.ts` — already invalidates both comment + activity caches; no change needed
- [x] E3 `comment-list.tsx` — deleted (no importers after issue.tsx refactor)
- [x] E4 `tabs-section.tsx` — deleted (verified no importers)
- [x] E5 N/A — CommentList deleted; single bottom-bar composer confirmed in `issue.tsx`
- [x] F1 Web: 83 files, 570 tests pass. API: all pass (exit 0)
- [x] F2 `tsc --noEmit` passes with no errors (fixed 3 test fixtures missing `via: null`)
- [x] F3 AgentThread untouched, no SSE, no `/timeline` endpoint, no migration

---

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|------|-----|-------|----------|
| A1/A2 — API serializer via | FAIL: `expected undefined to be 'cli'` (3 cases) | PASS: 3 new tests green, all existing pass | Type annotation cleanup |
| B2/B3 — mergeTimeline | FAIL: `Failed to resolve import` (module didn't exist) | PASS: 18 tests green | Non-null assertions for TS strict narrowing |
| C1/C2 — ViaBadge | FAIL: `Failed to resolve import` (module didn't exist) | PASS: 7 tests green | — |
| D1/D2 — UnifiedTimeline | FAIL: `Failed to resolve import` (module didn't exist) | PASS: 3 tests green | — |

---

## Files Changed

| File | Action | What |
|------|--------|------|
| `packages/api/src/modules/activity/serializer.ts` | Modified | Added `via?: string | null` to `RawActivityLog`; `via: string | null` to `SerializedActivityLog`; `via: log.via ?? null` to return |
| `packages/api/src/modules/activity/serializer.test.ts` | Modified | Added 3 via passthrough tests (Scenarios 10, 11, default-null) |
| `packages/web/src/types/issue.ts` | Modified | `via: string | null` on `Comment` and `ActivityLog` |
| `packages/web/src/features/issue-detail/timeline-types.ts` | Created | `TimelineItem` discriminated union (8 kinds), `Actor` type |
| `packages/web/src/features/issue-detail/use-unified-timeline.ts` | Created | `mergeTimeline` pure function + `useUnifiedTimeline` hook |
| `packages/web/src/features/issue-detail/via-badge.tsx` | Created | `ViaBadge` component with cobalt styling and `Icon.Spark` |
| `packages/web/src/features/issue-detail/unified-timeline.tsx` | Created | `UnifiedTimeline` component with per-kind renderers |
| `packages/web/src/routes/_authenticated/issue.tsx` | Modified | Collapsed Activity+Comments tabs into single Timeline tab; removed ActivityList/CommentList imports; wired `useUnifiedTimeline` |
| `packages/web/src/features/issue-detail/comment-list.tsx` | Deleted | No importers after issue.tsx refactor; composer lives in issue.tsx bottom bar |
| `packages/web/src/features/issue-detail/tabs-section.tsx` | Deleted | Dead code, no importers confirmed |
| `packages/web/src/features/issue-detail/__tests__/use-unified-timeline.test.ts` | Created | 18 unit tests for mergeTimeline |
| `packages/web/src/features/issue-detail/__tests__/via-badge.test.tsx` | Created | 7 unit tests for ViaBadge |
| `packages/web/src/features/issue-detail/__tests__/unified-timeline.test.tsx` | Created | 3 component tests for UnifiedTimeline |
| `packages/web/src/features/issue-detail/__tests__/comments-highlight-view.test.tsx` | Modified | Added `via: null` to Comment fixtures (required by new type) |
| `packages/web/src/routes/__tests__/issue-detail-pane.test.tsx` | Modified | Added `via: null` to Comment fixtures |

---

## Deviations from Design

None — implementation matches design.md. Design corrections (no sync kind, drop commented activity rows, correct union kinds) all applied as specified.

---

## Commits Made

1. `test+feat(api): expose via on activity serializer (KAN-32)` — 1c8d4a8
2. `feat(web): unified timeline merge logic + types (KAN-32)` — 3e05b5d
3. `feat(web): ViaBadge provenance badge (KAN-32)` — 9105f08
4. `feat(web): UnifiedTimeline component (KAN-32)` — 3f675e0
5. `refactor(web): collapse issue tabs into unified timeline, drop dead tabs-section (KAN-32)` — a107ede

---

## Test Results

| Suite | Files | Tests | Status |
|-------|-------|-------|--------|
| Web (`pnpm --filter @kanon/web test`) | 83 passed, 1 skipped | 570 passed, 5 todo | GREEN |
| API (`cd packages/api && pnpm vitest run`) | all passed | all passed | GREEN |
| Typecheck (`tsc --noEmit`) | — | — | CLEAN |

---

## Workload / PR Boundary

- Mode: single PR, size:exception granted
- All phases A–F complete in this batch
- Estimated changed lines: ~480 prod + ~340 test
