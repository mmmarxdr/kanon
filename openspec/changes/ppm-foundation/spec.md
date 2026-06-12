# Spec: PPM Foundation — Data Model & Metrics Spine
# Change: ppm-foundation | Phase 1 scope

All capabilities are NEW (proposal Modified: NONE).
ADR-dependent behaviors are marked `[ADR-N: open]`.
Strict TDD: every scenario MUST be automatable.

---

## Capability: member-rates

### Requirement: Dual Rate Per Member

A member MUST have exactly one active cost rate and one active bill rate, each with an explicit currency.
The system MUST expose CRUD endpoints for member rates (create, read, update, delete).
A rate MUST include: `memberId`, `costRateAmount`, `billRateAmount`, `currency` (ISO 4217).

#### Scenario: Create member rate

- GIVEN a valid `memberId` and positive `costRateAmount`, `billRateAmount`, `currency`
- WHEN a POST request is made to create a member rate
- THEN a rate record is persisted and the response includes the generated `id`

#### Scenario: Read member rate

- GIVEN an existing member rate `id`
- WHEN a GET request is made for that `id`
- THEN the response contains `memberId`, `costRateAmount`, `billRateAmount`, `currency`

#### Scenario: Update member rate

- GIVEN an existing member rate `id` and a new `billRateAmount`
- WHEN a PATCH request is made
- THEN the persisted record reflects the new amount

#### Scenario: Delete member rate

- GIVEN an existing member rate `id`
- WHEN a DELETE request is made
- THEN the record is removed and subsequent GET returns 404

#### Scenario: Missing currency rejected

- GIVEN a create request with no `currency` field
- WHEN the request is processed
- THEN the response is HTTP 422 with a validation error identifying `currency`

#### Scenario: Current rate applied to cost computation `[ADR-2: open]`

- GIVEN a member with `costRateAmount = 100` and an approved `TimeEntry` for 3 hours dated today
- WHEN the hours rollup computes actual cost for that entry
- THEN `actualCost = 300` (current rate used)

#### Scenario: Historical rate snapshotted at entry time `[ADR-2: open]`

- GIVEN a member whose rate was 80 at entry creation and is now 100
- WHEN the hours rollup computes actual cost for that historical entry
- THEN `actualCost = 240` (rate at entry time used, not current)

---

## Capability: project-budgets

### Requirement: Per-Period Recurring Budget Rows

The system MUST support budget records scoped to a project and a time period.
A budget row MUST include: `projectId`, `amount`, `periodStart` (date), `periodEnd` (date), `periodType` (monthly | quarterly | custom).
The system MUST expose CRUD for budget rows.
The system MUST provide a consumed-per-period query that returns the sum of approved `TimeEntry` costs within the period window.

#### Scenario: Create budget row

- GIVEN a valid `projectId`, `amount`, `periodStart`, `periodEnd`, `periodType`
- WHEN a POST request is made
- THEN a budget row is persisted and returned with its generated `id`

#### Scenario: Overlapping periods permitted

- GIVEN two budget rows for the same project with overlapping date ranges
- WHEN both are created via POST
- THEN both persist without error (enforcement is a business-layer concern, not a uniqueness constraint)

#### Scenario: Consumed-per-period query — period isolation

- GIVEN budget rows for Jan 2026 and Feb 2026 on `projectId = P1`
- AND approved `TimeEntry` records with dates in Jan and Feb respectively
- WHEN a GET consumed query is made for Jan 2026 on `P1`
- THEN only Jan-dated entry costs are summed; Feb entries are excluded

#### Scenario: No entries returns zero consumed

- GIVEN a budget row for a period with no matching `TimeEntry` records
- WHEN the consumed query is called
- THEN the response returns `consumed = 0`

#### Scenario: Invalid periodType rejected

- GIVEN a create request with `periodType = "weekly"`
- WHEN the request is processed
- THEN the response is HTTP 422 with a validation error identifying `periodType`

---

## Capability: time-tracking

### Requirement: WorkLog Promotion Flow

The system MUST support a promotion pipeline: `WorkLog` → suggestion → dev promotes → PM approves → billable `TimeEntry`.
A `TimeEntry` MUST have status from: `draft | submitted | approved | rejected`.
Only `approved` entries MUST be included in hours rollup cost computations.
Idle or overcounted `WorkLog` sessions are handled at the human approval gate (not auto-truncated by the system).

#### Scenario: WorkLog generates suggestion

- GIVEN a `WorkLog` record with `durationS >= 60` linked to an `issueId`
- WHEN the suggestion generation process runs
- THEN a `WORK_SESSION_SUGGESTION` record is created containing `issueId` and `minutes`

#### Scenario: Dev promotes suggestion to draft TimeEntry

- GIVEN an existing `WORK_SESSION_SUGGESTION`
- WHEN a dev submits a promote request (optionally editing `hours` and `description`)
- THEN a `TimeEntry` is created with `status = draft` and the dev's `userId`

#### Scenario: Dev submits draft for approval

- GIVEN a `TimeEntry` with `status = draft` owned by the requesting dev
- WHEN a submit request is made
- THEN the entry transitions to `status = submitted`

#### Scenario: PM approves submitted entry

- GIVEN a `TimeEntry` with `status = submitted`
- WHEN a user with PM role approves it
- THEN the entry transitions to `status = approved` with `approvedBy` and `approvedOn` set

#### Scenario: PM rejects submitted entry

- GIVEN a `TimeEntry` with `status = submitted`
- WHEN a PM rejects it with an optional reason
- THEN the entry transitions to `status = rejected`

#### Scenario: Rejected entry excluded from rollup

- GIVEN a `TimeEntry` with `status = rejected` for 5 hours
- WHEN the hours rollup is queried for that project/period
- THEN those 5 hours are NOT included in the aggregated total

#### Scenario: Hours rollup — aggregation by project

- GIVEN multiple approved `TimeEntry` records for `projectId = P1` in March 2026
- WHEN the rollup endpoint is called with `projectId = P1` and `period = 2026-03`
- THEN the response returns the sum of `hours` across all approved entries for that filter

#### Scenario: Hours rollup — aggregation by member

- GIVEN approved entries for `memberId = M1` across multiple projects
- WHEN the rollup endpoint is called with `memberId = M1`
- THEN entries across all projects for that member are summed

#### Scenario: Rollup source — WorkLog vs TimeEntry `[ADR-1: open]`

- GIVEN a project with both raw `WorkLog.durationS` records and approved `TimeEntry` records
- WHEN the rollup is computed
- THEN the canonical source (WorkLog-derived OR approved TimeEntry only) is used consistently — resolution deferred to ADR-1

---

## Capability: scheduling

### Requirement: Issue Date-Spans and Baseline

An issue MAY carry `startDate`, `dueDate`, `baselineStart`, and `baselineEnd` (all nullable dates).
These fields MUST be stored and returned on issue read/write without altering any other issue behavior.

#### Scenario: Store and retrieve issue date-spans

- GIVEN an issue with `startDate = 2026-07-01` and `dueDate = 2026-07-31`
- WHEN the issue is created or updated
- THEN a subsequent GET returns the same `startDate` and `dueDate`

#### Scenario: Null date-spans permitted

- GIVEN an issue with no `startDate` or `dueDate` provided
- WHEN the issue is retrieved
- THEN `startDate` and `dueDate` are null (no default applied)

#### Scenario: Baseline snapshot trigger `[ADR-4: open]`

- GIVEN an issue with `startDate` and `dueDate` set
- WHEN the baseline snapshot is triggered (trigger event TBD per ADR-4)
- THEN `baselineStart` and `baselineEnd` are set to the current `startDate`/`dueDate` values

### Requirement: Typed Dependencies

The system MUST support typed dependency links between issues with types: `FS` (finish-to-start), `SS` (start-to-start), `FF` (finish-to-finish), `SF` (start-to-finish).
A dependency MUST include: `fromIssueId`, `toIssueId`, `type`, and optional `lagDays` (integer, default 0).

#### Scenario: Create typed dependency

- GIVEN two existing issues `A` and `B`
- WHEN a dependency `{from: A, to: B, type: FS, lagDays: 2}` is created
- THEN the dependency is persisted and returned

#### Scenario: Invalid dependency type rejected

- GIVEN a create request with `type = "PS"`
- WHEN the request is processed
- THEN the response is HTTP 422 identifying `type` as invalid

#### Scenario: Retrieve issue dependencies

- GIVEN issue `A` with a dependency on issue `B`
- WHEN issue `A`'s dependencies are queried
- THEN the response lists the dependency with correct `type` and `lagDays`

### Requirement: Milestone Entity

The system MUST support `Milestone` records with: `projectId`, `name`, `targetDate`, `status` (open | reached | missed), `ownerId` (nullable), `description` (nullable), `deliverables` (array of `issueId`).
The system MUST expose CRUD for milestones.

#### Scenario: Create milestone

- GIVEN a valid `projectId`, `name`, `targetDate`, `status = open`
- WHEN a POST request is made
- THEN a milestone is persisted with a generated `id`

#### Scenario: Milestone with deliverables

- GIVEN a milestone create request with `deliverables = [issueId1, issueId2]`
- WHEN the request is processed
- THEN the milestone is retrievable with those two issue references

#### Scenario: Mark milestone reached

- GIVEN a milestone with `status = open`
- WHEN a PATCH sets `status = reached`
- THEN the milestone reflects `status = reached` on next read

---

## Capability: metrics-spine (forward reference — Phase 1 foundation bricks)

> These requirements feed the PPM read-model. KAN-35, KAN-41, KAN-36, KAN-40, and KAN-32
> are the authoritative requirement sources. This spec does NOT re-specify them.
> They are listed as forward markers so design and tasks can wire them into the spine.

### Requirement: Foundation Bricks — External References

| KAN issue | Brick | Fed metric |
|-----------|-------|------------|
| KAN-35 | `completedAt` / `closedAt` on Issue | Cycle time, lead time |
| KAN-41 | `readStateChange` / activity-log convention | Timeline, change events |
| KAN-36 | `scopeLine` on CycleScopeEvent | Scope creep index |
| KAN-40 | Notification SSE | Real-time read-model push |
| KAN-32 | Unified timeline | Unified event stream |

The system MUST NOT block phase-1 schema migration on the bricks being complete; they MAY land in parallel.

---

## Capability: ppm-readmodel (forward header — Phase 2)

> Phase 2 scope. Do NOT spec scenarios here.
> The read-model consumes phase-1 write-side data (rates, budgets, approved TimeEntries,
> scheduling fields, brick events) to compute: project health score, SPI, CPI, scope creep,
> resource load, and portfolio rollup.
> ADR-3 (materialization strategy and invalidation events) governs this capability.

---

## Forward Markers: Phases 3–4

| Phase | Capability | Governing ADR |
|-------|------------|---------------|
| 3 | Gantt / milestones visual + critical-path computation | ADR-4 |
| 4 | Exec portfolio rollup (C-level altitude) | ADR-3 |

---

## Open ADR Summary

| ADR | Status | Impacts |
|-----|--------|---------|
| ADR-1: Hours source | Open | `time-tracking` rollup source, scenarios tagged `[ADR-1: open]` |
| ADR-2: Rate/cost & margin | Open | `member-rates` snapshot vs current, CPI AC basis, multi-currency |
| ADR-3: Materialization | Open | `ppm-readmodel` (phase 2), invalidation events |
| ADR-4: Scheduling/milestone | Open | `scheduling` baseline trigger, critical-path computation |
