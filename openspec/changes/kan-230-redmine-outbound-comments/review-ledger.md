# Judgment Day Review Ledger: KAN-230

## Review State

- Target: `openspec/changes/kan-230-redmine-outbound-comments/design.md`
- Round: 2
- Review mode: two blind judges
- Skill resolution: `paths-injected`
- State: terminal

## Findings

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JD-001 | judgment-day | `design.md:20-22,26` | CRITICAL | verified | Both scoped re-judges verified that immediate lookup and later reconciliation require exactly one match across remote parent, exact marker, marker-stripped body hash, and captured remote actor; unproved results cannot finalize. |
| JD-002 | judgment-day | `design.md:44,48` | CRITICAL | verified | Both scoped re-judges verified independent capture/dispatch controls, recognition-first rollout, and rollback that preserves marker recognition, inbound polling, and unrelated integration work. |
| JD-003 | judgment-day | `design.md:5,28` | CRITICAL | info | Suspect from Judge A only: creating the comment before taking the binding lock may invert the established binding-before-domain lock order and deadlock against inbound work. This did not converge and is not approved for automatic fixing. |
| JD-004 | judgment-day | `design.md:19,28` | WARNING | info | Theoretical: credential ID plus millisecond-resolution `lastValidatedAt` may not distinguish concurrent replacements that change encrypted material within the same timestamp. Warnings never drive fixes. |

## Synthesis

- Confirmed CRITICAL: 2
- Suspect CRITICAL: 1
- INFO warnings: 1
- Fix rounds used: 1 of 2
- Re-judgment: both blind judges approved; no fix-line findings
- JUDGMENT: APPROVED ✅

## Round 2 — Three-PR Delivery Amendment

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JD2-001 | judgment-day | `design.md:44-50,58` | CRITICAL | verified | Both scoped re-judges verified that the delivery boundary distinguishes root-to-leaf review order (PR1, PR2, PR3) from leaf-to-root final accumulation (PR3 → PR2 → PR1 → tracker → `main`) and preserves distinct merge boundaries so rolling back PR3, then PR2, retains PR1 recognition. |
| JD2-002 | judgment-day | `design.md:19` | CRITICAL | info | Suspect from Judge B only: `IntegrationSyncWork.refId` currently represents the synchronized entity's own reference and capture rejects a parent issue ref, so the parent ref may belong only in immutable payload until the comment ref is attached. Not approved for automatic fixing. |
| JD2-003 | judgment-day | `design.md:47-48,56-58` | CRITICAL | info | Suspect from Judge B only: dispatch-off semantics must be wired into production configuration and gate both normal and ambiguous comment claims before leasing; the design currently names booleans without those exact seams. Not approved for automatic fixing. |

### Round 2 Synthesis

- Confirmed CRITICAL: 1
- Suspect CRITICAL: 2
- Fix rounds used for this amendment: 1 of 2
- Re-judgment: both blind scoped judges verified JD2-001; no fix-line BLOCKER/CRITICAL findings
- JUDGMENT: APPROVED ✅

## PR1 Apply — Marker Recognition

- Target: PR1 product/test diff in `comment-marker.ts`, `comment-marker.test.ts`, `inbound.ts`, and `inbound.test.ts`
- Round: 1
- Review mode: two blind judges, one exhaustive sweep each
- Product/test scope: 222 additions, 0 deletions
- Skill resolution: `paths-injected`

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| JD-PR1-001 | judgment-day | `packages/api/src/modules/integrations/inbound.ts:429-441` | CRITICAL | refuted | Judge A suspected that omitting `epoch: binding.lifecycleEpoch` could match stale work. Narrow lifecycle triage refuted user impact: epoch fences pre-I/O dispatch, while exact marker/binding/parent/comment/work proof intentionally permits post-I/O reconciliation across lifecycle rotation. Adding the predicate would break effectively-once recovery and could import the proven echo as a duplicate. |

### PR1 Apply Synthesis

- Confirmed BLOCKER/CRITICAL: 0
- Refuted CRITICAL: 1
- INFO warnings/suggestions: 0
- Fix rounds used: 0 of 2
- Judge A: suspected a missing lifecycle-epoch predicate
- Judge B: approved with an empty ledger
- Triage: refuted; cross-epoch recognition is the intended proven post-I/O recovery path, while PR1 remains production-inert
- PR1 remains inert and within the 399-line limit
- JUDGMENT: APPROVED ✅ — no code fix required

## PR1 Pre-Commit Review

- Tier: standard
- Lens: reliability
- Sweep: 1 of 1
- General refutation: RR-001 and RR-002 stand
- Commit readiness: NOT READY pending verified fixes

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| RR-001 | reliability | `packages/api/src/modules/integrations/inbound.ts:407-466` | CRITICAL | verified | Resolved in fix round 1: recognition checks for an existing local `ExternalRef`, and a second marked journal is imported normally without violating entity uniqueness. Scoped re-review verified the regression test and fix-touched lines. |
| RR-002 | reliability | `packages/api/src/modules/integrations/inbound.ts:429-470` | CRITICAL | verified | Resolved in fix round 1: recognition is whitelisted to `leased`, `ambiguous`, and `done`; queued and terminal pre-I/O states cannot authorize attachment or be rewritten. Scoped re-review verified the state tests and fix-touched lines. |
| RR-003 | reliability | `packages/api/src/modules/integrations/providers/redmine/comment-marker.ts:4,13-20` | WARNING | info | The parser accepts a non-standalone final marker separator. This is informational and does not drive fix work. |

- Fix rounds used: 1 of 2
- Scoped re-review: RR-001 and RR-002 verified resolved; no fix-line findings
- Validation: focused 44/44; full API typecheck and 184 files / 2,391 tests passed, 3 skipped; exit 0
- Commit readiness: READY

## PR1 Pre-Push Review

- Tier: standard
- Lens: reliability
- Sweep: 1 of 1
- Findings: empty ledger; no reportable reliability defect
- Validation evidence reviewed: focused 44/44; full API typecheck and 184 files / 2,391 tests passed, 3 skipped
- Push readiness: READY

## PR1 Pre-PR Review

- Tier: standard
- Lens: reliability
- Sweep: 1 of 1
- Findings: empty ledger; no user-impacting reliability defect
- Remote boundary: exactly four product/test files, 333 additions, zero deletions
- PR readiness: READY

## PR1 Post-PR Rollback Compatibility Review

- Lens: reliability
- Scope: payload-only parent proof, work locking, conflict races, and final comment-ref attachment

| id | severity | status | evidence |
|---|---|---|---|
| R3-001 | BLOCKER | verified | Done work now stores the attached comment ref; leased, ambiguous, and done tests begin with null `refId` and end with the comment ref. |
| R3-002 | CRITICAL | verified | Work is locked, then exact payload/state/no-conflict proof is revalidated in a fresh READ COMMITTED statement before attachment. |
| R3-003 | BLOCKER | verified | The matrix independently rejects wrong issue, parent ref, remote issue, open conflicts, and invalid states. |

- Validation: echo matrix 13/13; API typecheck passed
- Commit readiness: READY

## PR2 Pre-Commit Risk Review

- Tier: standard
- Lens: risk
- Sweep: 1 of 1
- Product/test scope: 399 changed lines

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| R1-001 | risk | `packages/api/src/modules/integrations/providers/redmine/adapter.ts:526-530` | CRITICAL | verified | Initial review found HTTP 429 became retry and could issue another blind PUT. Strict RED/GREEN now maps 429, 5xx, and non-HTTP outcomes to `ambiguous`; scoped re-review verified only read-only reconciliation follows and found no fix-line defect. |

- Validation: focused 83/83; full API typecheck and 184 files / 2,396 tests passed, 3 skipped; build and formatting pass
- Commit readiness: READY

## PR2 Post-PR Reliability Reviews

| id | lens | location | severity | status | evidence |
|---|---|---|---|---|---|
| CR-PR2-001 | reliability | `packages/api/src/modules/integrations/claims.ts:28-43` | MAJOR | verified | Excluded comments are now omitted from both claim candidates and earlier same-lane barriers. A real-database regression failed before the query fix and passes after it. |
| RR-PR2-002 | reliability | `packages/api/src/modules/integrations/providers/redmine/adapter.test.ts:77-106`, `packages/api/src/modules/integrations/retry.test.ts:283-337` | BLOCKER | verified | Decoy journals, incomplete immediate proof, and wrong-actor reconciliation cannot finalize comment work; exact proof still converges to `done`. |
| RR-PR2-003 | reliability | `packages/api/src/modules/integrations/retry.test.ts:320-328` | BLOCKER | verified | Stale body, parent, and credential snapshots make zero provider calls and durably become `superseded`, `dead`, and `dead` respectively. |

- Validation: claims/adapter/http/worker **92/92**; API typecheck, Prettier, and `git diff --check` passed
- Product/test scope remains exactly 399 changed lines
- Scoped risk re-review: empty ledger; no reportable fix-line defect
- Push readiness: READY

## PR3 Pre-Code Gate Review

| id | initial verdict | final verdict | evidence |
|---|---|---|---|
| JD-003 | BLOCK | PASS | Capture now locks/revalidates connection → binding before comment/activity FKs can lock issue; inbound and worker use the same prefix. |
| JD2-002 | BLOCK | PASS | Parent ref remains in immutable payload; PR1 `5e3077a` recognizes payload-only work, stores comment `refId`, rejects open conflicts, and rollback drains work before PR2 removal. |

- Review mode: two blind scoped judges
- Apply gate: OPEN for PR3 implementation

## PR3 Pre-Commit Risk Review

- Tier: standard
- Lens: risk
- Sweep: 1 of 1
- Product/test scope: 249 changed lines
- Findings: empty ledger; no reportable security, privilege-boundary, data-exposure, dependency, or merge-blocking defect
- Validation: focused 139/139; full API typecheck and 184 files / 2,404 tests passed, 3 skipped; build passed
- Commit readiness: READY
