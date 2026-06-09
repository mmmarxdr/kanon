# Verify Report: KAN-36 — Stepped cycle scopeLine from CycleScopeEvent

**Change**: kan-36-scopeline-from-events
**Branch**: feat/kan-36-scopeline-from-events
**Commit**: d3fd637
**Date**: 2026-06-09
**Verdict**: FAIL

---

## Test Run Evidence

```
Test Files  2 passed (2)   [unit tests: service.ts + __tests__/service.test.ts]
Tests       43 passed (43)
Duration    557ms
```

15 failures in `routes.test.ts` are pre-existing DB-integration failures
(`cycles.closed_at` column missing — unrelated to KAN-36, unchanged from main).

---

## Diff Scope (Checkpoint 8)

```
packages/api/src/modules/cycle/__tests__/service.test.ts  +440 lines
packages/api/src/modules/cycle/service.test.ts            +27  lines
packages/api/src/modules/cycle/service.ts                 +110 lines
```

No schema migrations, no web changes. Checkpoint 8: PASS.

---

## Spec Compliance Matrix

| Scenario | Requirement | Test | Status |
|----------|-------------|------|--------|
| S3 KEYSTONE — points not counts | scopeLine[0]===13, scopeLine[days]===19 | KAN-36 S3 | PASS |
| S7 Day-index mapping | day=D event → first reflected at scopeLine[D-1] | KAN-36 S7 | PASS |
| S1 Add step | 10-pt + add est=4 day=5 → scopeLine[4..10]===14 | KAN-36 S1 | PASS |
| S2 Remove step | 10-pt + remove est=3 day=7 → scopeLine[6..10]===7 | KAN-36 S2 | PASS |
| S4 Removed key resolution | KEY-99 est=7 via findMany; deleted → fallback 1 | KAN-36 S4 | PASS |
| S5 Zero-events fallback | fill(sumPoints) length days+1 | KAN-36 S5 | PASS |
| S6 KPI invariant | scopeAdded=4, scopeRemoved=2; invariant holds | KAN-36 S6 | PASS |
| REQ computeRisks — points wording | scope-creep message MUST reflect points not counts | NO TEST | FAIL |

---

## Issues

### CRITICAL — Task 2.13: computeRisks scope-creep message NOT converted to points

**Location**: `packages/api/src/modules/cycle/service.ts` lines 293–301

**Evidence** (source read, confirmed):
```typescript
// Comment claims "count→points" but code still does .length
const scopeNetCount =
  scopeEvents.filter((e) => e.kind === "add" && e.day >= 2).length -
  scopeEvents.filter((e) => e.kind === "remove" && e.day >= 2).length;
// ...
detail: `+${scopeNetCount} net issues added since planning (mid-cycle drift).`,
```

The variable is named `scopeNetCount`, uses `.length` (event count), and the message
says "net **issues** added" — not points. Only the `day >= 2` baseline-exclusion half
of task 2.13 was implemented. The points-conversion half was not.

**Spec requirement** (MUST):
> "The scope-creep risk message in `computeRisks` MUST reflect points, not counts."

**Why tests don't catch this**: B6.4 only asserts the risk is *absent* (all events are
removes → net drift negative → no scope-creep fires). No test asserts the message
content or that a points value is used when the risk *does* fire. The gap is real and
undetected by the current suite.

**Apply-progress**: marked 2.13 as `[x]` complete — incorrect. Task is half-complete.

**Required fix**:
1. Use `estMap` from `computeBurnup` (which is already returned and used by `getCycle`)
   to sum points for mid-cycle adds/removes instead of counting events.
2. Update message to say "net points added" or similar.
3. Add a test asserting the `detail` string contains a points value when scope-creep fires.

---

### SUGGESTION — B6.4 fixture has events at days >14 in a 14-day cycle

The B6.4 fixture uses 30 remove events at days 1..30 inside a cycle spanning
2026-04-20 to 2026-05-04 (14 days). Days 15..30 exceed `totalDays`, violating the
spec's "pre-clamped to [1, totalDays]" precondition. The test still passes because
B6.4 only asserts `scopeAdded/scopeRemoved` counts and risk absence — not the KPI
invariant. S6 uses a valid fixture and asserts the invariant correctly.

Non-blocking. Consider constraining the B6.4 fixture to valid day values in a follow-up.

---

## Task Completion

| Phase | Tasks | Status |
|-------|-------|--------|
| Phase 1 — Foundation | 1.1, 1.2 | COMPLETE |
| Phase 2 — RED tests | 2.1–2.7 | COMPLETE |
| Phase 2 — GREEN impl | 2.8–2.12 | COMPLETE |
| Phase 2 — computeRisks | **2.13** | **INCOMPLETE** (half-done) |
| Phase 3 — Verification | 3.1–3.4 | Partially complete (3.1 passes but 2.13 gap means spec not fully met) |
| Phase 4 — PR prep | 4.1–4.2 | COMPLETE |

---

## Summary

1 CRITICAL, 0 WARNINGS, 1 SUGGESTION.

The `computeRisks` scope-creep rule still measures event counts, not point-sums. This
is a spec MUST, tracked as task 2.13 which was prematurely marked complete. All other
requirements are correctly implemented and covered by passing tests. Fix 2.13 and add
a covering test before archive.
