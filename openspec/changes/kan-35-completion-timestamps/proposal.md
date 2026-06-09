# Proposal: KAN-35 — Issue.completedAt & Cycle.closedAt timestamps

## Intent

Cycle and lead-time metrics today are reconstructed by scanning `ActivityLog` for `state_changed→done` events on every read. That is fragile, slow, and couples analytics to log shape. KAN-35 introduces the first-class completion timestamp primitive (`Issue.completedAt`, `Cycle.closedAt`) so metrics read a column, not a log scan.

## Motivation

This is the `metrics-spine` foundation brick from the ppm-foundation epic. `completedAt` is the timestamp primitive ADR-0003's read-model rollup needs to compute cheap cycle/lead-time aggregates. It advances the epic's "truthful metrics" goal: a stored completion time is honest and auditable; a derived one drifts. Follows the KAN-41 single-source-of-truth pattern (`shared/activity-log.ts`).

## Scope

### In Scope
- Add nullable `Issue.completedAt` + `Cycle.closedAt` (additive migration).
- Stamp `completedAt` at the 3 transition sites (`transitionIssue`, `transitionGroup`, `batchTransitionByKeys`) and `closedAt` in `closeCycle`.
- In-migration raw-SQL backfill for `completedAt` (done issues only).
- Switch `computeAvgLeadDays` + `computeBurnup` to read the columns; preserve `computeBurnup`'s `cycle.endDate` fallback for NULL `completedAt`.
- **Removed: NONE.**

### Out of Scope
Deferred to later ppm-foundation phases: MemberRate, Budget, TimeEntry, ProjectReadModel, scheduling, scopeLine (KAN-36), unified timeline (KAN-32), notification SSE (KAN-40).

## Capabilities

### New Capabilities
- `completion-timestamps`: first-class `Issue.completedAt` / `Cycle.closedAt` columns, their write rules at transition/close sites, the backfill, and the metric readers that consume them. First brick of the `metrics-spine` umbrella.

### Modified Capabilities
- None. (`cycle-lifecycle` is the KAN-23 delete spec — unrelated.)

## Settled Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Cycle.closedAt backfill | NONE → NULL for historical cycles; forward-only in `closeCycle` | ActivityLog is issue-scoped; `updatedAt` is clobbered by velocity recompute → would lie. NULL is honest. |
| Issue.completedAt backfill | Raw SQL inside the additive migration: `MAX(activity_log.created_at)` where `details->>'to'='done'`, `WHERE issue.state='done'` | Self-contained, atomic with add-column, forward-only. Un-backfillable rows stay NULL. |
| Clear-on-reopen | Unconditional: `toState==='done' ? new Date() : null` at every site | `done` is the only terminal state; one expression sets and clears everywhere. |

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `prisma/schema.prisma` + new migration | New | Add columns + backfill SQL |
| `issue/service.ts` (641, 710, 843) | Modified | Stamp completedAt in state writes |
| `cycle/service.ts` (491, 134, 682) | Modified | closeCycle stamps closedAt; readers switch to columns |
| `cycle/__tests__/service.test.ts:406` | Modified | `closedAt===updatedAt` assertion flips |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| N-site rule: future 4th transition path forgets completedAt | Med | Comment at each site + shared expression |
| Backfill NULL gap (done issues with no done-log) | Med | Readers already skip NULL; keep burnup endDate fallback |
| `service.test.ts:406` regression | High | Update assertion in same change |
| No migration-test harness for backfill | Med | Add standalone seed+verify data-integrity test |

## Rollback Plan

Columns are nullable and additive — reverting the code leaves them unused and harmless (honors the additive-never-destructive hard constraint). No down-migration drops data; a follow-up drop migration is only needed if the columns must be fully removed.

## Dependencies

KAN-41 activity-log helpers (`isDoneTransition`, `readStateChange`) — already merged.

## Success Criteria

- [ ] Both columns exist, nullable, additive migration applies cleanly.
- [ ] All 3 transition sites + `closeCycle` stamp correctly; reopen clears `completedAt`.
- [ ] Backfill populates done issues with a done-log; others stay NULL.
- [ ] `computeAvgLeadDays` + `computeBurnup` read columns; burnup fallback preserved.
- [ ] `vitest run` green in `packages/api`.
