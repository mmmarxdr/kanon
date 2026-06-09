# Tasks: KAN-36 — Stepped cycle scopeLine from CycleScopeEvent

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | ~180–240 (service.ts ~80 logic + ~100–160 tests) |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | N/A — single PR |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: size-exception
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | RED keystone + full implementation + GREEN | PR 1 | service.ts + service.test.ts; Strict TDD RED→GREEN per scenario; named breaking changes flagged |

---

## Phase 1: Foundation — Signature & Select Extension

- [ ] 1.1 In `packages/api/src/modules/cycle/service.ts`: add `key` to the internal `issue.findMany` select (the one inside `computeBurnup`, currently ~line 142-150). Required for removed-key resolution.
- [ ] 1.2 Add `allScopeEvents` parameter to `computeBurnup` (typed as `CycleScopeEvent[]`). Update the single production call site at `getCycle` (~line 303) to pass the already-fetched `allScopeEvents`.

## Phase 2: Core Implementation (Strict TDD — RED first, then GREEN)

### RED tests (write failing tests before any implementation change)

- [ ] 2.1 **RED — Scenario 3 (KEYSTONE): units invariant.** In `packages/api/src/modules/cycle/__tests__/service.test.ts`, write test: cycle with 2 members (est 5, est 8 = 13pts) + add event est=6 day=3 → `scopeLine[0] === 13` AND `scopeLine[days] === 19` (not 3). This is the count-vs-points discriminator; a count-based impl returns 3. Assert FIRST before touching implementation.
- [ ] 2.2 **RED — Scenario 7: day-index mapping.** Test that a day=1 event at est=5 → `scopeLine[0] === 5`; day=D event → first affected index is D-1.
- [ ] 2.3 **RED — Scenario 1: add-step.** 10-day cycle, 3 initial issues (est 2,3,5=10pts) at day 1 + add est=4 day=5 → `scopeLine[0] === 10`, `scopeLine[4] === 10`, `scopeLine[5..10]` each `=== 14`.
- [ ] 2.4 **RED — Scenario 2: remove-step.** Same 10-pt cycle + remove est=3 day=7 → `scopeLine[6] === 10`, `scopeLine[7..10]` each `=== 7`.
- [ ] 2.5 **RED — Scenario 4: removed-key estimate resolution.** KEY-99 est=7 removed at day=4 (now `cycleId=null`) → second `findMany` fetches est → step down by 7 at index 3. Sub-case: KEY-99 deleted → fallback est 1 → step down by 1.
- [ ] 2.6 **RED — Scenario 5: zero-events fallback.** No `CycleScopeEvent` rows → `scopeLine` = `fill(15)` of length `days+1`.
- [ ] 2.7 **RED — Scenario 6: KPI point-sums + invariant.** 3 initial members (est 2,3,5=10pts) at day 1 + add est=4 day=3 (day>=2) + remove est=2 day=6 (day>=2) → `scopeAdded === 4`, `scopeRemoved === 2`; invariant `scopeAdded − scopeRemoved === scopeLine[days] − scopeLine[0]` (=2). Day-1 events EXCLUDED from KPI sums.

### GREEN implementation (make all RED tests pass)

- [ ] 2.8 Implement the `allScopeEvents` empty-guard: if no events, return `scopeLine = new Array(days+1).fill(sumPoints(issues))`.
- [ ] 2.9 Build estimate map: iterate `issues` → `est.set(key, estimate ?? 1)` (current members). Collect `removedKeys` = distinct keys in events not in `est`. If `removedKeys.length > 0`, run ONE `prisma.issue.findMany({ where: { key: { in: removedKeys } }, select: { key, estimate } })` → `est.set`; missing → `resolve(key) = est.get(key) ?? 1`.
- [ ] 2.10 Build per-day delta array: `delta = new Array(days + 1).fill(0)`. For each event in `allScopeEvents`: `delta[event.day - 1] += event.kind === 'add' ? +resolve(event.issueKey) : -resolve(event.issueKey)`.
- [ ] 2.11 Accumulate `scopeLine`: `acc = 0; for d 0..days: acc += delta[d]; scopeLine.push(acc)`. `scopeLine` has length `days + 1`; `scopeLine[0]` = net of day-1 events (initial attaches).
- [ ] 2.12 Compute KPI sums using day>=2 filter: `scopeAdded = sum(resolve(e.issueKey) for add events with e.day >= 2)`; `scopeRemoved = sum(resolve(e.issueKey) for remove events with e.day >= 2)`. Replace the former count-based `.length` assignments (~line 315-316).
- [ ] 2.13 Update `computeRisks` scope-creep risk message wording to reflect points (not counts) and drift-only semantics (baseline excluded). Change wording only — do NOT rewire `scopeNet` logic.

## Phase 3: Verification

- [ ] 3.1 Run `vitest run` in `packages/api` — all 7 new scenarios must pass. Confirm the KAN-35 existing tests still pass (the removed-keys `findMany` is guarded by `removedKeys.length > 0`, so the KAN-35 mock chain remains at ONE issue query).
- [ ] 3.2 Run TypeScript check (`tsc --noEmit`) in `packages/api`. Confirm no type errors from `allScopeEvents` param threading and `key` select addition.
- [ ] 3.3 Verify keystone invariant: `scopeLine[days] === sumPoints(currentMembers)` holds in scenario 3 and scenario 6 test assertions.
- [ ] 3.4 Verify KPI invariant: `scopeAdded − scopeRemoved === scopeLine[days] − scopeLine[0]` holds in scenario 6 test assertion.

## Phase 4: PR Preparation

- [ ] 4.1 Commit as a single work-unit commit using Conventional Commits. PR description MUST call out both named breaking changes: (a) `scopeAdded`/`scopeRemoved` changed from **event counts** to **point-sums** and (b) day-1 events (baseline) are **excluded** from KPI totals. Reviewers must consciously accept both changes.
- [ ] 4.2 Confirm no web changes needed (`cycles-view.tsx` scopePath renders stepped array as-is — no update required). Confirm no schema migration needed.
