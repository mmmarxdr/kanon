# Delta for metrics-spine
# Change: kan-36-scopeline-from-events

Scope: `computeBurnup` in `packages/api/src/modules/cycle/service.ts`.
Pure read-path change — no schema migration, no web change.
Strict TDD: all scenarios target `cycle/__tests__/service.test.ts`.

---

## ADDED Requirements

> The `metrics-spine` section of `ppm-foundation/spec.md` lists KAN-36 as a
> forward reference only. No prior `scopeLine` requirement block exists to
> modify; requirements below are added from scratch.

### Requirement: Points-Stepped scopeLine from CycleScopeEvent

`computeBurnup` MUST produce a `scopeLine` array of length `days + 1` where
index `d` holds the cumulative scope (story points) at the end of cycle day `d`.

The line MUST be built by accumulating point deltas from `CycleScopeEvent`
rows using each event's `createdAt` timestamp — NOT the stored `event.day`.
The elapsed index for an event is:

```
elapsed = clamp(round((event.createdAt − cycleStart) / ONE_DAY_MS), 0, days)
```

This is the same clamp formula used by the burnup series for `completedAt`, so
both series share the SAME 0-based x-axis convention and are always aligned when
plotted together. An `add` event with estimate `E` at elapsed index `E` contributes
`+E` to `delta[elapsed]`; a `remove` event contributes `−E`. `scopeLine[d]` is
the prefix sum of `delta[0..d]`.

The stored `event.day` field is NOT used for this computation (it is retained
for display and ordering purposes only).

**Precondition**: every cycle membership change (initial attach, mid-cycle
add/remove) MUST have a corresponding `CycleScopeEvent` row. All current write
paths (`createCycle`, `attachIssuesToCycle`, `createIssue`, `updateIssue`)
already satisfy this; the algorithm relies on it.

**Fallback**: when no `CycleScopeEvent` rows exist for the cycle, `scopeLine`
MUST be a constant array `fill(sumPoints(currentMembers))` of length `days + 1`
(backward-compatible).

**Invariant**: `scopeLine[days] === sumPoints(currentMembers)` MUST hold for
every cycle.

**Estimate resolution** (behavior, not mechanism):

| Issue state | Estimate source |
|-------------|-----------------|
| Current member | Resolved from current cycle membership |
| Removed (`cycleId = null`) | Resolved via lookup by issue key |
| Deleted / not found | Fallback `1` (matches `sumPoints` null→1 semantics) |

---

### Requirement: KPI Units — Point-Sums (scopeAdded / scopeRemoved)

`scopeAdded` and `scopeRemoved` MUST be point-sums (story points), not event
counts.

Only **mid-cycle events** (`elapsed >= 1`, where elapsed is derived from
`event.createdAt` using the same clamp formula as `scopeLine`) are included in
KPI totals. Planning-baseline events (elapsed 0, `createdAt ≈ cycleStart`)
represent the initial plan and are excluded from drift KPIs. The stored
`event.day` is NOT used for this filter.

**KPI invariant**: `scopeAdded − scopeRemoved === scopeLine[days] − scopeLine[0]`

The scope-creep risk message in `computeRisks` MUST reflect points, not counts.

*(Previously: `scopeAdded`/`scopeRemoved` were event `.length` counts over all
events. This is a visible behavior change — reviewer must consciously accept.)*

---

## Scenarios

All scenarios: `cycle/__tests__/service.test.ts` (burnup describe block).

#### Scenario 1: Stepped line from add events

- GIVEN a 10-day cycle with 3 initial issues (estimates 2, 3, 5) attached at elapsed=0
- AND a `CycleScopeEvent` kind=`add`, estimate=4, `createdAt=start+4days` (elapsed=4)
- WHEN `computeBurnup` is called
- THEN `scopeLine[0] === 10`, `scopeLine[3] === 10`, and `scopeLine[4..10]` each `=== 14`

#### Scenario 2: Step down on remove

- GIVEN the same 10-pt initial cycle
- AND a `CycleScopeEvent` kind=`remove` for an initial member with estimate=3, `createdAt=start+6days` (elapsed=6)
- WHEN `computeBurnup` is called
- THEN `scopeLine[0..5] === 10` and `scopeLine[6..10]` each `=== 7`

#### Scenario 3: Points not counts (discriminating — count-based impl fails this)

- GIVEN a cycle with 2 initial issues (estimates 5 and 8, total 13 pts)
- AND a `CycleScopeEvent` kind=`add`, estimate=6, `createdAt=start+2days` (elapsed=2)
- WHEN `computeBurnup` is called
- THEN `scopeLine[0] === 13` and `scopeLine[days] === 19` (not 3)

#### Scenario 4: Estimate resolution for removed issues

- GIVEN a cycle with an initial member KEY-99 (estimate=7) at elapsed=0
- AND a `CycleScopeEvent` kind=`remove` for KEY-99 at elapsed=3 (KEY-99 now has `cycleId = null`)
- WHEN `computeBurnup` is called
- THEN `scopeLine` steps down by 7 at index 3 (estimate resolved via lookup)
- AND GIVEN KEY-99 does not exist in the DB
- THEN `scopeLine` steps down by 1 (fallback estimate)

#### Scenario 5: Zero-events fallback

- GIVEN a cycle with current members totaling 15 pts
- AND no `CycleScopeEvent` rows for the cycle
- WHEN `computeBurnup` is called
- THEN `scopeLine` is a constant array of length `days + 1` with every element `=== 15`

#### Scenario 6: KPI consistency in points (visible behavior change)

- GIVEN a cycle with 3 initial members (estimates 2, 3, 5 = 10 pts) at elapsed=0
- AND a mid-cycle `add` event, estimate=4, elapsed=2 (>= 1)
- AND a mid-cycle `remove` event for an initial member, estimate=2, elapsed=5 (>= 1)
- WHEN the cycle read response is built
- THEN `scopeAdded === 4` and `scopeRemoved === 2` (point-sums, not counts)
- AND `scopeAdded − scopeRemoved === scopeLine[days] − scopeLine[0]` (= 2)

#### Scenario 7: Elapsed-index mapping (aligned with burnup convention)

- GIVEN a `CycleScopeEvent` with `createdAt = cycleStart` (elapsed=0) and estimate=5
- WHEN `computeBurnup` is called
- THEN `scopeLine[0] === 5` (elapsed-0 event lands at index 0 — planning baseline)
- AND for any event at elapsed=E with estimate=Est, `scopeLine[E]` is the first index
  reflecting the step; indices `0..E-1` are unaffected by that event
- NOTE: this aligns with burnup which buckets completedAt at index
  `clamp(round((completedAt − start) / DAY), 0, days)` — same formula
