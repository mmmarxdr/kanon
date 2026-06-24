# ADR-0008: Baseline snapshot on cycle activation

- Status: Proposed
- Date: 2026-06-24
- Epic: ppm-foundation (W4 — PPM Engine: Visible)
- Issue: KAN-152
- Related: ADR-0004 (scheduling model — decision #3 fixed the trigger), ADR-0005 (work-capture & scheduling data model)

## Context

ADR-0004 decision #3 already chose the baseline **trigger** — cycle activation — and the schema reflects it: `IssueSchedule.baselineStart`, `baselineEnd`, `baselineSetAt` exist, annotated *"reserved for cycle-activation snapshot (future slice)"*. But **nothing writes them**. The Gantt baseline plane and legend item render, yet are always empty, so there is no "are we keeping our original commitment" signal — the whole point of a baseline.

This ADR is the implementation design for that reserved slice: what exactly gets written, when, how immutability and re-baselining are enforced, and what the Gantt renders. It does not re-open the trigger decision.

## Decision

1. **Write the snapshot in the existing `upcoming → active` cycle transition handler, inside its transaction.** For every issue attached to the activating cycle, copy the current `IssueSchedule.startDate`/`dueDate` into `baselineStart`/`baselineEnd` and stamp `baselineSetAt = now`. Reuses the lifecycle event (no new user action) and is atomic with the activation — a cycle is never half-baselined.

2. **The baseline is immutable once set; activation does not overwrite a non-null baseline.** The write is guarded: `baselineSetAt IS NULL` → snapshot; already set → skip. This makes re-activation (e.g. a cycle reopened and re-activated) safe and keeps the *original* commitment, which is what variance is measured against.

3. **Re-baselining is an explicit, audited admin action — never automatic.** A separate `setBaseline(cycleId)` / `setBaseline(issueIds)` operation (admin-gated) overwrites the baseline and writes an audit record (who, when, previous values). This is the only path that overwrites. Surfaced in the UI as a deliberate "re-baseline" action with confirmation, not a side effect of any normal flow.

4. **Issues with no plan dates at activation get no baseline** (`baselineSetAt` stays null), not a zero/epoch baseline. The Gantt already distinguishes "no baseline" from "on baseline"; a fake baseline would render false variance.

5. **Variance is computed on-read, not stored.** Following ADR-0003/0004, the read-model derives `planVsBaseline = dueDate − baselineEnd` and `forecastVsBaseline = forecastEnd − baselineEnd` for the Gantt response. No variance columns on the issue.

## Consequences

- The baseline ghost bar and legend finally carry data; slip is measurable against a frozen commitment, not just against the live plan.
- Cycle activation does bounded extra write work (one snapshot per in-cycle issue) inside the existing transition transaction — same shape ADR-0004 already accepted.
- A new admin re-baseline operation + audit record (new small audit table or reuse of the existing activity log) — the only mutation path for an already-set baseline.
- Reopening/re-activating a cycle is now safe: the null-guard preserves the original baseline instead of silently resetting variance to zero.
- Issues added to a cycle *after* activation have no baseline until an explicit re-baseline includes them — acceptable and consistent with ADR-0004's "no baseline until one is set."

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Overwrite baseline on every activation | Destroys the original commitment on any re-activation; variance would always read ~0. |
| Snapshot on first `startDate` set (per issue) | ADR-0004 already rejected this — captures a draft date, not a committed plan. |
| Manual "set baseline" button only, no activation snapshot | Easy to forget; teams would run whole cycles with an empty baseline plane. Activation gives a reliable default; manual re-baseline still available. |
| Store variance as columns | Derived state — belongs in the read-model, recomputed when plan/forecast move (ADR-0003). |
| Separate `Baseline` table (history of every baseline) | Over-built for the current need; one frozen baseline + an audit record on re-baseline covers the signal. A full baseline-history table is a later ADR if multi-baseline comparison is ever requested. |
