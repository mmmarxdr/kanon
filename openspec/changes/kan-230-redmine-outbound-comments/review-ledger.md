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
