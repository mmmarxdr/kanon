# ADR-0002: Rate / cost model & margin

- Status: Accepted
- Date: 2026-06-08
- Epic: ppm-foundation
- Related: ADR-0001 (approval gate), ADR-0003 (materialization)

## Context

Marc locked the money model: "Build correct foundations from the start." Three money figures are required:

- **cost** = Σ(hours × cost-rate) — what we pay
- **billed** = Σ(hours × bill-rate) — what we charge the client
- **budget** = contract ceiling (per period)

Real **margin = revenue − cost**, where revenue depends on contract type: time-and-materials bills actuals, fixed-price earns the budget regardless of hours. The design mock (`data-ppm.jsx`) carries only a single `hourlyRate` and **no rate versioning** (the explorer invented `effectiveFrom/To`; it is not in the source). Open question from exploration: should rollups use the rate at the time the hours were worked, or the current rate?

## Decision

1. **Dual rate, current value only.** `MemberRate(costRate, billRate, currency, hoursPerWeek)` — one row per member, holding the *current* rate. No rate-versioning table.
2. **Snapshot-at-entry (at approval).** When a `TimeEntry` is approved, the then-current `costRate` and `billRate` are copied onto the entry (`costRateSnapshot`, `billRateSnapshot`). Approved entries are immutable financial facts.
3. **Rollups read TimeEntry alone** — they never join `MemberRate`. This is what makes "historical rate" correct without versioning: history lives on the entries; the rate table only ever holds today's number.
4. **Kind-driven revenue.** `Project.kind` enum (`tm | fixed | internal`, default `tm`):
   - `tm` → revenue = Σ billed (bill-rate snapshots)
   - `fixed` → revenue = Σ active Budget rows for the period
   - `internal` → revenue = 0 (cost-only tracking)
5. **CPI basis = cost** (`AC = Σ approved hours × costRateSnapshot`). The bill side feeds margin/revenue, not CPI.
6. **Single currency for now.** `currency` columns exist on `MemberRate` and `Budget` but P1 assumes one workspace currency; FX conversion is deferred (forward note below).

## Consequences

- Changing a member's rate today does **not** rewrite past financials — exactly the auditing behaviour billing needs.
- No `MemberRate` history table to maintain or migrate; the snapshot columns carry the truth.
- Margin is computable per project from the read-model: `billedRevenue`/budget − `actualCost`.
- A rate change before approval applies to the pending entry (correct — the entry is not yet a fact).
- **Forward note (multi-currency):** when a workspace mixes currencies, add an FX-rate snapshot at approval alongside the cost/bill snapshots and normalise to a workspace base currency in the read-model. The `currency` columns are the seam for that work; no schema break expected.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Cost-rate only (defer bill-rate) | Marc explicitly killed this — full money model now, no deferring. |
| Rate-versioning table (`effectiveFrom/To`) | Invented by explorer, not in source; adds join complexity and temporal-query bugs. Snapshot-at-entry is simpler and equally correct. |
| Read current rate at rollup time | Past financials would silently change whenever a rate is edited — unacceptable for billing/audit. |
| Single blended rate (no cost vs bill split) | Cannot compute margin; the whole point of the model. |
