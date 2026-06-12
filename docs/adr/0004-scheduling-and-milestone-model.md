# ADR-0004: Scheduling & milestone model

- Status: Accepted
- Date: 2026-06-08
- Epic: ppm-foundation
- Related: ADR-0003 (critical path is read-model output)

## Context

The Gantt, milestones and project-health screens need: issue **date-spans** (start/due), a **baseline** to measure schedule slip against, **typed dependencies** with lag (FS/SS/FF/SF + lagDays from the mock), **milestones** with deliverable issues, and a **critical path**. The mock (`data-ppm.jsx`) models these as `ISSUE_EXT` (startDate/dueDate/progress/baselineStart/End/critical), `DEPENDENCIES` (typed + lagDays) and `MILESTONES` (with `deliverables: [issueKey]`).

The backend already has an `IssueDependency` table with a `IssueDependencyType { blocks }` enum used as a **workflow gate** (blocks/blocked-by). `Issue.estimate` exists but is **story points**, a different unit from scheduling **hours**. There is no date-span, baseline, milestone, or critical-path concept yet. Open question from exploration: what event triggers the baseline snapshot?

## Decision

1. **`IssueSchedule` (1:1 with Issue).** Holds `startDate`, `dueDate`, `progress` (0–100), `estimateHours`, `baselineStart`, `baselineEnd`, `baselineSetAt`, `group`. Kept off `Issue` so the scheduling concern is isolated and the migration is additive.
2. **`estimateHours` is hours, distinct from `Issue.estimate` (story points).** Different unit, different consumer (EV math vs cycle burnup). They are not unified.
3. **Baseline trigger = cycle activation.** When a Cycle transitions `upcoming → active` (existing `CycleState` machine), every issue in that cycle snapshots its current `startDate`/`dueDate` into `baselineStart`/`baselineEnd` and stamps `baselineSetAt`. This reuses the existing lifecycle event, gives a meaningful "plan as committed at sprint start" baseline, and needs no new user action. Re-baselining (rare) is an explicit admin action, not automatic.
4. **Extend `IssueDependency` additively.** Keep `blocks`; add `FS`, `SS`, `FF`, `SF` to the enum and a `lagDays Int @default(0)` column. Semantics stay distinct: `blocks` = workflow gate (cannot move to in-progress), FS/SS/FF/SF = **schedule constraint** consumed by the Gantt/critical-path. Same table, one type field.
5. **`Milestone` + `MilestoneDeliverable` join.** `Milestone(projectId, name, target, status, ownerId, metOn?)`; deliverables are a many-to-many to Issue via `MilestoneDeliverable @@unique([milestoneId, issueId])` — not a JSON array, so deliverable health rolls up by querying linked issues.
6. **Critical path computed on-read in the read-model**, not stored on issues. Forward-pass/backward-pass over the `IssueSchedule` + typed-dependency graph (honoring lagDays) yields the `critical` flag and float; the result lands in `ProjectReadModel`/the Gantt response (ADR-0003). `critical` is never a column on Issue.

## Consequences

- Schedule slip = `dueDate − baselineEnd`, computable the moment a cycle goes active.
- Typed deps drive a real critical-path algorithm; `blocks` keeps its existing workflow meaning untouched (no behavioural regression on current users).
- Milestone deliverable status is queryable (join), enabling "milestone at risk because KAN-138 slipped."
- Cycle activation now does extra write work (baseline snapshot); bounded by issues-in-cycle, runs in the transition handler.
- Issues not attached to a cycle have no baseline until one is set — acceptable; the Gantt shows planned vs no-baseline state.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Date-spans as columns on `Issue` | Bloats the hot Issue row with a concern most queries don't need; isolating in `IssueSchedule` keeps reads lean. |
| Baseline on first `startDate` set | Premature — captures a draft date, not a committed plan; noisy re-baselining. |
| Baseline via manual button only | Easy to forget; cycle activation gives a reliable default with manual re-baseline still available. |
| New separate `ScheduleDependency` table | Duplicates `IssueDependency`; two dep tables to keep consistent. Extending the enum is additive and simpler. |
| Deliverables as JSON `issueKey[]` on Milestone | Cannot join for rollup; breaks on issue rename/delete; no referential integrity. |
| Store `critical` on Issue | It is derived state — belongs in the read-model, recomputed on schedule/dep changes (ADR-0003). |
