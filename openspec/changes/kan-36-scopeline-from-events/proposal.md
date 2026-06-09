# Proposal: KAN-36 — Stepped cycle scopeLine from CycleScopeEvent

## Intent

The cycle burnup chart's `scopeLine` is a FLAT constant (`Array(days+1).fill(sumPoints(currentMembers))`) — today's point total broadcast across every day. It is a lie: it hides mid-cycle scope drift, the exact signal PMs and Directors read the burnup to catch. KAN-36 recomputes `scopeLine` as a points-accurate stepped line from `CycleScopeEvent` history, so the chart truthfully shows when scope grew or shrank. Metrics-spine brick of `ppm-foundation` (sibling of KAN-35 / PR #79 and KAN-41), all touching `computeBurnup`.

## Scope

### In Scope
- Rewrite `scopeLine` in `computeBurnup` — points-stepped, folded from `CycleScopeEvent` via an `issueKey → estimate` join.
- Change scope-drift KPIs `scopeAdded`/`scopeRemoved` from event COUNTS to point-SUMS.
- Update the scope-creep risk message wording to points.
- Unit tests (greenfield) for stepping + invariant.

### Out of Scope
- Prisma schema changes (pure read-path).
- `@kanon/web` changes (verified none — see Affected Areas).
- Other ppm-foundation bricks: KAN-40, KAN-32.
- Backfill / migration (retroactive read over existing rows).

## Capabilities

### New Capabilities
None.

### Modified Capabilities
- `metrics-spine`: `scopeLine` requirement changes from flat-constant to points-stepped from `CycleScopeEvent`; `scopeAdded`/`scopeRemoved` KPI units change from event-count to point-sum.

## Approach

Approach A (settled). In `computeBurnup`, resolve each event's estimate: current members O(1) from `cycle.issues`; removed issues (`cycleId=null`) via one extra `prisma.issue.findMany({where:{key:{in:removedKeys}}})`; deleted/missing → fallback estimate 1 (matches `sumPoints` null→1). Walk events in day order: `event.day` (1-based, write-clamped to `[1,days]`) → `delta[day-1]`; `scopeLine[d]` = cumulative sum of `delta[0..d]`. Initial attaches land at day 1 → `delta[0]` → `scopeLine[0]` = initial scope (not zero). Zero events → flat `fill(sumPoints(currentMembers))` (backward compatible). Invariant: `scopeLine[days] === sumPoints(currentMembers)`.

Crux — units, not counts: `scopeLine` shares the burnup Y-axis in STORY POINTS. A +1/-1 count line is the WRONG UNIT and breaks the invariant. KPIs move to points too, so `scopeAdded - scopeRemoved == scopeLine` delta exactly.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/api/src/modules/cycle/service.ts` `computeBurnup` (~175-179) | Modified | Replace flat `scopeLine` + comment with points-stepped fold + estimate join |
| `packages/api/src/modules/cycle/service.ts` (~315-316) | Modified | `scopeAdded`/`scopeRemoved` count→point-sum; scope-creep message to points |
| `packages/api/src/modules/cycle/__tests__/service.test.ts` | New | scopeLine stepping + invariant tests |
| `@kanon/web` cycles-view.tsx | None | `scopePath` already plots per-day with `L` segments; stepped array renders as-is. `cycle.ts` type is already `number[]` |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Units mismatch (count vs points) | High if wrong approach | Approach A points-join; assert `scopeLine[days] === sumPoints(currentMembers)` |
| Day-index off-by-one (1-based event vs 0-based array) | Med | Fixed mapping `day D → delta[D-1]`; test day-1 attach lands in `delta[0]` |
| Estimate unresolved for removed/deleted issues | Low | findMany for removed; fallback 1 for deleted (matches sumPoints) |
| KPI semantic change count→points is visible behavior change | Med | Intentional consistency choice; reviewer must consciously accept; flagged in risk-message update |

## Rollback Plan

Pure read-path, no migration, no DB writes. Revert the `computeBurnup` + KPI diff — `scopeLine` returns to flat-constant. No data cleanup.

## Dependencies

- `CycleScopeEvent` rows already written by `recordCycleScopeEvent` (exists). No new producer.

## Success Criteria

- [ ] `scopeLine` reflects per-day scope steps from events; `scopeLine[days] === sumPoints(currentMembers)`.
- [ ] `scopeAdded`/`scopeRemoved` are point-sums; `scopeAdded - scopeRemoved` equals net `scopeLine` delta.
- [ ] Zero-event cycles render the prior flat line (backward compatible).
- [ ] No schema, web, or migration changes; api vitest green.
