# Design: KAN-35 — Issue.completedAt & Cycle.closedAt timestamps

## Context

Cycle/lead-time metrics are reconstructed today by scanning `ActivityLog` for
`state_changed→done` on every read (`computeAvgLeadDays`, `computeBurnup`). KAN-35
introduces first-class completion timestamps so metrics read a column, not a log
scan. Additive, nullable, forward-only — honors the additive-never-destructive
constraint. First brick of the `metrics-spine` umbrella in ppm-foundation.

Locked decisions (engram `sdd/kan-35-completion-timestamps/decisions`, #1206):
1. `Cycle.closedAt` historical backfill = NONE → NULL; forward-only in `closeCycle`.
2. `Issue.completedAt` backfill = raw SQL inside the additive migration (done issues only).
3. Clear-on-reopen = unconditional: `toState === 'done' ? new Date() : null` at every site.

## Architecture Approach

No new layers or boundaries. This is a **column-promotion** pattern: a value that
is currently DERIVED on every read (`MAX(activity_log.created_at WHERE to='done')`)
becomes STORED at write time, with a one-time backfill to seed history. The read
sites then trust the column. Pattern mirrors KAN-41's single-source-of-truth move
(`shared/activity-log.ts`), pushing truth to the persistence layer.

**Write rule (single expression, repeated at every transition site):**
`completedAt = toState === 'done' ? new Date() : null`. `done` is the only terminal
state (`ORDERED_STATES = backlog|todo|in_progress|review|done`), so one expression
both sets (entering done) and clears (leaving done = reopen).

---

## 1. Schema Delta — `packages/api/prisma/schema.prisma`

Both fields are nullable, additive, no default. Insert alongside the existing
timestamp fields.

`model Issue` (after line 238, `updatedAt`):
```prisma
  completedAt DateTime?     @map("completed_at")
```

`model Cycle` (after line 334, `updatedAt`):
```prisma
  closedAt  DateTime?  @map("closed_at")
```

Postgres column names follow the existing snake_case `@map` convention.

---

## 2. Migration Plan — additive + in-migration backfill

**Naming convention** (confirmed against repo): timestamped directory
`packages/api/prisma/migrations/<UTCtimestamp>_<snake_name>/migration.sql`. Latest
is `20260608013437_add_issue_subscription_opted_out`. New directory name:
`<timestamp>_add_completion_timestamps` (generate the timestamp at `prisma migrate`
time — do NOT hand-pick). Column add + backfill live in ONE migration directory.
Prisma migrations are forward-only; no down-migration.

`migration.sql` (single file, three statements):
```sql
-- AlterTable: additive nullable columns
ALTER TABLE "issues" ADD COLUMN "completed_at" TIMESTAMP(3);
ALTER TABLE "cycles" ADD COLUMN "closed_at" TIMESTAMP(3);

-- Backfill completed_at for issues currently in done, from their latest
-- state_changed→done activity log. Matches isDoneTransition semantics:
-- canonical { to: 'done' } AND legacy KAN-41 { newValue: 'done' }.
UPDATE "issues" i
SET "completed_at" = (
  SELECT MAX(al."created_at")
  FROM "activity_logs" al
  WHERE al."issue_id" = i."id"
    AND al."action" = 'state_changed'
    AND (al."details" ->> 'to' = 'done' OR al."details" ->> 'newValue' = 'done')
)
WHERE i."state" = 'done';
```

- `Cycle.closedAt` has NO backfill (locked decision #1) — NULL for all historical
  closed cycles. ActivityLog is issue-scoped (no cycle-close event); `updatedAt`
  is clobbered by velocity recompute, so it would lie. NULL is honest.
- Done issues with NO done-log stay NULL (un-backfillable). Readers tolerate NULL
  (see §5).
- Verify the actual Postgres table names before generating (`issues`, `cycles`,
  `activity_logs` per `@map`). Use `prisma migrate dev --create-only` then HAND-EDIT
  the generated SQL to append the backfill UPDATE (Prisma only emits the ALTERs).

### REFINEMENT to locked decision #2 (needs confirmation, not silent override)

The locked SQL filtered only `details->>'to' = 'done'`. But the readers being
switched off (`isDoneTransition` → `readStateChange`) ALSO match the legacy KAN-41
shape `{ newValue: 'done' }`. If the backfill omits the legacy OR, legacy-done
issues become NULL post-backfill and the reader switch would EXCLUDE them from
lead-time / shove them to `endDate` in burnup — a metrics regression that
contradicts "truthful metrics." The backfill SQL above adds
`OR al."details" ->> 'newValue' = 'done'` to preserve parity. This is a refinement
of decision #2's SQL; flag for Marc's confirmation.

---

## 3. Write-Site Design — `packages/api/src/modules/issue/service.ts`

**Decision: inline expression at each site (Approach A), NO shared helper.** The
expression is a single ternary on a value already in scope (`toState`). A helper
would add an import + indirection for zero logic reuse and would NOT reduce the
N-site risk (callers must still remember to pass `completedAt`). The mitigation for
N-site is a comment, not a function (see §7).

### 3a. `transitionIssue` (line 660 — single `update`)
```ts
const updated = await prisma.issue.update({
  where: { key },
  data: {
    state: toState as any,
    // KAN-35 completion-timestamps contract: stamp on entering done, clear on leaving.
    completedAt: toState === "done" ? new Date() : null,
  },
});
```

### 3b. `transitionGroup` (line 780, inside `$transaction`)
### 3c. `batchTransitionByKeys` (line 915, inside `$transaction`)

**Partition NOT needed — justified deviation from the explore's two-updateMany plan.**
Both batch functions resolve a SINGLE `targetState` per call (`targetState as
IssueState`, then `issuesToTransition = issues.filter(i => i.state !== targetState)`).
Every row in the `updateMany` shares the same destination state, hence the same
`completedAt`. A single `updateMany` suffices:
```ts
const updateResult = await tx.issue.updateMany({
  where: { id: { in: issuesToTransition.map((i) => i.id) } },
  // KAN-35: single targetState per call → one completedAt for the whole batch.
  data: {
    state: targetState,
    completedAt: targetState === "done" ? new Date() : null,
  },
});
```
The entering/leaving-done partition described in the task applies only if a single
batch could mix destinations — it cannot here. Document the single-target invariant
in the code comment so a reviewer does not "fix" it back to two updateManys.

---

## 4. closeCycle — `packages/api/src/modules/cycle/service.ts`

Stamp `closedAt` in the existing update (line 509-512), switch the ack source
(line 545).

```ts
const updated = await prisma.cycle.update({
  where: { id },
  data: { state: "done", velocity, closedAt: new Date() }, // KAN-35
});
```
```ts
// line 545 — was: closedAt: updated.updatedAt
closedAt: updated.closedAt,
```
Update the JSDoc at 483-486 (it explicitly anticipates this column — remove the
"no dedicated column" note). No reopen path exists (`CycleState` =
`upcoming|active|done`, no inverse), so `closedAt` never needs clearing.

---

## 5. Reader Switches — `packages/api/src/modules/cycle/service.ts`

### 5a. `computeAvgLeadDays` (line 682) — drop the ActivityLog scan
Replace the two-query pattern (issue SELECT + `activityLog.findMany` + Map build)
with a single issue read of `completedAt`:
```ts
const issues = await prisma.issue.findMany({
  where: { cycleId },
  select: { id: true, createdAt: true, completedAt: true },
});
if (issues.length === 0) return null;
const deltas: number[] = [];
for (const issue of issues) {
  if (!issue.completedAt) continue; // NULL = no completion → excluded (unchanged semantics)
  deltas.push((issue.completedAt.getTime() - issue.createdAt.getTime()) / ONE_DAY_MS);
}
if (deltas.length === 0) return null;
return deltas.reduce((s, d) => s + d, 0) / deltas.length;
```
Deletes the `activityLog.findMany` call and the `lastDoneByIssue` Map. `isDoneTransition`
import may become unused here — verify before removing the import.

### 5b. `computeBurnup` (line 134) — read completedAt, preserve endDate fallback
Drop the `activityLogs` include from the issue query (PERF WIN — no join):
```ts
const issues = await prisma.issue.findMany({
  where: { cycleId },
  select: { id: true, estimate: true, state: true, completedAt: true },
});
...
for (const issue of issues) {
  if (issue.state !== "done") continue;
  const ts = issue.completedAt ?? end; // PRESERVE fallback for NULL (un-backfilled done issues)
  const day = Math.max(0, Math.min(days, Math.round((ts.getTime() - start.getTime()) / ONE_DAY_MS)));
  completedByDay[day] = (completedByDay[day] ?? 0) + (issue.estimate ?? 1);
}
```
The `cycle.endDate` fallback is preserved exactly (`?? end`) so un-backfilled
done issues still appear in burnup (just bucketed at cycle end, as before).

**Callers / blast radius:** `computeBurnup` is internal to `getCycle`; `computeAvgLeadDays`
is called from cycle/dashboard routes (consume a number, unaffected). Dropping the
`activityLogs` include changes only the internal query shape — no API contract change.
`isDoneTransition` / `readStateChange` remain used elsewhere; do not delete from
`shared/activity-log.ts`.

---

## 6. Test Strategy (strict TDD — `vitest run` in packages/api)

Two distinct test files exist; the proposal/explore conflated them. Corrected targets:
- `packages/api/src/modules/cycle/service.test.ts` — `closeCycle` ack test (B9.1).
- `packages/api/src/modules/cycle/__tests__/service.test.ts` — burnup/lead-time
  (B1 line 446, B2 legacy-done line 418).
- `packages/api/src/modules/issue/__tests__/service.test.ts` — transition set/clear.

**Red-first order:**

1. **transitionIssue sets completedAt** (issue/__tests__/service.test.ts): assert the
   `prisma.issue.update` call receives `completedAt: <Date>` when `toState='done'`.
2. **transitionIssue clears on reopen**: `toState='in_progress'` (from done) → assert
   `data.completedAt === null`.
3. **transitionGroup / batchTransitionByKeys**: assert the `updateMany` `data` carries
   `completedAt` correctly for `targetState='done'` (Date) and a non-done target (null).
4. **closeCycle sets closedAt** (cycle/service.test.ts B9.1, lines 392-408): TWO edits —
   (a) the `prisma.cycle.update` mock at 393-398 must now RETURN `closedAt` (add to the
   mocked row), and (b) the assertion at 406-408 flips from `closedAt: updatedAt` to
   `closedAt: <the closedAt the mock returns>`. Also assert the `update` call's `data`
   includes `closedAt`.
5. **computeAvgLeadDays reads completedAt** (__tests__/service.test.ts): rewrite to seed
   `mockIssueFindMany` rows with `completedAt`; DROP `mockActivityLogFindMany` seeding.
6. **computeBurnup reads completedAt** (B1, line 446): the B1 issue-findMany seed (487-497)
   currently nests `activityLogs: [{ details: { from, to: 'done' } }]`. After the switch,
   re-seed with `completedAt: doneAt` (no activityLogs). Same assertions (points bucket
   on day 1) still hold.
7. **B2 legacy-done migration** (line 418): after the reader switch B2 goes VACUOUS — the
   functions no longer read activity logs, so a `{ newValue: 'done' }` log proves nothing.
   The legacy-parity guarantee MOVES to the backfill SQL. Re-purpose B2: either delete it
   from the reader suite and add a backfill data-integrity test (below) that asserts a
   legacy-shape log produces a non-NULL `completed_at`, OR convert B2 to seed `completedAt`
   directly (loses the legacy meaning). RECOMMEND: replace B2 with the backfill test so the
   legacy guarantee is verified where it now lives.

**Backfill test (no migration harness exists):** add a data-integrity test (Vitest,
real or test Postgres if available; otherwise a SQL-logic test). Minimal viable approach:
seed an issue in `done` + two activity logs (`{to:'done'}` and a legacy `{newValue:'done'}`
on a second issue), execute the backfill UPDATE statement (extract it to a runnable
`.sql`/string constant), then assert both issues' `completed_at = MAX(created_at)` and that
a done issue with no done-log stays NULL. If no DB-backed test exists in the suite, gate
this behind the integration tier and at minimum unit-test the SQL's selection logic.

---

## 7. Risk Mitigations

| Risk | Severity | Mitigation |
|---|---|---|
| N-site rule: future 4th transition path forgets completedAt | Med | `// KAN-35 completion-timestamps contract` comment at each of the 3 write sites + this design referenced. Inline (no helper) by decision §3. |
| Backfill NULL gap (done issue, no done-log) | Med | Readers tolerate NULL: `computeAvgLeadDays` skips, `computeBurnup` falls back to `cycle.endDate` (`?? end` preserved). |
| Legacy-done parity lost on reader switch | **High** | Backfill SQL includes `OR details->>'newValue' = 'done'` (§2 refinement); B2 test moves to backfill (§6.7). |
| closeCycle test regression | High | B9.1 mock-return + assertion both updated (§6.4); corrected file is `cycle/service.test.ts`, NOT `__tests__/service.test.ts`. |
| Batch partition over-engineering | Low | Single `updateMany` justified by single-targetState invariant; documented in comment (§3b/c). |

## Out of Scope (per proposal)
MemberRate, Budget, TimeEntry, ProjectReadModel, scheduling, scopeLine (KAN-36),
timeline (KAN-32), SSE (KAN-40).

## ADR-Style Decisions

- **ADR: column-promotion over derived-on-read.** Chosen: store `completedAt` at
  write time. Rejected: keep deriving from ActivityLog (fragile, log-coupled, O(logs)
  per read). Rationale: truthful/auditable stored time; cheap reads; ADR-0003 rollup needs it.
- **ADR: inline ternary, no shared helper.** Chosen: inline at 3 sites. Rejected: shared
  `completionTimestamp(toState)` helper. Rationale: zero logic reuse, helper does not reduce
  N-site risk; comment + design reference is the real mitigation.
- **ADR: single updateMany for batches.** Chosen: one updateMany with batch-wide completedAt.
  Rejected: two updateManys (entering/leaving partition). Rationale: both batch functions
  enforce a single targetState per call — partition is impossible input here.
- **ADR: closedAt NULL for history.** Chosen: forward-only. Rejected: `updatedAt` proxy.
  Rationale: `updatedAt` is clobbered by velocity recompute → lying timestamp; NULL honest.
- **ADR (refinement, needs confirm): backfill matches isDoneTransition (incl. legacy newValue).**
  Chosen: add `OR newValue='done'`. Rejected: locked SQL's `to`-only filter. Rationale: readers
  being switched OFF are legacy-aware; omitting the OR regresses legacy-done metrics.
