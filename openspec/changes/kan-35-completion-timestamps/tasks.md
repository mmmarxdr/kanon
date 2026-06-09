# Tasks: KAN-35 — Issue.completedAt & Cycle.closedAt Completion Timestamps

## Review Workload Forecast

| Field | Value |
|-------|-------|
| Estimated changed lines | 220–320 |
| 400-line budget risk | Low |
| Chained PRs recommended | No |
| Suggested split | Single PR |
| Delivery strategy | ask-on-risk |
| Chain strategy | pending |

Decision needed before apply: No
Chained PRs recommended: No
Chain strategy: pending
400-line budget risk: Low

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | Schema + migration + stamping + closedAt + readers | PR 1 | All under 400 lines; single brick |

---

## Phase 1: Schema & Migration (Foundation)

- [x] 1.1 Add `completedAt DateTime? @map("completed_at")` to `Issue` model in `packages/api/prisma/schema.prisma`. Add `closedAt DateTime? @map("closed_at")` to `Cycle` model. Run `prisma migrate dev --create-only --name add_completion_timestamps` to generate timestamped migration dir.
- [x] 1.2 Hand-edit the generated migration SQL to append the backfill statement for `completed_at` only: `UPDATE issues SET completed_at = sub.max_created_at FROM (SELECT issue_id, MAX(created_at) AS max_created_at FROM activity_logs WHERE action='state_changed' AND (details->>'to'='done' OR details->>'newValue'='done') GROUP BY issue_id) sub WHERE issues.id = sub.issue_id AND issues.state = 'done';`. No backfill for `closed_at` (NULL for history).
- [x] 1.3 Run `prisma generate` to update the Prisma client types.

## Phase 2: Issue Stamping — RED Tests First

- [x] 2.1 **[RED]** In `packages/api/issue/__tests__/service.test.ts`: add failing test for spec scenario "Set completedAt on transition to done" for `transitionIssue` — assert `completedAt` is non-null timestamp after done transition.
- [x] 2.2 **[RED]** Add failing tests for same scenario via `transitionGroup` and `batchTransitionByKeys` (single targetState per call → single updateMany, not two-partition). Add failing test for spec scenario "Clear completedAt on reopen" (unconditional, all paths). Add failing test for spec scenario "completedAt unchanged on non-done to non-done".
- [x] 2.3 **[GREEN]** In `packages/api/issue/service.ts`, add inline ternary at site 1 (`transitionIssue` ~line 660): `completedAt: toState === 'done' ? new Date() : null`. Add `// KAN-35: stamp completedAt on done; clear on reopen (see spec sdd/kan-35-completion-timestamps/spec)` comment. Run `vitest run` — target tests green.
- [x] 2.4 **[GREEN]** Add inline ternary at site 2 (`transitionGroup` ~line 780) and site 3 (`batchTransitionByKeys` ~line 915) with the same expression and KAN-35 contract comment at each site. Both batch functions enforce one targetState per call — single `updateMany` (design decision 4; justified deviation from two-partition). Run `vitest run` — all stamping tests green.

## Phase 3: closeCycle closedAt — RED Tests First

- [x] 3.1 **[RED]** In `packages/api/cycle/service.test.ts` (B9.1, ~lines 392-408 — **verify real path at apply**): update mock at ~393-398 to return `closedAt` field. Update assertion at ~406-408 to assert `closedAt` is a non-null timestamp distinct from `updatedAt` (replaces the old `closedAt === updatedAt` assertion). Run `vitest run` — test red.
- [x] 3.2 **[GREEN]** In `packages/api/cycle/service.ts` `closeCycle` function (~line 509): add `closedAt: new Date()` to the `update` payload. Switch line ~545 ack source from `updated.updatedAt` to `updated.closedAt`. Update JSDoc at ~483-486 to document `closedAt`. Run `vitest run` — B9.1 green.

## Phase 4: Reader Switch — RED Tests First

- [x] 4.1 **[RED]** In `packages/api/cycle/__tests__/service.test.ts` B1 (~line 446): update `computeAvgLeadDays` test to assert result uses `issue.completedAt` (issues with `completedAt=NULL` excluded). Confirm no `activityLogs` include in result. Run `vitest run` — test red.
- [x] 4.2 **[RED]** Add/update `computeBurnup` tests in same file for spec scenarios "Burnup uses completedAt when set" and "Burnup falls back to cycle.endDate when completedAt is NULL" (`?? end` fallback preserved). Run `vitest run` — tests red.
- [x] 4.3 **[GREEN]** In `packages/api/cycle/service.ts` `computeAvgLeadDays` (~line 682): drop `activityLog.findMany` + `Map` scan; read `issue.completedAt` directly; exclude NULL. Run `vitest run` — B1 green.
- [x] 4.4 **[GREEN]** In `packages/api/cycle/service.ts` `computeBurnup` (~line 134): drop `activityLogs` include; read `completedAt` per issue with `?? end` endDate fallback preserved. Run `vitest run` — burnup tests green.
- [x] 4.5 **[CLEANUP]** In `packages/api/cycle/__tests__/service.test.ts`: remove/neutralize B2 legacy-done test (~line 418) — it goes vacuous after the reader switch (functions no longer scan ActivityLog). Spec guarantee moves to backfill SQL.

## Phase 5: Backfill Data-Integrity Test

- [x] 5.1 **[RED]** In `packages/api/issue/__tests__/service.test.ts`: create a minimal fixture that seeds: (a) a done issue with a `state_changed` activity log `details.to='done'` (modern shape), (b) a done issue with `details.newValue='done'` (legacy shape), (c) a done issue with no qualifying log. Execute the backfill SQL logic against the seeded data. Assert (a) and (b) get `completedAt` set; (c) stays NULL. Tag this test structural-exempt from strict-TDD red gate (migration SQL is already written in Phase 1; this test verifies correctness, not drives it). Run `vitest run` — test red until fixture wired.
- [x] 5.2 **[GREEN]** Wire fixture to run against test DB / in-memory equivalent; confirm backfill logic covers legacy-OR (`to='done' OR newValue='done'`). Run `vitest run` — test green.

## Phase 6: Final Validation

- [x] 6.1 Run full `vitest run` in `packages/api` — all tests green, no regressions.
- [x] 6.2 Run `tsc --noEmit` (or equivalent typecheck) in `packages/api` — zero type errors.
- [x] 6.3 Verify `prisma migrate deploy` applies cleanly in a clean DB (smoke-test migration chain). Confirm `closedAt` column exists and `completedAt` backfill ran for seeded done-issues.
