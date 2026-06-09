# Design: KAN-36 — Stepped cycle scopeLine from CycleScopeEvent

## Technical Approach

Rewrite the flat `scopeLine` in `computeBurnup` (packages/api/src/modules/cycle/service.ts:175-179) into a points-accurate **stepped cumulative fold** over `CycleScopeEvent` rows. Resolve each distinct `issueKey` to a story-point estimate, build a per-day delta array, and accumulate. `scopeAdded`/`scopeRemoved` KPIs (service.ts:315-316) move from event **counts** to point **sums** using the SAME resolved-estimate map. Pure read-path: no schema, no migration, no `@kanon/web` change.

## Architecture Decisions

| Decision | Choice | Rejected | Rationale |
|----------|--------|----------|-----------|
| Units | Story points (estimate join) | +1/-1 counts | scopeLine shares burnup Y-axis (points). Counts break invariant `scopeLine[days]===sumPoints(members)`. |
| Estimate source | Map per distinct key: current members from internal query (O(1)); removed via ONE `findMany`; deleted→1 | per-event query; snapshot column | Zero extra queries common case; no schema change (decision #5). |
| Signature | Pass `allScopeEvents` into `computeBurnup`; add `key` to its internal select | thread `cycle.issues` | `cycle.issues` lacks `completedAt`; internal query already has estimate/state/completedAt — add only `key`. Single private caller (getCycle:303). |
| Estimate timing | CURRENT estimate per key | historical snapshot | No estimate column on event (schema confirmed). Accepted approximation. |

## Algorithm — stepped fold

```
computeBurnup(cycleId, start, end, allScopeEvents):
  days = totalDays(start, end)
  issues = prisma.issue.findMany({ where:{cycleId},
             select:{ id, key, estimate, state, completedAt } })   // +key
  // ...existing burnup loop unchanged...

  if allScopeEvents.length === 0:                                  // §4 fallback
    scopeLine = new Array(days+1).fill(sumPoints(issues))          // backward compat
    return { burnup, scopeLine }

  // §5 estimate resolution — once per DISTINCT key
  est = new Map<string, number>()
  for i of issues: est.set(i.key, i.estimate ?? 1)                 // current members O(1)
  removedKeys = [...new Set(allScopeEvents.map(e=>e.issueKey))].filter(k => !est.has(k))
  if removedKeys.length > 0:                                       // ONE query, conditional
    for r of prisma.issue.findMany({ where:{key:{in:removedKeys}}, select:{key,estimate} }):
      est.set(r.key, r.estimate ?? 1)
  resolve = (key) => est.get(key) ?? 1                             // deleted → 1

  // delta indexed by event.day-1 (1-based day → 0-based index); already clamped [1,days] at write
  delta = new Array(days+1).fill(0)
  for e of allScopeEvents:
    delta[e.day - 1] += (e.kind === "add" ? +resolve(e.issueKey) : -resolve(e.issueKey))

  // cumulative; scopeLine[0] = day-1 deltas (initial attaches land at day 1 → delta[0])
  scopeLine = []; acc = 0
  for d = 0..days: acc += delta[d]; scopeLine.push(acc)
  return { burnup, scopeLine }
```

getCycle threads its already-loaded `allScopeEvents` (service.ts:290): `computeBurnup(cycle.id, start, end, allScopeEvents)`.

## KPI change (service.ts:315-316)

```ts
// build same est map (or share resolver); deleted→1
const scopeAdded = sumDelta(allScopeEvents, "add");    // Σ estimate of add events
const scopeRemoved = sumDelta(allScopeEvents, "remove"); // Σ estimate of remove events
```

**Invariant (by construction)**: `scopeLine[days] = Σ all deltas = scopeAdded − scopeRemoved`.

> CORRECTION to task brief §3: the form `scopeAdded − scopeRemoved === scopeLine[days] − scopeLine[0]` is FALSE here. Initial attaches are logged as `add` at day 1 (createCycle), so they sit in BOTH `scopeAdded` AND `scopeLine[0]`. Subtracting `scopeLine[0]` would drop day-1 adds. Assert the two that hold by construction:
> 1. `scopeLine[days] === scopeAdded − scopeRemoved`
> 2. `scopeLine[days] === sumPoints(currentMembers)` (assumes complete event log; legacy pre-logging cycles may not — acceptable, read-path, no backfill).

## File Changes

| File | Action | Description |
|------|--------|-------------|
| packages/api/.../cycle/service.ts | Modify | computeBurnup: +`allScopeEvents` param, +`key` select, stepped fold, zero-events fallback; getCycle passes events; scopeAdded/scopeRemoved →point sums |
| packages/api/.../cycle/__tests__/service.test.ts | Add | scopeLine stepping + invariant tests |
| packages/web/.../cycles-view.tsx | None | `scopePath` (line 534) plots per-day with L segments — stepped renders as-is |
| prisma/schema.prisma | None | No estimate column added |

## Edge Cases (§6)

| Case | Behavior |
|------|----------|
| add then remove same key | resolve once → +e then −e → net 0 (balanced because SAME estimate both sides) |
| add+remove+add same key | +e −e +e → net +e |
| event key beyond current membership | resolved via removedKeys `findMany`; deleted → fallback 1 |
| estimate changed after event | uses CURRENT estimate — accepted approximation (no snapshot exists) |
| events outside [1,days] | impossible (write-time clamp); no runtime clamp |

## Testing Strategy (strict TDD, red→green)

Mock sequence per getCycle call: `cycle.findUnique` → `cycleScopeEvent.findMany` → `issue.findMany` (burnup/current) → conditional `issue.findMany` (removed, via `mockResolvedValueOnce` chain). Guard `removedKeys.length>0` keeps existing KAN-35/B1 tests at exactly ONE issue query.

| # | Scenario | Assert |
|---|----------|--------|
| 1 (keystone, FIRST) | units invariant: mixed add/remove events | `scopeLine[days]===scopeAdded−scopeRemoved` AND `===sumPoints(members)` |
| 2 | stepping: add day 3 (est 5), remove day 5 (est 2) | scopeLine steps at index 2 then 4; day-1→delta[0] |
| 3 | zero events | flat `fill(sumPoints(issues))` |
| 4 | removed-issue key (cycleId=null) | second findMany resolves estimate; net correct |
| 5 | deleted key (findMany empty) | fallback 1 |
| 6 | KPI point-sums | scopeAdded/scopeRemoved = estimate sums, not counts |

Seed `CycleScopeEvent` rows via `mockCycleScopeEventFindMany` (`{day, kind, issueKey}`); issues via `mockIssueFindMany` with `key`+`estimate`. Follow existing B1/R2 pattern.

## Risks / Mitigations

| Risk | Sev | Mitigation |
|------|-----|------------|
| Day-index off-by-one (1-based event.day vs 0-based delta) | Med | Pin D→delta[D-1]; test #2 asserts day-1 lands index 0 |
| KPI count→points = visible behavior change | Med | Intentional consistency; reviewer consciously accepts |
| Current-vs-historical estimate | Low | Accepted approximation; no schema column |
| Extra removed-keys query inflates test mocks | Low | Guard `length>0`; chained `mockResolvedValueOnce` |

## Migration / Rollout

No migration. Pure read-path; works retroactively on existing rows. Rollback = revert the computeBurnup + KPI diff.

## Open Questions

None blocking. Scope-creep risk message (computeRisks:230-241 uses count `scopeNet`) — proposal scopes only message wording; leave count logic unless tasks decide otherwise.
