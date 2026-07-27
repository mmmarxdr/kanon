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
