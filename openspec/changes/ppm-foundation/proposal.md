# Proposal: PPM Foundation — Data Model & Metrics Spine

## Intent

- Kanon → real PPM platform: one data spine, three altitudes — **Delivery** (devs), **Management** (PMs: health/budget/milestones), **C-Level** (portfolio rollup).
- Foundations-first, not an MVP.
- `WorkLog.durationS` is already auto-captured but un-aggregated — a latent asset this epic activates.
- KAN-35/41/36/40/32 are the **first bricks** of the spine, not throwaway chart fixes.

> Held throughout: the design handoff *shows* candidate fields/formulas; this proposal *commits* only the model below. ADRs (design phase) decide the rest.

## Scope

### In Scope
- **Schema**: dual rate per member (cost-rate + bill-rate); per-period `Budget(projectId, amount, periodStart, periodEnd, periodType)`; `Milestone` entity; issue date-spans + baseline; typed dependencies (FS/SS/FF/SF).
- **Hours flow**: `WorkLog` → suggestion → dev promotes → PM approves into billable `TimeEntry` (human has final word).
- **Hours rollup service** aggregating actuals (today un-aggregated).
- **CQRS-lite materialized read-model** for health/cost/SPI/CPI/portfolio, invalidated on write.
- **Dedicated CRUD** for member rates and project budgets.
- **First bricks** (reframed as foundation, not chart fixes): KAN-35 completedAt/closedAt, KAN-41 readStateChange/activity-log convention, KAN-36 scopeLine, KAN-40 notification SSE, KAN-32 unified timeline.

### Out of Scope (later cycles)
- Visual redesign of existing screens.
- The design bundle's own **"Ola 1"** (unifying `window.KANON` real vs `window.EXEC` synthetic exec data) — **naming collision**: NOT a Kanon project cycle.
- AI-interpretation features (Ask Kanon) — parked.

## Capabilities

### New Capabilities
- `member-rates`: dual cost/bill rate per member + CRUD.
- `project-budgets`: per-period recurring budget rows + CRUD.
- `time-tracking`: WorkLog→TimeEntry promotion/approval flow + hours rollup.
- `scheduling`: issue date-spans, baseline, typed dependencies, milestones.
- `ppm-readmodel`: materialized health/cost/SPI/CPI/portfolio.
- `metrics-spine`: the KAN-35/41/36/40/32 bricks (completedAt/closedAt, readStateChange/activity-log convention, scopeLine, notification SSE, unified timeline) that feed the read-model.

### Modified Capabilities
- None. Existing specs (`cycle-lifecycle`, `kanon-agent-skill`, `mcp-pm-guidance`) keep their current requirement contracts; the bricks add new behavior rather than altering those specs.

## Approach

CQRS-lite: write-heavy capture (WorkLog, transitions, time entries) + read-heavy rollup from a materialized read-model invalidated on write events. Margin = revenue − cost; revenue = billed (T&M) or budget (fixed-price), by `Project.kind`. **4 ADRs to author in design** (planned, not resolved here):

| ADR | Decision to make |
|-----|------------------|
| 1 — Hours source | Canonical hours source + promotion/approval flow |
| 2 — Rate/cost & margin | Dual-rate, kind-driven revenue, historical rate snapshot vs current |
| 3 — Materialization | What is precomputed; which invalidation events recompute |
| 4 — Scheduling/milestone | Date-spans, baseline snapshot trigger, typed deps, critical path |

### Phasing (multi-cycle; exceeds 400-line PR → chained/stacked PRs expected)
1. Foundation schema + rates/budget CRUD + hours rollup.
2. Project health/cost read-model.
3. Gantt / milestones.
4. Exec portfolio rollup.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/api/prisma/schema.prisma` | Modified | Rates, budgets, milestones, date-spans, deps, time entries |
| `packages/api` modules | New | Rollup, read-model, promotion/approval |
| `packages/mcp/src/tools` | New | rates / budgets / timesheet / milestones tools |
| `packages/bridge` | Modified | Shared Zod schemas |
| `packages/web` | New (later) | CRUD + PPM screens |
| `docs/adr/NNNN-*.md` | New | 4 ADRs |

## Risks (open questions design must resolve)

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Historical rate snapshot vs current | High | ADR 2 |
| Billable-vs-cost rate (AC basis) in CPI | Med | ADR 2 |
| Multi-currency | Med | ADR 2; single-currency assumed for now |
| Baseline snapshot trigger | Med | ADR 4 |
| Migration breakage | Med | Additive migrations only (rollback below) |

Lower-load: EXEC↔KANON unification path (deferred; design notes it); where `Project.kind` lives (confirm in spec/design); WorkLog overcount from idle/abandoned sessions (human approval gate + existing `lastHeartbeat` cap).

## Rollback Plan

Additive Prisma migrations only. Revert per slice via `prisma migrate` down + prior read-model version. No existing column dropped or repurposed in phase 1. Each chained PR has an independent rollback boundary.

## Dependencies

- KAN-35/41/36/40/32 land as bricks (can interleave with phase 1).
- `Project.kind` enum source confirmed before margin computation.

## Success Criteria

- [ ] Schema: dual rates, per-period budgets, milestones, date-spans, typed deps, approval-gated time entries.
- [ ] Hours rollup aggregates `WorkLog`/`TimeEntry` actuals via API.
- [ ] Materialized read-model serves health/SPI/CPI/portfolio, invalidated on write.
- [ ] 4 ADRs committed under `docs/adr/`.
- [ ] Rates & budgets CRUD usable end-to-end (api + mcp).
- [ ] Phasing maps to chained PR slices, each under review budget.
