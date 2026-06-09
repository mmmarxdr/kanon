# Delta for completion-timestamps

## ADDED Requirements

### Requirement: Issue.completedAt stamped on done transition

The system MUST set `Issue.completedAt` to the transition timestamp whenever an issue transitions TO state `done`, via any of the three transition paths: `transitionIssue`, `transitionGroup`, or `batchTransitionByKeys`. The system MUST set `Issue.completedAt` to `null` when a done issue transitions to any non-done state (reopen). The system MUST NOT alter `Issue.completedAt` when neither the source nor the target state is `done`.

The stamp expression MUST be: `toState === 'done' ? new Date() : null`.

#### Scenario: Set completedAt on transition to done

- GIVEN an issue is in any non-done state
- WHEN the issue transitions to `done` via transitionIssue, transitionGroup, or batchTransitionByKeys
- THEN `completedAt` is set to a non-null timestamp equal to the transition time

#### Scenario: Clear completedAt on reopen

- GIVEN an issue has `completedAt` set (is in state `done`)
- WHEN the issue transitions to any non-done state via any transition path
- THEN `completedAt` is set to `null`

#### Scenario: completedAt unchanged on non-done to non-done

- GIVEN an issue with `completedAt = null` in a non-done state
- WHEN the issue transitions to another non-done state
- THEN `completedAt` remains `null`

Target test file: `issue/__tests__/service.test.ts`

---

### Requirement: Cycle.closedAt stamped on close — forward-only

The system MUST set `Cycle.closedAt` to the close timestamp and `Cycle.state` to `done` when `closeCycle` runs. `Cycle.closedAt` MUST be its own distinct field, not derived from `updatedAt`. Historical closed cycles (closed before this change) MUST have `closedAt = NULL`; no backfill from `updatedAt` or any other field is performed.

#### Scenario: closedAt set on closeCycle

- GIVEN an active cycle
- WHEN `closeCycle` is called
- THEN `closedAt` is set to a non-null timestamp equal to the close time
- AND `closedAt` is distinct from `updatedAt`
- AND `state` is `done`

#### Scenario: Historical cycles have NULL closedAt

- GIVEN a cycle that was closed before this change was deployed
- WHEN the cycle record is read
- THEN `closedAt` is `NULL`

Note: the existing `cycle/__tests__/service.test.ts` assertion at lines 406-407 (`closedAt === updatedAt`) MUST be updated to assert `closedAt` is a non-null timestamp distinct from `updatedAt`.

Target test file: `cycle/__tests__/service.test.ts`

---

### Requirement: Issue.completedAt backfill via migration

The migration that adds `completedAt` MUST backfill done issues that have a `state_changed`→`to: done` activity log entry. For each qualifying issue, `completedAt` MUST be set to the `createdAt` of the latest such log entry. Done issues with no such log entry MUST remain `NULL` (un-backfillable).

#### Scenario: Done issue with activity log gets backfilled

- GIVEN an issue with `state = 'done'`
- AND at least one `activity_log` row with `action = 'state_changed'` and `details->>'to' = 'done'`
- WHEN the additive migration runs
- THEN `completedAt` equals the `MAX(created_at)` of those log rows for that issue

#### Scenario: Done issue without activity log stays NULL

- GIVEN an issue with `state = 'done'`
- AND no `activity_log` row with `action = 'state_changed'` and `details->>'to' = 'done'`
- WHEN the additive migration runs
- THEN `completedAt` remains `NULL`

Note: scenarios are verified by a standalone data-integrity seed+verify test (harness gap: no migration-test fixture exists today — must be created as part of this change).

Target test file: `issue/__tests__/service.test.ts` (data-integrity fixture)

---

### Requirement: computeAvgLeadDays reads Issue.completedAt

`computeAvgLeadDays` MUST derive each issue's completion time from `Issue.completedAt`. Issues where `completedAt` is `NULL` MUST be excluded from the lead-time calculation (current behavior preserved — no ActivityLog scan).

#### Scenario: Lead-time uses completedAt, skips NULL

- GIVEN a set of done issues where some have `completedAt` set and some have `completedAt = NULL`
- WHEN `computeAvgLeadDays` is called
- THEN only issues with non-null `completedAt` contribute to the average
- AND no ActivityLog rows are read

Target test file: `cycle/__tests__/service.test.ts`

---

### Requirement: computeBurnup reads Issue.completedAt with endDate fallback

`computeBurnup` MUST use `Issue.completedAt` as the done timestamp for each issue. WHEN `completedAt` is `NULL`, the system MUST fall back to `cycle.endDate` (existing fallback preserved).

#### Scenario: Burnup uses completedAt when set

- GIVEN a done issue with `completedAt` set
- WHEN `computeBurnup` is called
- THEN the issue's done timestamp is `completedAt`

#### Scenario: Burnup falls back to cycle.endDate when completedAt is NULL

- GIVEN a done issue with `completedAt = NULL`
- WHEN `computeBurnup` is called
- THEN the issue's done timestamp falls back to `cycle.endDate`

Target test file: `cycle/__tests__/service.test.ts`
