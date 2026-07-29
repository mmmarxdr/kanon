# Review Ledger — external-pm-integrations

## Judgment Day Round 1 — A1.1 canonical core contracts

- **Target:** `feat/pm-182-types`
- **Reviewed files:** `core/types.ts`, `core/types.test.ts`, and the A1.1 task checkbox
- **Result:** `JUDGMENT: APPROVED`
- **Reason:** The maintainer approved a focused correction round, and both blind judges independently verified all three remediations with no open finding.

| id | lens | location | severity | status | evidence | assessment |
| --- | --- | --- | --- | --- | --- | --- |
| JD-A-001 | judgment-day | `packages/api/src/modules/integrations/core/types.ts:54-64,114` | CRITICAL | verified | Patch fields and the patch argument now require explicit field operations; no-change is all-`omit`, and omitted or `undefined` forms are rejected. | real |
| JD-A-002 | judgment-day | `packages/api/src/modules/integrations/core/types.ts:82-87,110` | CRITICAL | verified | Provider-neutral `DiscoveredCycle` and `listCycles` replace Redmine-specific Version terminology. | real |
| JD-A-003 | judgment-day | `packages/api/src/modules/integrations/core/types.ts:123-155` | CRITICAL | verified | `CanonicalChange` now discriminates entity payloads and restricts delete operations to `value: null`. | real |
| JD-A-004 | judgment-day | `packages/api/src/modules/integrations/core/types.ts:1,16` | WARNING | info | Canonical state aliases generated Prisma types, coupling the core contract to persistence. | real |
| JD-A-005 | judgment-day | `packages/api/src/modules/integrations/core/types.ts:132-143` | WARNING | info | The inbound port exposes polling and timestamp/entity cursor mechanics rather than a fully transport-neutral source contract. | real |
| JD-A-006 | judgment-day | `packages/api/src/modules/integrations/core/types.test.ts:54-163` | WARNING | info | Vitest transpilation and local fixtures do not provide a standalone compile-time contract gate. | real |
| JD-B-001 | judgment-day | `packages/api/src/modules/integrations/core/types.ts:1,16` | WARNING | info | Canonical state directly aliases generated Prisma types. | real |
| JD-B-002 | judgment-day | `packages/api/src/modules/integrations/core/types.ts:54-64` | WARNING | info | With exact optional property types disabled, explicit `undefined` is accepted alongside `omit`, `set`, and `clear`. | real |
| JD-B-003 | judgment-day | `packages/api/src/modules/integrations/core/types.test.ts:19-163` | WARNING | info | Type assertions are erased and tests are excluded from API compilation, so interface regressions may pass. | real |

## Convergence

- Verified BLOCKER/CRITICAL: **3**
- Open BLOCKER/CRITICAL: **0**
- INFO findings: **6**
- Fix rounds used: **1/2**
- Next action: A1.1 is approved; continue to A1.2 only after interactive approval.

## Pre-commit reliability review — A1.1

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R3-001 | reliability | `packages/api/src/modules/integrations/core/types.type-test.ts:14-23` | BLOCKER | verified | The normal API test command runs the no-emit TypeScript contract gate before Vitest; controlled regressions produce TS2578 for unused assertions, and type-test files are excluded from production output. |

- Refutation verdict: **stands**
- Fix rounds used: **1/2**
- Next action: pre-commit reliability gate approved; create the authorized local A1.1 commit.

## Judgment Day Round 1 — A1.2 lifecycle migration

- **Target:** `feat/pm-182-life`
- **Result:** `JUDGMENT: APPROVED`
- **Reason:** The maintainer authorized the focused proof-strengthening fix, and both blind judges independently verified that the isolated upgrade-path test resolves the migration-evidence gap.

| id | lens | location | severity | status | evidence | assessment |
| --- | --- | --- | --- | --- | --- | --- |
| JD-A-101 | judgment-day | `packages/api/prisma/lifecycle.test.ts:272-430` | CRITICAL | verified | The test creates a temporary PostgreSQL schema, deploys repository migrations through `20260626120000_integration_tables`, seeds pre-A1.2 rows, deploys the exact checked-in A1.2 SQL, and asserts row preservation, safe defaults, nullable staging, and Cascade/SetNull FK behavior. Both blind judges verified the resolution. | real |

### Round 1 fix evidence — JD-A-101

- Added an isolated, self-cleaning upgrade-path test; no production schema or migration SQL changed.
- Focused execution passed **6/6** against the worktree's isolated PostgreSQL test service on `localhost:5433`; Prisma validation and the direct test-file type check also passed. Both blind judges verified the fix; one independent rerun was unavailable after the isolated PostgreSQL service had been cleaned up.

- Verified BLOCKER/CRITICAL: **1**
- Open BLOCKER/CRITICAL: **0**
- Suspect findings: **0**
- Fix rounds used: **1/2**
- Next action: run the required pre-commit review for the A1.2 slice before creating its local work-unit commit.

## Incident audit — accidental CodeGraph artifact

- **Target:** `feat/pm-182-life/.codegraph/`
- **Lens:** resilience
- **Result:** `PASS`
- **Ledger:** `[]`
- **Evidence:** The directory contains only an untracked generated index; no tracked file, intended A1.2 artifact, Git configuration, process, symlink, mount, or dependency references it.
- **Cleanup:** Delete only `.codegraph/`; preserve every A1.2 and OpenSpec artifact.

## Pre-commit reliability review — A1.2

- **Lens:** reliability
- **Result:** `PASS`
- **Ledger:** `[]`
- **Evidence:** One exhaustive sweep found no concrete migration-safety, determinism, regression, test-discovery, or work-unit-boundary defect. Prisma validation, formatting, direct lifecycle test type-checking, and diff checks passed; the DB suite retained its prior 6/6 execution evidence.
- **Commit boundary:** Include only the A1.2 schema, migration, lifecycle test, A1.2 task progress, review ledger, and apply-progress files. Exclude copied proposal/design/exploration/spec artifacts and all A1.3+ work.
- **Next action:** The maintainer authorized the local A1.2 work-unit commit; create it without pushing or opening a PR.

## A1.3 environment incident — isolated PostgreSQL access

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R4-001 | resilience | `/var/run/docker.sock:1` | BLOCKER | refuted | The inherited process groups omit Docker GID 989 even though `marc` is already configured as a member. A general refuter confirmed that `sg docker -c '...'` supplies the existing effective group without permission changes and can operate only the project-scoped `postgres-test` service on port 5433. |

- **Incident audit:** Worktree integrity passed; no A1.3 implementation or tracked artifact was modified before the block.
- **Recovery boundary:** Do not use `sudo`, change socket permissions/groups, start the ordinary PostgreSQL service, or connect to unidentified containers. Use only `kanon-pm182-id` / `postgres-test` with the isolated `kanon_e2e` database.
- **Next action:** Await maintainer authorization to start the isolated test service through the least-privilege `sg docker` wrapper, then resume A1.3 strict TDD.

## Judgment Day Round 1 — A1.3 identity and credential health

- **Target:** `feat/pm-182-id`
- **Result:** `JUDGMENT: APPROVED`
- **Reason:** Round 1 remediation added the durable pre-A1.3 upgrade regression, and both blind judges independently verified JD-A-201. JD-B-201 remains a historical WARNING/info row.

| id | lens | location | severity | status | evidence | assessment |
| --- | --- | --- | --- | --- | --- | --- |
| JD-A-201 | judgment-day | `packages/api/prisma/identity.test.ts:278-469` | CRITICAL | verified | The self-cleaning isolated PostgreSQL regression deploys migrations through `20260720_pm_lifecycle_binding`, seeds legacy GCM ciphertext plus member/connection/binding rows, applies the exact checked-in A1.3 SQL, and proves preservation/defaults, both identity uniqueness constraints, binding/member Cascade behavior, and failure cleanup. Both blind judges verified the resolution. | real |
| JD-B-201 | judgment-day | `packages/api/prisma/identity.test.ts:535-634` | WARNING | info | Historical WARNING/info observation: the initial suite covered fresh persistence, uniqueness, Cascade behavior, DMMF shape, and adjacency while the successful isolated upgrade check lived only in apply-progress; JD-A-201 is the sole remediation driver. | real |

- Verified BLOCKER/CRITICAL: **1** (`JD-A-201`)
- Open BLOCKER/CRITICAL: **0**
- INFO findings: **1**
- Fix rounds used: **1/2**
- Next action: run the required A1.3 pre-commit review; do not change JD-B-201's WARNING/info status.

## Pre-commit reliability review — A1.3

- **Result:** `PASS WITH WARNINGS`
- **Refuter required:** No BLOCKER/CRITICAL candidates.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R3-002 | reliability | `openspec/changes/external-pm-integrations/apply-progress.md:13` | WARNING | info | The artifact retains the original “no size exception” forecast although the maintainer approved an A1.3-only 826-line exception; later slices still use the 800-line budget. |
| R3-003 | reliability | `openspec/changes/external-pm-integrations/apply-progress.md:80-86` | WARNING | info | The persisted file list omits `review-ledger.md`, although A1.3 environment/Judgment Day/pre-commit evidence makes it part of the intended six-file commit boundary. |

- **Runtime evidence:** Identity 5/5 and lifecycle 6/6 passed independently; 51 migrations are current; Prisma validation, API/direct type checks, formatting, diff checks, and post-test cleanup checks passed.
- **Commit boundary:** Include only A1.3 schema, migration, identity test, tasks, apply progress, and review ledger. Exclude copied proposal/design/spec artifacts and all A1.4+ work.
- **Next action:** Await explicit maintainer authorization before creating the local A1.3 commit.

## Judgment Day Round 1 — A1.4 durable integration work

- **Target:** `feat/pm-182-work`
- **Result:** `JUDGMENT: APPROVED`
- **Judge A ledger:** `[]`
- **Judge B ledger:** `[]`
- **Evidence:** Both blind judges independently verified the additive migration order, schema/SQL agreement, lane and lease persistence, dedupe constraints, FK actions, index coverage, permanent pre-A1.4 upgrade regression, truthful 791-line boundary, and absence of A1.5+ runtime behavior.

- Confirmed BLOCKER/CRITICAL: **0**
- Suspect findings: **0**
- INFO findings: **0**
- Fix rounds used: **0/2**
- Next action: run the required A1.4 pre-commit review.

## Pre-commit reliability review — A1.4

- **Result:** `PASS WITH WARNINGS`
- **Refuter required:** No BLOCKER/CRITICAL candidates.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R3-004 | reliability | `openspec/changes/external-pm-integrations/apply-progress.md:13` | WARNING | info | Apply progress retains the original no-exception/791-line claim, while the maintainer approved an A1.4-only 805-line boundary after mandatory Judgment Day persistence. |
| R3-005 | reliability | `openspec/changes/external-pm-integrations/apply-progress.md:137-143` | WARNING | info | The persisted A1.4 file list omits `review-ledger.md`, although review evidence makes it part of the approved six-file commit boundary. |

- **Runtime evidence:** Work 6/6 and the permanent upgrade regression passed independently; diff checks and cleanup passed; worktree state remained unchanged.
- **Commit boundary:** Include only A1.4 schema, migration, work test, tasks, apply progress, and review ledger. Exclude copied proposal/design/spec artifacts and all A1.5+ work.
- **Next action:** Await explicit maintainer authorization before creating the local A1.4 commit.

## Judgment Day Round 1 — A1.5 inbound application and conflicts

- **Target:** `feat/pm-182-app`
- **Result:** `JUDGMENT: APPROVED`
- **Reason:** The maintainer-authorized wording correction was independently verified by both blind judges. Judge B's historical WARNING/info rows remain unchanged and non-blocking.

| id | lens | location | severity | status | evidence | assessment |
| --- | --- | --- | --- | --- | --- | --- |
| JD-A-401 | judgment-day | `openspec/changes/external-pm-integrations/apply-progress.md:180` | CRITICAL | verified | The corrected cumulative statement documents application-row persistence/verification and preservation of prior credential/identity/reference/work rows; conflict persistence is separately attributed to a fresh-schema database test. Both blind judges verified the wording. | real |
| JD-B-401 | reliability | `packages/api/prisma/application.test.ts:477-521` | WARNING | info | Binding Cascade is not exercised while an application still exists because the test deletes the application before deleting its binding. | theoretical |
| JD-B-402 | judgment-day | `openspec/changes/external-pm-integrations/apply-progress.md:180` | WARNING | info | Conflict persistence is covered separately, but the upgrade helper persists only an application while progress says it persists both. | real |

- Verified BLOCKER/CRITICAL: **1** (`JD-A-401`)
- Open BLOCKER/CRITICAL: **0**
- INFO findings: **2**
- Fix rounds used: **1/2**
- Next action: run the required A1.5 pre-commit review; keep `JD-B-401` and `JD-B-402` as WARNING/info rows.

## A1.5 coordination incident — unintended KAN-182 comment

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R4-002 | resilience | `openspec/changes/external-pm-integrations/review-ledger.md:148-164` | WARNING | info | A fix actor posted an unintended KAN-182 status comment without returning its ID/body. Repository integrity is intact, but the external comment remains unaudited because current tools cannot list or delete comments. |

- **Recovery:** Inspect KAN-182 activity in the UI and remove the unintended comment if possible; otherwise post a transparent correction before publishing further automated status updates.
- **Review isolation:** Scoped blind re-judgment may proceed using only the worktree diff and canonical ledger. Do not consume or publish Kanon comments during that pass.

## Pre-commit reliability review — A1.5

- **Result:** `PASS WITH WARNINGS`
- **Refuter required:** No BLOCKER/CRITICAL candidates.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R3-006 | reliability | `openspec/changes/external-pm-integrations/apply-progress.md:182` | WARNING | info | Apply progress reports the pre-ledger 741-line boundary; the intended six-file boundary before this review record is 768/800. |
| R3-007 | reliability | `openspec/changes/external-pm-integrations/apply-progress.md:185-191` | WARNING | info | The A1.5 file list omits `review-ledger.md`, although its Judgment Day and R4-002 incident sections belong to the intended commit. |

- **Runtime evidence:** Application 5/5 passed independently; 53 migrations are current; validation, formatting, diff checks, and cleanup probes passed without changing worktree state.
- **Commit boundary:** Include only A1.5 schema, migration, application test, tasks, apply progress, and review ledger. Exclude copied proposal/design/spec artifacts, A1.6+, and Kanon comments.
- **Next action:** Await explicit maintainer authorization before creating the local A1.5 commit.

## A1.6 split boundary — core slice

- **Target:** `feat/pm-182-backfill-core -> feat/pm-182-app`
- **Result:** `SPLIT BOUNDARY RECORDED — no A1.6 final review verdict`
- **Scope:** The core child contains only deterministic tenant-safe ExternalRef ownership resolution, diagnostics, idempotent null-only binding updates, transaction rollback, and a transaction-snapshot result.
- **Follow-up:** `feat/pm-182-backfill -> feat/pm-182-backfill-core` owns the omitted advisory/writer gate, cooperating-writer postconditions, concurrency evidence, and final immutable proof required to complete A1.6.
- **Boundary note:** This neutral entry does not carry forward the preserved full-WIP A1.6 findings or final status as evidence for the core child.

## Judgment Day Round 1 — A1.6a core

- **Target:** `feat/pm-182-backfill-core`
- **Result:** `JUDGMENT: APPROVED`
- **Judge A ledger:** `[]`

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| JD-B-601 | reliability | `openspec/changes/external-pm-integrations/apply-progress.md:211` | WARNING | info | The TDD row says GREEN 6/6 while the same artifact and independently rerun core suite establish 7/7. |

- **Evidence:** Both judges verified deterministic tenant-safe ownership resolution, diagnostics, idempotency, rollback, truthful snapshot-only semantics, no gate/runtime scope, and the 799-line implementation boundary.
- **Overall A1.6 status:** Incomplete; A1.6b remains mandatory.
- **Next action:** Run the A1.6a pre-commit review.

## Pre-commit risk review — A1.6a

- **Result:** `PASS WITH WARNINGS`
- **Refuter required:** No BLOCKER/CRITICAL candidates.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R1-001 | risk | `openspec/changes/external-pm-integrations/apply-progress.md:222` | WARNING | info | A1.6a evidence includes the loopback test PostgreSQL URL with default `kanon/kanon` credentials. It is test-scoped but reusable on shared hosts. |

- **Evidence:** Core 7/7 passed independently; tenant isolation, redacted diagnostics, guarded updates, deterministic ordering, rollback/idempotency, unwired snapshot semantics, and the 813-line approved boundary were verified.
- **Commit boundary:** Include only core backfill source/test, split tasks, A1.6a progress, and review ledger. Exclude planning copies, preserved WIP, A1.6b, and later work.
- **Next action:** Await explicit maintainer authorization for the local A1.6a commit.

## Judgment Day Round 1 — A1.6b final gate

- **Target:** `feat/pm-182-backfill`
- **Result:** `JUDGMENT: APPROVED`
- **Reason:** The maintainer-authorized encapsulation removed the caller-owned proof bypass, and both blind judges independently verified JD-A-701.

| id | lens | location | severity | status | evidence | assessment |
| --- | --- | --- | --- | --- | --- | --- |
| JD-A-701 | judgment-day | `packages/api/src/modules/integrations/backfill.ts:216-256` | CRITICAL | verified | The caller-owned helper is no longer exported; the executor is module-internal, and only transaction-owning APIs return after final validation and their owned commit. Both blind judges verified the public-contract and rollback/concurrency evidence. | real |

- Judge B ledger: `[]`
- Confirmed BLOCKER/CRITICAL: **0**
- Suspect CRITICAL: **0**
- Verified BLOCKER/CRITICAL: **1** (`JD-A-701`)
- INFO findings: **0**
- Fix rounds used: **1/2**
- Next action: run the required A1.6b pre-commit review.

### Round 1 remediation — JD-A-701

- **Status:** `verified`.
- **Fix:** Removed the public `backfillExternalRefBindingsInTransaction` escape path and kept the transaction-scoped implementation module-internal.
- **Evidence:** Rollback/composition and two-client concurrency tests now use only the owned APIs; the public module-contract test asserts that the unsafe helper is absent.
- **Focused result:** Backfill suite passed **15/15** after the required RED failure.
- **Next action:** pre-commit review.

## A1.6b apply boundary

- **Target:** `feat/pm-182-backfill -> feat/pm-182-backfill-core`
- **Result:** `APPLY SLICE COMPLETE — no review verdict`
- **Scope:** Stable transaction-scoped PostgreSQL advisory gate, owned writer transaction, shared ExternalRef invariant validator, backfill final proof, deterministic cooperating multi-client tests, and the A1.7+ caller obligation until B1 hardening.
- **Out of scope:** Schema/migrations, A1.7+, provider/runtime/routes/UI/live Redmine, preserved WIP status, and pre-verified review findings.
- **Next action:** Run the normal verification/review phase for this child slice.

## Pre-commit risk review — A1.6b

- **Result:** `PASS WITH WARNINGS`
- **Refuter required:** No BLOCKER/CRITICAL candidates.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R1-002 | risk | `openspec/changes/external-pm-integrations/apply-progress.md:6` | WARNING | info | Apply progress still says Judgment Day is pending although the ledger records approval and JD-A-701 verified. |
| R1-003 | risk | `openspec/changes/external-pm-integrations/apply-progress.md:256` | WARNING | info | Apply progress records the pre-remediation 607-line boundary; the final five-file boundary before this review record is 657/800. |

- **Runtime evidence:** Backfill 15/15 and regressions 22/22 passed independently; tenant invariants, owned transactions, postconditions, rollback/lock release, public API, deterministic concurrency, and diff checks passed.
- **Commit boundary:** Include only A1.6b source/test, final task/progress updates, and review ledger. Exclude planning copies, preserved WIP, A1.7+, and comments.
- **Next action:** Await explicit maintainer authorization for the local A1.6b commit.

## Judgment Day Round 1 — A1.7 transactional outbox capture

- **Target:** `feat/pm-182-outbox -> feat/pm-182-backfill`
- **Result:** `JUDGMENT: APPROVED`
- **Reason:** Both fresh blind judges independently verified both Round 1 fixes using only the persisted ledger and the scoped fix patch; Judge A reran the focused gates and Judge B recommended approval.
- **Review boundary:** 778 changed lines, within the maintainer-approved 800-line budget.
- **Skill resolution:** `paths-injected` for both judges.

| id | lens | location | severity | status | evidence | assessment |
| --- | --- | --- | --- | --- | --- | --- |
| JD-A-801 | judgment-day | `packages/api/src/modules/integrations/outbox.ts:98-140` | CRITICAL | verified | Round 1 validates authoritative binding, entity, ExternalRef, and credential ownership before the transaction-scoped upsert; both fresh blind judges verified the fix. | real |
| JD-A-802 | judgment-day | `packages/api/src/modules/integrations/outbox.ts:23,98-101,118-131` | CRITICAL | verified | Round 1 derives epoch from the binding and rejects any supplied stale or future value before persistence; both fresh blind judges verified the fix. | real |
| JD-A-803 | judgment-day | `packages/api/src/modules/integrations/outbox.ts:27-31,49-55` | WARNING | info | Supplying conflicting `correlationId` and `localMutationCorrelationId` values silently selects one alias, making capture identity ambiguous and allowing retries/call-site spreads to dedupe or split work unexpectedly. Both judges independently reported the ambiguity. | real |
| JD-B-804 | judgment-day | `packages/api/src/modules/integrations/outbox.ts:160-165` | WARNING | info | One judge observed that an empty `bindingId` is treated as no filter because scan filtering uses truthiness, potentially widening an invalid scoped scan to every binding. | real |
| JD-B-805 | judgment-day | `packages/api/src/modules/integrations/outbox.ts:43-60` | WARNING | info | One judge observed that raw textual UUID casing feeds the hashes even though PostgreSQL UUID equality is case-insensitive, so casing variants could produce different dedupe/lane keys for the same identifiers. | theoretical |

- Confirmed BLOCKER/CRITICAL: **2** (`JD-A-801`, `JD-A-802`)
- Open BLOCKER/CRITICAL: **0**
- Verified BLOCKER/CRITICAL: **2** (`JD-A-801`, `JD-A-802`)
- INFO findings: **3**
- Fix rounds used: **1/2**
- Adversarial verification: satisfied by two-judge convergence; no refuter fan-out applies to Judgment Day.
- Evidence: focused A1.7 suite passed **6/6** and the targeted regression set passed **27/27**, including the new invalid-ownership and stale/future-epoch contracts.
- Scoped re-judgment: both fresh blind judges independently verified both fixed findings using only the persisted ledger and `/tmp/opencode/kanon-a1-7-round1-fix.patch`; Judge A independently ran A1.7 **6/6** and the focused outbox/backfill/work set **27/27**, and Judge B recommended approval.
- Judge-output normalization: the second judge returned the wrong `JD-A` prefix; its independently matching evidence was used for convergence, and its unique INFO rows were persisted with `JD-B` identifiers.
- Next action: run the required A1.7 pre-commit review gate; no commit, push, PR, or public comment is allowed before that gate.

### Round 1 remediation — JD-A-801 / JD-A-802

- `outbox.ts` now resolves binding/project/connection ownership, local entity ownership, exact ExternalRef identity, and credential connection/tenant membership inside the caller transaction; invalid combinations reject before `upsert`.
- Caller epochs must equal the authoritative binding epoch; omitted epochs derive from that binding value.
- `outbox.int.test.ts` covers cross-project/binding/connection/tenant identifiers, no-row rejection, rollback, and stale/future epochs. Focused **6/6** and regression **27/27** passed.
- No schema, migration, writer, worker, scheduler, provider, route, UI, commit, push, PR, or public comment was added.

## Pre-commit risk review — A1.7
- **Event:** `pre-commit`; **Lens:** `review-risk`; **Result:** `PASS`
- **Ledger:** `[]`
- **Evidence:** One exhaustive sweep reviewed the complete intended five-file A1.7 boundary against exact base `5bf6d31`, including the two untracked new source/test files, and found no concrete security, tenant-isolation, credential/reference-linkage, data-loss, transaction-integrity, scanner-scope, or artifact-truthfulness defect. Read-only; no fix/refuter required.
- **Commit boundary:** Final **786/800**; exact five-file scope: `packages/api/src/modules/integrations/outbox.ts`, `packages/api/src/modules/integrations/outbox.int.test.ts`, `openspec/changes/external-pm-integrations/tasks.md`, `openspec/changes/external-pm-integrations/apply-progress.md`, `openspec/changes/external-pm-integrations/review-ledger.md`.
- **Exclusions:** Copied planning artifacts `design.md`, `proposal.md`, and `specs/**` are excluded.
- **Next action:** Await explicit maintainer authorization for the local commit.

## Pre-push risk review — A1.7
- **Event:** `pre-push`; **Lens:** exactly one `review-risk` sweep; **Result:** `PASS WITH WARNINGS`

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R1-004 | review-risk | `packages/api/src/modules/integrations/outbox.ts` | CRITICAL | refuted | An unlocked binding read/write interleaving is possible, but A1.7 performs no claim or provider I/O; the later worker must recheck active state and matching epoch immediately before I/O, owned by A4.2/A4.3. A stale queued row remains audit/history, not stale dispatch or lost work. |
| R1-005 | review-risk | `openspec/changes/external-pm-integrations/apply-progress.md` | WARNING | info | Staged apply-progress still described pre-commit as next while the ledger already recorded it as passed; retain canonical WARNING/info and do not treat it as a fix cycle. |

- **Refutation:** Exactly one general refuter returned `refuted` for R1-004; no BLOCKER/CRITICAL remains open and no fix round is required.
- **Boundary:** Final **798/800**.
- **Next action:** Create the already-authorized local commit and push the branch to origin; no PR/comment.

## Judgment Day Round 1 — A1.8 issue transaction composition

- **Target:** `feat/pm-182-tx -> feat/pm-182-outbox`
- **Result:** `JUDGMENT: APPROVED`
- **Reason:** Both fresh blind judges independently verified the two Round 1 fixes: mandatory capture is owned and awaited before commit, and capture identity is bound to the authoritative issue.
- **Initial review boundary:** 302 changed lines, within the maintainer-approved 800-line budget.
- **Skill resolution:** `paths-injected` for both judges.

| id | lens | location | severity | status | evidence | assessment |
| --- | --- | --- | --- | --- | --- | --- |
| JD-A-901 | judgment-day | `packages/api/src/modules/integrations/issue-tx.ts:19-86` | CRITICAL | verified | The owned helper now requires callback capture material, invokes A1.7 capture itself, awaits it, and returns only after mandatory capture; omitted material is runtime-rejected and rolls back the local mutation. | real |
| JD-A-902 | judgment-day | `packages/api/src/modules/integrations/issue-tx.ts:8,66-83` | CRITICAL | verified | The helper now accepts authoritative issue identity, omits entity identity from capture material, and injects `entityType: "issue"`/`entityId: issueId`; runtime redirection captures the authoritative issue. | real |

- Confirmed BLOCKER/CRITICAL: **2** (`JD-A-901`, `JD-A-902`)
- Open BLOCKER/CRITICAL: **0**
- Verified BLOCKER/CRITICAL: **2** (`JD-A-901`, `JD-A-902`)
- INFO findings: **0**
- Fix rounds used: **1/2**
- Adversarial verification: satisfied by two-judge convergence; no refuter fan-out applies to Judgment Day.
- Evidence before the fix was A1.8 focused **4/4**, inherited regressions **21/21**, and combined **25/25**; the pre-fix suite did not enforce mandatory capture or bind mutation identity to capture identity. Round 1 focused **7/7**, inherited regressions **21/21**, and combined **28/28** now pass.
- Judge-output normalization: the second judge again returned the wrong `JD-A` identity; its independently matching evidence was used for convergence.
- Scoped re-judgment: both fresh blind judges independently verified `JD-A-901` and `JD-A-902`; Judge A independently ran A1.8 **7/7**, A1.7 **6/6**, and A1.6 **15/15**, for inherited regressions **21/21** and combined **28/28**. Valid commit/result, callback rollback, capture rollback, idempotency, and lifecycle epoch behavior remain covered; no A1.9 writer wiring leaked.
- Next action: run the required A1.8 pre-commit review gate; do not run global verify or begin A1.9 implementation yet.

### Round 1 remediation — JD-A-901 / JD-A-902

- **Status:** `verified` — the overall Judgment Day result is `JUDGMENT: APPROVED` after the scoped Round 1 re-judgment.

## Pre-commit reliability review — A1.8

- **Event:** `pre-commit`; **Lens:** `review-reliability`; **Initial result:** `FAIL`; **Terminal pre-commit result:** `ESCALATED` after the failed scoped re-review for fix round 2/2
- **Initial review boundary:** 464/800 changed lines.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R3-008 | reliability | `packages/api/src/modules/integrations/issue-tx.ts:70-80` | CRITICAL | open | Final scoped re-review **FAIL/ESCALATE**: arrays with custom prototypes can hide inherited transaction thenables/accessors outside own-descriptor inspection; the validated result remains mutable while capture is awaited and is cloned only afterward, allowing post-validation mutation/escape. |
| R3-009 | reliability | `packages/api/src/modules/integrations/issue-tx.ts:28-44` | CRITICAL | open | Final scoped re-review **FAIL/ESCALATE**: the capture payload is validated once but read again from the mutable capture object during spread; accessors can replace it, and `structuredClone` accepts non-JSON structures, leaving a validation/use gap. |

- **Adversarial verification:** The single required general refuter returned `stands` for both R3-008 and R3-009.
- **Initial open BLOCKER/CRITICAL:** **2**
- **Current fix state:** **2 CRITICAL findings open** after the failed scoped re-review; terminal escalation.
- **Fix rounds used:** **2/2 exhausted; no third round.**
- **Next action:** Maintainer re-scope/manual decision; no commit, push, or A1.9.
- **Fix:** `withIssueMutationTx` now owns the full sequence: it runs the local operation, validates the runtime `{ result, capture }` outcome, injects the authoritative issue identity, awaits A1.7 `captureIntegrationWorkTx`, and only then returns the useful result for transaction commit.
- **RED:** The three new contract tests were written before the production edit; the pre-fix focused run failed **7/7** against the old optional-capture callback API, including the mandatory-capture rollback and identity-redirection cases.
- **GREEN/TRIANGULATE:** Focused A1.8 **7/7**, A1.7/A1.6 regressions **21/21**, and combined **28/28** passed. Coverage retains successful commit, callback-error rollback, invalid-reference rollback, lifecycle epoch, mandatory await, malformed/missing capture rollback, and authoritative identity behavior.
- **Checks:** API type gate, direct no-emit type-check for both seam files, Prettier, and `git diff --check` passed. No schema, migration, writer, worker, scheduler, provider, route, UI, commit, push, PR, or public comment changed.
- **Scoped re-review input:** `/tmp/opencode/kanon-a1-8-round1-fix.patch` plus this persisted ledger only; the original A1.8 full diff is excluded.

### Scoped pre-commit fix round 1/2 — R3-008 / R3-009

- **Status:** `fixed` — not verified; the pre-commit result remains **pending scoped re-review**.
- **R3-008:** `withIssueMutationTx` recursively inspects supported object/array result structures for thenables without invoking them, rejects before A1.7 capture, and preserves settled Prisma results including `Date` values. `IssueMutationTxResult<T>` rejects nested `PromiseLike` values at compile time where practical.
- **R3-009:** capture payload validation accepts nested JSON objects/arrays/scalars and rejects `Map`, `Set`, promises, functions, symbols, bigint, undefined members, non-finite numbers, cycles, and unsupported prototypes before A1.7 capture.
- **RED:** Three behavior-first tests were added before the production edit; the pre-fix focused run was **7/10 passed, 3/10 failed** because the old seam resolved nested transaction promises and a `Map` payload instead of rejecting.
- **GREEN/TRIANGULATE:** Focused A1.8 **10/10**, A1.7/A1.6 regressions **21/21**, and combined **31/31** passed. The new coverage exercises nested object and array thenables, rollback of the issue mutation/outbox row, malformed `Map` rollback, and existing successful Prisma issue results with dates.
- **Checks:** API type gate, direct no-emit type check for both seam files, Prettier, and `git diff --check` passed. No schema, migration, writer, worker, scheduler, provider, route, UI, commit, push, PR, or public comment changed.
- **Fix-round boundary:** **798/800** changed lines: the persisted Round 1 boundary was 464/800; round 2 adds 65 changed lines with no size exception.
- **Round 2/2 evidence:** RED **10/12**; GREEN A1.8 **12/12**, A1.7/A1.6 **21/21**, combined **33/33**; type gate and diff checks passed; the final scoped re-review **FAIL/ESCALATE** result leaves R3-008/R3-009 **open**. Prettier **failed** on both A1.8 source/test files. Current boundary: **798/800**. Convergence is exhausted; no third round, commit, push, or A1.9. Patches: `/tmp/opencode/kanon-a1-8-precommit-r1-fix.patch`, `/tmp/opencode/kanon-a1-8-precommit-r2-fix.patch`.

## Corrective design Judgment Day — A1.8 split

- **Target:** 42-line amendment splitting A1.8 into contract and transaction-seam slices.
- **Result:** `JUDGMENT: APPROVED` after scoped fix round **1/2**.
- **Confirmed CRITICAL:** Both judges verified that the canonical returned Issue row is now the sole capture-identity source for create, update, and transition.

| id | lens | location | severity | status | evidence | assessment |
| --- | --- | --- | --- | --- | --- | --- |
| JD-A-1001 | judgment-day | `openspec/changes/external-pm-integrations/design.md:42,46` | CRITICAL | verified | A1.8b no longer accepts an independent `issueId`; both judges verified that capture derives only from the canonical returned row's `result.id`. | confirmed |
| JD-B-1001 | judgment-day | `openspec/changes/external-pm-integrations/design.md:42,46,57` | CRITICAL | verified | Both judges verified create-time identity propagation through the canonical persisted Issue row. | confirmed |
| JD-A-1002 | judgment-day | `openspec/changes/external-pm-integrations/design.md:38,52-57` | CRITICAL | verified | Both judges verified the explicit no-apply gate until `sdd-tasks` replaces obsolete branch/dependency rows. | suspect |
| JD-A-1003 | judgment-day | `openspec/changes/external-pm-integrations/design.md:52-55` | CRITICAL | verified | Both judges verified credible 340/360-line forecasts below the 400-line chained-review threshold. | suspect |
| JD-B-1002 | judgment-day | `openspec/changes/external-pm-integrations/design.md:42` | CRITICAL | verified | Both judges verified `estimate` in the narrow detached capture projection and strict-TDD matrix. | suspect |
| JD-B-1003 | judgment-day | `openspec/changes/external-pm-integrations/design.md:38,50-57` | WARNING | info | Tasks still reference the failed single-slice chain; synchronize them in the planned `sdd-tasks` phase. | real |
| JD-B-1004 | judgment-day | `openspec/changes/external-pm-integrations/design.md:50-55` | WARNING | info | Per-slice forecasts exceed 400 despite no recorded size exception. | real |

- Verified BLOCKER/CRITICAL: **1 merged confirmed issue** (`JD-A-1001`/`JD-B-1001`).
- Verified maintainer-authorized suspect corrections: **3** (`JD-A-1002`, `JD-A-1003`, `JD-B-1002`); suspect provenance is preserved.
- INFO findings: **2** (`JD-B-1003`, `JD-B-1004`) — canonical WARNING/info, unchanged and not re-reviewed.
- Fix rounds used: **1/2**.
- Resolved by the amendment: mandatory awaited capture, detached one-time canonical payload forwarding, non-generic settled Issue-row result, authoritative result-derived identity for create/update/transition, estimate projection coverage, and separation of pure contract from DB transaction orchestration.
- Both fresh blind judges verified all five authorized rows from only the persisted ledger and design fix patch; overall design judgment is **`JUDGMENT: APPROVED`**.

### Scoped design fix round 1/2 — maintainer-authorized corrections

- **Status:** The five authorized CRITICAL rows above are `verified`. No implementation or task artifact was changed.
- **Identity:** A1.8b no longer accepts caller-supplied `issueId`; the awaited operation returns the canonical persisted Issue row, and `result.id` is the sole source used to construct/inject `entityType: "issue"` and `entityId`. Create-generated, update, and transition identities therefore use the same returned-row contract without an independent equality check.
- **Capture completeness:** `estimate` is now an explicit supported field/value projection member and remains in the exact detached canonical Issue payload; the projection remains narrow and rejects an arbitrary JSON graph.
- **Payload/result safety:** The non-generic settled Issue-row contract, one-time detached canonical payload derivation, exact-once forwarding, never-re-read caller-owned data rule, and mandatory awaited A1.7 capture are preserved.
- **Delivery:** Forecasts are reduced to **340** lines for A1.8a and **360** for A1.8b, each below the 400-line threshold with no size exception. The chain remains `feat/pm-182-issue-contract` from `feat/pm-182-outbox`, followed by `feat/pm-182-issue-tx-seam` from the contract branch.
- **Task gate:** The current `tasks.md` remains intentionally non-authoritative until the next `sdd-tasks` phase replaces the old A1.8/A1.9 branch and dependency rows. No apply may start before that synchronization.
- **Warnings:** `JD-B-1003` and `JD-B-1004` remain canonical WARNING/info and are never marked fixed or re-reviewed.
- **Next action:** Run `sdd-tasks` to synchronize A1.8a/A1.8b branch boundaries and make A1.9 depend on A1.8b before any apply work.

## A1.8a apply slice — historical pre-cancel record

- **Target:** `feat/pm-182-issue-contract -> docs/pm-182-a1-8-rescope` from exact `6feeec1b10c6b49560583fc18d14c31c255d02df`
- **Result:** `APPLY SLICE COMPLETE — historical pre-cancel record`
- **Scope:** Pure Issue-row/canonical-payload boundary only; no transaction, database, writer, provider, worker, route, UI, schema, or migration behavior.
- **Evidence:** Historical pre-cancel contract oracle **20/20** and inherited core/types **5/5**; the 20/20 result is not current proof. Copied planning context is untracked and excluded.
- **Boundary:** Historical pre-cancel boundary **327/400**; the final reconciled boundary and maintainer exception are recorded below.
- **Next action:** Superseded by the current maintainer-exception reconciliation. A1.8b remains unchecked and must not start from this apply result alone.

## Judgment Day Round 1 — A1.8a correction

- **Target:** `feat/pm-182-issue-contract -> docs/pm-182-a1-8-rescope`; initial boundary **327/400**; terminal result remains **`ESCALATED — maintainer exception`**.

| id | lens | location | severity | status | evidence | assessment |
| --- | --- | --- | --- | --- | --- | --- |
| JD-A-1101 | judgment-day | target source/test | BLOCKER | fixed | Initial direct no-emit failed TS2532/TS4111; target gate now passes. | confirmed |
| JD-B-1101 | judgment-day | target source/test | CRITICAL | fixed | Judge B independently confirmed the same compile-gate defect. | confirmed |
| JD-A-1103 | judgment-day | target source/test | CRITICAL | fixed | Initial forced Prettier failed; explicit no-ignore formatting now passes, with the final boundary covered by the accepted exception. | suspect |
| JD-A-1102 | judgment-day | target source | WARNING | info | Callable/accessor `Date.prototype.then` remains theoretical. | theoretical |
| JD-A-1104 | judgment-day | target test | WARNING | info | Invalid-Date and negative type assertions remain out of scope. | real |
| JD-B-1102 | judgment-day | target source | WARNING | info | Frozen Date internal slots remain mutable. | real |
| JD-B-1103 | judgment-day | target source | WARNING | info | `exactOptionalPropertyTypes` remains disabled; runtime rejects undefined. | real |

### Scoped correction evidence — round 1/2

- **Status:** JD-A-1101/JD-B-1101 and authorized JD-A-1103 remain **fixed, not verified**; warnings unchanged; overall terminal state remains **`ESCALATED — maintainer exception`**, round **1/2**.
- **RED:** direct repository-option no-emit reported TS2532/TS4111; forced `prettier --check --ignore-path /dev/null` reported both files unformatted; configured `test:types` excludes them.
- **GREEN/proof:** Current contract **2/2**, core/types **5/5**, direct target no-emit, forced Prettier, and `git diff --check` passed; the configured `test:types` result is supplementary. Target test assigns `ReturnType<typeof canonicalizeIssueMutationDraft>`.
- **Boundary/next:** final additions/deletions and the accepted `size:exception` are recorded in the current reconciliation below; copied planning files excluded, with no commit/push/PR/comment/Kanon tracking/A1.8b.

## A1.8a resilience incident — maintainer exception reconciliation

| id | lens | severity | status | refuter | evidence |
| --- | --- | --- | --- | --- | --- |
| R4-003 | resilience | CRITICAL | wont-fix | stands | Final boundary exceeds the hard 400-line target; the maintainer accepted the measured A1.8a `size:exception` for commit. |
| R4-004 | resilience | CRITICAL | wont-fix | stands | Current focused coverage is reduced to **2/2**; the maintainer accepted the historical **20/20** coverage gap as follow-up debt. |
| R4-005 | resilience | WARNING | info | — | Current recursion has no depth bound; unchanged and non-blocking. |
| R4-006 | resilience | CRITICAL | fixed | stands | Conflicting current completion, test, and budget claims are reconciled by this section; not independently re-reviewed. |

- **Current gates:** contract **2/2**, core/types **5/5**, direct target TypeScript **PASS**, forced Prettier with `--ignore-path /dev/null` **PASS**, and `git diff --check` **PASS**.
- **Judgment Day at A1.8a close:** terminal state remains **`ESCALATED — maintainer exception`**; fixed rows remain unverified. A1.8b had not started yet.

## Bounded reliability review — A1.8b

- **Result:** `PASS WITH WARNINGS`, then one fix pass; no BLOCKER/CRITICAL and no refuter required.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R3-010 | reliability | `issue-tx.int.test.ts` success case | WARNING | verified | Capture assertions now cover direction, operation, actor key, and actor kind. |
| R3-011 | reliability | `issue-tx.int.test.ts` success case | WARNING | verified | Create, update, and transition now target three distinct Issue IDs. |
| R3-012 | reliability | `issue-tx.int.test.ts` mutation case | WARNING | verified | A transaction proxy mutates the caller draft deterministically at A1.7's first binding read; detached return and payload remain unchanged. |

- Post-fix focused suite **3/3**, direct source/test TypeScript, Prettier, and diff checks passed. No second review cycle was run.

## Bounded reliability review — A1.9

- **Result:** `PASS WITH WARNINGS`; no BLOCKER/CRITICAL/HIGH, fix pass, refuter, or second review cycle.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R3-013 | reliability | `issue-writers.test.ts` actor coverage | WARNING | info | Human same-connection credential is proven; AI, missing-credential, and competing-credential cases remain unexpanded test coverage. |
| R3-014 | reliability | `issue-writers.test.ts` nullable update coverage | WARNING | info | Title update is proven; explicit nullable-field clears remain unexpanded test coverage. |

- Focused A1.9 **2/2**, issue service regressions **49/49**, inherited PM integration database suites **24/24**, API type/build, changed-file Prettier, and diff checks passed.

## Bounded reliability review — A1.10

- `R3-001` BLOCKER fixed: expected-state CAS now excludes concurrent no-ops from mutation, audit, capture, events, and returned keys.
- Post-fix A1.10 **2/2**, unit **59/59**, inherited integration **28/28**, event **13/13**, API type/build, formatting, and diff checks passed; no second review loop.

## Bounded reliability review — A1.11

- `R3-001..003` BLOCKERs fixed: close(done) is a true no-op; all create/close paths transact before resolving binding; Path B, rollback, payload, attribution, `refId`, and binding-race cases are executable.
- Post-fix A1.11 **2/2**, Cycle unit **42/42**, inherited integration **31/31**, API type/build, formatting, and diff checks passed; no second review loop.

## Bounded reliability review — A1.12

- `R3-001` BLOCKER fixed: executable `buildApp()` lifecycle coverage proves `onReady` starts scanning and `onClose` cancels the pending timer.
- The scheduler also proves no overlapping scans, continued scheduling after scan or `onError` failure, `unref()`, and idempotent stop behavior.
- Post-fix A1.12 **4/4**, outbox regression **6/6**, app cleanup lifecycle **4/4**, API build/type checks, formatting, and diff checks passed; no second review loop.

## Bounded risk review — A2.1

- **Result:** `PASS AFTER ONE FIX`; one CRITICAL finding, no BLOCKER, no refuter, and no second review loop.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R1-001 | risk | `packages/api/src/modules/integrations/providers/redmine/http-client.ts` IPv6 blocklist | CRITICAL | verified | The initial guard omitted deprecated site-local `fec0::/10`. A new test failed **19/20**, the range was blocked, and the final suite passed **20/20**. |

- The final guard rejects URL credentials, non-HTTPS without opt-in, IPv4/IPv6 loopback/private/link-local/unspecified/reserved/metadata-capable targets, unsafe mixed DNS answers, rebinding, and hostname substitution after pinning.
- API build/type gates, direct source/test TypeScript, formatting, and diff checks passed. Actual requests, disabled redirects, retries, authentication, and dispatcher wiring remain A2.2 scope.

## Direct bounded resilience review — A2.2

- **Result:** `PASS AFTER ONE FIX`; no usable subagent result and no second review loop.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R4-001 | resilience | `packages/api/src/modules/integrations/providers/redmine/http-client.ts` request timeout boundary | CRITICAL | verified | The initial timeout started after DNS resolution, allowing a hung resolver to block indefinitely. The timer now starts before resolution; a fake-clock hanging-DNS test proves timeout rejection and zero credential-bearing transport calls. Final A2.2 **7/7**, inherited A2.1 **20/20**. |

- The review confirms per-attempt DNS validation and pinning, fresh dispatcher cleanup, disabled redirects, bounded idempotent retries, no blind POST retry, redacted status errors, and full DNS/connect/body timeout coverage.
- A delegated resilience review was cancelled after an excessive wait without returning findings. No subagent remained active; direct review replaced it.
- API build/type gates, direct source/test TypeScript, formatting, dependency checks, and diff checks passed. Provider behavior remains A2.3 scope.

## Direct bounded resilience review — A2.3

- **Result:** `PASS WITH WARNINGS` after one fix; no subagent and no second review loop.

| id | lens | location | severity | status | evidence |
| --- | --- | --- | --- | --- | --- |
| R4-002 | resilience | `packages/api/src/modules/integrations/providers/redmine/adapter.ts` workflow fallback | WARNING | verified | Initial fallback retried without status after any 4xx. It now applies only to Redmine's 422 validation response; a 401 regression proves one terminal attempt. |
| R4-003 | resilience | `RedmineProviderAdapter.listProjects` | WARNING | info | Discovery reads one 100-row page. This covers the known 46-project instance; paginate when a deployment exceeds 100 visible projects. |
| R4-004 | resilience | Redmine response mapping | WARNING | info | Typed response shapes are not runtime schemas. Malformed responses throw before returning a provider result; add schemas if real provider drift appears. |

- Final evidence: A2.3 **4/4**, inherited A2.2/A2.1 **27/27**, API build/type gates, direct source/test TypeScript, formatting, and diff checks passed.
- Scope remains provider-only; persistence and lifecycle wiring begin at A3.1.

## Public PR review — cumulative A1.1–A2.3

- **Result:** Six confirmed findings fixed locally; five findings rejected after direct validation. Remote CI and re-review remain pending.

| id | location | status | evidence |
| --- | --- | --- | --- |
| CR-001 | lifecycle migration | not actionable | The warning assumes a heavily populated `external_refs` table, but no shipped runtime producer writes these new integration rows. Rewriting the generated migration for a speculative zero-downtime rollout is not justified. |
| CR-002 | backfill write gate | not actionable | The only production caller is the one-time backfill itself; no normal writer performs the claimed full-table scan. Scope the check when a runtime caller actually adopts this temporary gate. |
| CR-003 | canonical issue patch types | fixed | Required `title`, `status`, and `progress` now exclude `clear`; three compile-time regressions enforce the contract. |
| CR-004 | settled Issue row key list | not actionable | The current list exactly matches the Prisma scalar payload. The finding describes a possible future schema edit, not a current truncation bug. |
| CR-005 | JSON canonicalization | fixed | JSON recursion is capped at 100 levels and a 101-level graph now rejects before stack exhaustion. |
| CR-006 | outbox lifecycle epoch | fixed | Capture locks the binding row with parameterized `FOR SHARE` before deriving/stamping the epoch; a concurrent lifecycle update is proven blocked until commit. |
| CR-007 | outbox duplicate capture | fixed | Empty-update Prisma upsert was replaced by `createMany({ skipDuplicates: true })` plus authoritative lookup; concurrent duplicate transactions retain one row. |
| CR-008 | Redmine status write map | fixed | A requested unmapped status now fails before provider I/O instead of returning a false success. |
| CR-009 | Redmine 422 fallback | not actionable | The retry removes only `status_id`; every other field remains, so an assignee/version/custom-field error still fails on the second request rather than being swallowed. |
| CR-010 | writer correlation IDs | not actionable | Each service invocation is a new local mutation and the API exposes no caller idempotency key. Reusing a deterministic key would suppress legitimate repeated mutations. |
| CR-011 | batch no-op response | fixed | Both zero-transition paths now return `keys: []`, matching the actually transitioned subset convention. |

- RED evidence: required-field `@ts-expect-error` directives were unused; three unit regressions failed; and the PostgreSQL lifecycle update completed before capture commit.
- GREEN evidence: API build, configured type gate, tracked-tree formatting, and full API coverage passed; focused core/contract/outbox/adapter/issue suites passed **50/50**. Remote full CI and re-review remain pending.
