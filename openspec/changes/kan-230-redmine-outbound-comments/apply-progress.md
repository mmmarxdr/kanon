# Apply Progress: KAN-230 Redmine Outbound Comments

## Status

**PR3 complete — outbound Redmine comment capture is atomic, verified, and dark by default.** The full recognition, dispatch, and capture chain is ready for review without enabling production traffic.

## Completed Tasks

- [x] 1.1 **RED:** Canonical marker parser tests.
- [x] 1.2 **GREEN:** Canonical parser and binding/parent/UUID/work-validated inbound echo recognition.
- [x] 1.3 **REFACTOR/verify:** Inert-slice boundary and required verification.
- [x] 2.1 **Gate:** Production wiring and both normal/ambiguous pre-lease gates fit safely within the review budget.
- [x] 2.2 **RED:** One-write transport, complete proof, dark gating, and ambiguity reconciliation tests failed before implementation.
- [x] 2.3 **GREEN:** Provider contracts, Redmine transport/proof, worker fences, dispatch, and reconciliation implemented.
- [x] 2.4 **REFACTOR/verify:** Dispatch defaults off; focused tests, full API suite, typecheck, and build pass.
- [x] 3.1 **Gate:** Connection → binding lock order validated and amended before code.
- [x] 3.2 **Gate:** Parent issue proof remains in immutable payload; `work.refId` remains available for the comment ref.
- [x] 3.3 **RED:** Eligible/inactive links, reserved markers, ownership, and real-database lock order covered before implementation.
- [x] 3.4 **GREEN:** Atomic comment/activity/work capture and parent issue lane implemented without reopening PR1/PR2 boundaries.
- [x] 3.5 **REFACTOR/verify:** Capture defaults off; focused tests, full API suite, typecheck, and build pass.

## PR3 Boundary

- `INTEGRATION_COMMENT_CAPTURE_ENABLED` defaults to `false`; disabled capture creates only the existing comment and activity records.
- Eligible capture locks and revalidates connection → binding before inserting comment, activity, and work in one transaction.
- The immutable payload snapshots body/hash/timestamp, parent proof, binding epoch, credential version, and remote actor; `work.refId` stays null until PR1 attaches the remote comment ref.
- Work uses the parent issue lane. Reserved outbound markers create a durable conflict instead of dispatchable work.
- PR1 owns convergent echo attachment and PR2 owns provider dispatch; PR3 does not duplicate or reopen either path.
- Product/test changed lines: **249**, within the **≤399** PR limit.

## PR3 TDD and Verification

- RED: capture, snapshot, lock-order, reserved-marker, and ownership assertions failed before production implementation.
- GREEN focused: environment, comment service, outbox integration, inbound, and retry coverage — **139 tests passed**.
- Full API: **184 files / 2,404 tests passed; 3 skipped**.
- `test:types` and API build passed.
- Pre-commit risk review returned an empty ledger with no reportable defect.

## PR2 Boundary

- `INTEGRATION_COMMENT_DISPATCH_ENABLED` defaults to `false` and excludes normal and ambiguous comment work before leasing.
- Redmine receives at most one blind PUT; completion requires one journal matching parent issue, exact marker, stripped-body SHA-256, and captured remote actor.
- Missing or indeterminate proof becomes `ambiguous`; one later read-only reconciliation either finalizes the same comment or creates a durable conflict.
- Comment body, timestamp, parent reference, binding epoch, and credential snapshot are fenced before provider I/O.
- Product/test changed lines: **399**, at the **≤399** PR limit.

## PR2 TDD and Verification

- RED: `putOnce` and `pushComment` were absent; comment work was leased/dead and enabled dispatch never ran.
- GREEN focused: HTTP, adapter, worker, and production wiring — **4 files / 83 tests passed**.
- Full API: **184 files / 2,396 tests passed; 3 skipped**.
- `test:types`, API build, Prettier, and `git diff --check` passed.
- Pre-commit risk review found one CRITICAL 429 retry path; strict RED/GREEN changed uncertain 429 outcomes to read-only ambiguity reconciliation. Scoped re-review verified it resolved with no fix-line defects.
- Post-PR review found that excluded comments could still block later same-lane work. Strict RED/GREEN now excludes comments from both claim candidates and earlier-work barriers; claims/worker passed **59/59**, typecheck passed, and scoped risk re-review returned an empty ledger.
- Reliability review then found missing negative proof and pre-I/O fence coverage. Adapter decoys plus worker tests now reject incomplete/mismatched proof, prove zero provider I/O for stale capture, and assert durable `superseded`/`dead` outcomes; the focused claims/adapter/http/worker suite passed **92/92** and both BLOCKERs were verified resolved.

## PR3 Pre-Code Gates

- JD-003 initially BLOCKED: inserting comment/activity first takes issue `KEY SHARE` and can deadlock with inbound holding binding while waiting for issue `FOR UPDATE`.
- Corrected design locks and revalidates connection → binding before any comment/activity/work insert; scoped blind re-review passed.
- JD2-002 confirmed `work.refId` belongs to the synchronized comment, not its parent. Parent issue proof remains only in immutable payload until attachment.
- PR1 rollback compatibility was fixed in `5e3077a`; payload-only echoes now lock/revalidate work, reject open conflicts, and store the comment ref.
- Rollback now drains or manually resolves all comment work before reverting PR2. Both blind gate re-reviews passed.

## PR1 Boundary

- No outbound comment capture, provider dispatch, Redmine write path, migration, feature flag, or PR2/PR3 work was added.
- An echo attaches only when the current binding, exact parent issue `ExternalRef`, canonical final marker/local UUID, matching outbound `comment/create` work, and original comment ownership all validate.
- A copied/spoofed marker without matching local work cannot attach the original comment or complete work.
- Product/test changed lines: **333 additions, 0 deletions** (OpenSpec and `.codegraph/` excluded), within the **≤399** PR limit.

## TDD Cycle Evidence

| Task | Test File / Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR | Result |
|---|---|---|---|---|---|---|---|
| 1.1 | `providers/redmine/comment-marker.test.ts` / Unit | N/A (new) | Missing-module test invocation failed before production implementation | Marker suite passed **3/3** | Canonical stripped body plus uppercase, misplaced, malformed, multiple, and reserved-marker paths | Pure parser remained small and deterministic | Complete |
| 1.2 | `inbound.test.ts` / Integration | Existing inbound behavior protected by a **35/35** baseline | Initial valid/copied-marker cases plus four expected pre-commit fix failures were written before production changes | Final inbound suite passed **41/41** | Valid states (`leased`, `ambiguous`, `done`), invalid states, copied markers, and already-mapped comments exercise distinct paths | Recognition isolated in `persistInboundCommentsTx()` with explicit proof-state and local-mapping guards | Complete |
| 1.3 | API focused + full verification / Integration | Focused combined suite passed **44/44** | N/A | `test:types` passed; full suite passed | Parser and inbound paths both included | Verified no capture/dispatch/write path was introduced | Complete |

## Verification Results

- Focused: `pnpm --dir packages/api exec vitest run src/modules/integrations/providers/redmine/comment-marker.test.ts src/modules/integrations/inbound.test.ts` — **2 files passed; 44 tests passed** (marker 3/3, inbound 41/41).
- Required full: `pnpm --dir packages/api run test` — **exit code 0**.
  - Typecheck: passed.
  - Vitest: **184 test files passed; 2,391 tests passed; 3 skipped; 2,394 total**.
  - Duration: **350.01s**.

## Pre-Commit Fix Round 1

- Reliability review confirmed that a second marked journal could collide with an existing local `ExternalRef`, and that pre-I/O/terminal work states could incorrectly authorize recognition.
- Strict TDD added already-mapped-journal and work-state coverage before production changes; RED produced four expected failures.
- Recognition now requires an unmapped local comment and work state `leased`, `ambiguous`, or `done`.
- Scoped reliability re-review verified both CRITICAL findings resolved with no fix-line defect.

## Post-PR Rollback Compatibility Fix

- PR3 gate analysis confirmed `work.refId` must remain null until the comment `ExternalRef` is attached; the parent issue ref stays only in immutable payload.
- Strict RED reproduced duplicate inbound import for payload-only leased, ambiguous, and done work.
- Echo recognition now locks work, revalidates exact payload parent proof and no open conflict in a fresh statement, and atomically stores the comment ref while completing work.
- Expanded proof matrix passes **13/13**: payload-only success, all allowed states, each wrong parent field, open conflict, invalid states, altered body, existing mapping, and copied marker.
- Reliability review resolved two BLOCKERs and one CRITICAL; scoped re-review found no remaining fix-line defect.

## Historical Recovery Notes

- The original oversized two-PR plan was blocked before source changes to preserve JD-001/JD-002 and the 399-line limit.
- The approved PR1 scope is the smaller inert marker-recognition slice; its complete proof remains within the review budget.

## Remaining Tasks

- None.

## Risks

No open PR1/PR2/PR3 implementation risks. Both capture and dispatch remain off by default and require an explicit staged rollout.
