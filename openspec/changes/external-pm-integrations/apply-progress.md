# Apply Progress — external-pm-integrations

## Status

- Current work unit: **A1.8a — Issue mutation contract**
- State: **accepted for commit under maintainer `size:exception`; Judgment Day terminal state: `ESCALATED — maintainer exception`** — historical failed A1.8 evidence remains preserved below
- Branch: `feat/pm-182-issue-contract`
- Worktree: `/srv/workspace/projects/kanon/.claude/worktrees/pm-182-issue-contract`
- Base: `docs/pm-182-a1-8-rescope` at `6feeec1b10c6b49560583fc18d14c31c255d02df` (functional ancestor `de988c638acef374cebb86caac1c7996196f5eec`)
- Intended PR target: `docs/pm-182-a1-8-rescope`
- Delivery: feature-branch chain
- Mode: strict TDD
- Review budget: 400 changed lines; feature-branch chain; final A1.8a result has a maintainer-approved `size:exception`
- Maintainer-approved migration correction: A1.3 uses `20260721_pm_identity_health`; A1.2 remains unchanged; A1.4 uses `20260722_pm_work_outbox`; A1.5 uses `20260723_pm_inbound_application_conflict`.

## Completed Tasks

- [x] A1.1 — Canonical PM integration contracts (`f505a2a`)
- [x] A1.2 — Lifecycle, project binding, staged ExternalRef metadata, and additive migration
- [x] A1.3 — External identity mappings, credential health fields, and additive migration
- [x] A1.4 — Durable integration sync work/outbox persistence and additive migration
- [x] A1.5 — Inbound application/conflict persistence and additive migration
- [x] A1.6a — Deterministic tenant-safe ExternalRef binding backfill core
- [x] A1.6b — Transaction-scoped ExternalRef writer gate and final invariant proof (Judgment Day re-judgment pending)
- [x] A1.7 — Transactional integration-work capture, idempotent lane keys, rollback evidence, and read-only due-work scanner
- [x] A1.8a — Pure Issue-row/canonical-payload contract; final `size:exception` is recorded below

## A1.2 Implementation

- Added provider-neutral connection and binding lifecycle fields with draft-safe defaults.
- Added `IntegrationProjectBinding` with project/remote-project uniqueness, cursor, lease, and fence fields.
- Added nullable binding/version metadata to `ExternalRef` for staged migration.
- Added additive migration `20260720_pm_lifecycle_binding` without drops or renames.
- Added an isolated pre-A1.2 → A1.2 PostgreSQL upgrade-path test covering row preservation, defaults, nullable staging, `SetNull`, and `Cascade` behavior.

## Verification

- Focused lifecycle suite: **6/6 passed** against the isolated PostgreSQL test service.
- Prisma schema validation: **passed**.
- API type tests and direct lifecycle test type-check: **passed**.
- Prettier and `git diff --check`: **passed**.
- Judgment Day Round 1: `JD-A-101` verified independently by both blind judges.
- Final A1.2 verdict: **JUDGMENT: APPROVED**.

## A1.3 Implementation

- Added `CredentialAuthStatus(unknown, valid, invalid, revoked)`.
- Added nullable credential validation/revocation timestamps and an `unknown` health default.
- Added binding-scoped `IntegrationExternalIdentity` with nullable remote login, member/binding Cascade relations, and both approved uniqueness constraints.
- Added additive migration `20260721_pm_identity_health`; the committed A1.2 migration remains unchanged.
- Applied the maintainer-approved forward-only migration naming correction so Prisma orders `20260720_pm_lifecycle_binding` immediately before `20260721_pm_identity_health`.

## A1.3 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| A1.3 | `packages/api/prisma/identity.test.ts` | Prisma DMMF + DB integration | ✅ A1.2 lifecycle baseline 6/6 | ✅ Upgrade test written first; initial helper-gap failure was test-only and no production failure was manufactured | ✅ 5/5 passed after adding the permanent regression harness | ✅ Legacy ciphertext/default backfill, two identity rows, both uniqueness paths, both Cascade paths, and migration adjacency | ✅ Self-cleaning harness follows the established isolated lifecycle-test pattern |

### A1.3 Test Summary

- A1.3 tests written: **5**; focused identity suite: **5/5 passed**.
- Regression evidence: lifecycle **6/6**, mention schema **28/28**, canonical core **5/5**, API type gate passed.
- Layers used: Prisma DMMF contract assertions, PostgreSQL persistence/constraint tests, and migration-order evidence.
- Approval tests: None — A1.3 adds a new persistence contract.
- Pure functions created: None.

## A1.3 Verification

- `sg docker -c 'id && docker version'` — passed using existing Docker group membership.
- Project-scoped `postgres-test` — healthy; `pg_isready` accepted connections on port 5433.
- Fresh `DATABASE_URL=...127.0.0.1:5433/kanon_e2e... pnpm --filter @kanon/api run db:migrate` — applied 51 migrations in order, with A1.2 immediately before A1.3.
- Repeat `db:migrate` — no pending migrations.
- `pnpm --filter @kanon/api run db:generate` — passed.
- `DATABASE_URL=... pnpm --filter @kanon/api exec vitest run prisma/identity.test.ts` — **5/5 passed**.
- Permanent isolated pre-A1.3 → A1.3 upgrade-path regression (the fifth identity test) — **passed**; it deploys repository migrations through `20260720_pm_lifecycle_binding`, seeds a legacy GCM ciphertext plus member/connection/binding rows, applies the exact checked-in `20260721_pm_identity_health` migration, and asserts ciphertext/default preservation, both identity uniqueness constraints, and binding/member Cascade behavior with `finally` cleanup.
- `DATABASE_URL=... pnpm --filter @kanon/api exec vitest run prisma/lifecycle.test.ts` — **6/6 passed**.
- `DATABASE_URL=... pnpm --filter @kanon/api exec vitest run prisma/__tests__/mention-schema.test.ts` — **28/28 passed**.
- `DATABASE_URL=... pnpm --filter @kanon/api exec vitest run src/modules/integrations/core/types.test.ts` — **5/5 passed**.
- `pnpm --filter @kanon/api run test:types` — passed.
- Direct no-emit type check for `identity.test.ts` and `lifecycle.test.ts` — passed.
- `prisma validate` — passed.
- Prettier checks for changed code/artifacts and `git diff --check` — passed.
- `prisma migrate diff` reported only pre-existing unrelated drift in `milestone_deliverables`, `milestones`, and `time_entries`; no A1.3 identity/health drift was reported.
- Temporary schemas/test rows were cleaned; the isolated `kanon-pm182-id` PostgreSQL service remains running and healthy.

## A1.3 Files in This Work Unit

- `packages/api/prisma/schema.prisma`
- `packages/api/prisma/migrations/20260721_pm_identity_health/migration.sql`
- `packages/api/prisma/identity.test.ts`
- `openspec/changes/external-pm-integrations/tasks.md`
- `openspec/changes/external-pm-integrations/apply-progress.md`

## A1.3 Deviations

- Maintainer-approved forward-only migration naming correction: the provisional `20260720_pm_identity_health` path was renamed to `20260721_pm_identity_health`; no committed A1.2 migration was changed. Future exact references in the local task plan were resequenced to `20260722_pm_work_outbox`, `20260723_pm_inbound_application_conflict`, and `20260724_pm_binding_hardening`.
- No provider/Redmine, credentials service, routes, outbox, polling, worker, or UI behavior was added.

## A1.2 Files in This Work Unit

- `packages/api/prisma/schema.prisma`
- `packages/api/prisma/migrations/20260720_pm_lifecycle_binding/migration.sql`
- `packages/api/prisma/lifecycle.test.ts`
- `openspec/changes/external-pm-integrations/tasks.md`
- `openspec/changes/external-pm-integrations/review-ledger.md`

## A1.4 Implementation

- Added `SyncDirection`, `SyncOperation`, `SyncWorkState`, and `ActorKind` enums.
- Added `IntegrationSyncWork` with UUID/timestamp fields, monotonic unique sequence, dedupe/lane identity, durable lease/fence/epoch state, actor/correlation payload, optional credential/reference links, outcome markers, and approved indexes.
- Added binding Cascade plus credential/reference SetNull foreign keys.
- Added additive migration `20260722_pm_work_outbox`; `20260721_pm_identity_health` and the committed A1.2 migration remain unchanged.
- Added a permanent isolated pre-A1.4 → A1.4 upgrade regression that preserves credential ciphertext/health defaults, identity rows, ExternalRef metadata/linkage, migration adjacency, and post-upgrade work insertion.

## A1.4 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| A1.4 | `packages/api/prisma/work.test.ts` | Prisma DMMF + PostgreSQL integration | ✅ lifecycle 6/6 and identity 5/5 | ✅ Initial DMMF test failed before the new enums/model; persistence test then failed until the new table migration was applied | ✅ Schema generation, migration deploy, and focused work suite passed 6/6 | ✅ Lane sequence/lease state, dedupe uniqueness, credential/ref SetNull, binding Cascade, due-work indexes, and durable pre-A1.4 upgrade path | ✅ Prettier/schema formatting and `git diff --check` passed; focused suite remained 6/6 |

### A1.4 Test Summary

- A1.4 tests written: **6**; focused work suite: **6/6 passed**.
- Regression evidence: lifecycle **6/6**, identity **5/5**, including their durable pre-A1.2/pre-A1.3 upgrade paths.
- Layers used: Prisma DMMF contract assertions, PostgreSQL persistence/constraint/index tests, and isolated migration-upgrade evidence.
- Approval tests: None — A1.4 adds a new persistence contract.
- Pure functions created: None.

## A1.4 Verification

- Read-only health check: exact authorized `kanon-pm182-id-postgres-test-1` reports `running healthy`.
- Target worktree dependencies installed with the existing frozen lockfile; no tracked lockfile changes.
- `pnpm --filter @kanon/api run db:generate` — passed after the schema change.
- `DATABASE_URL=...127.0.0.1:5433/kanon_e2e... pnpm --filter @kanon/api run db:migrate` — applied `20260722_pm_work_outbox` after `20260721_pm_identity_health`.
- Repeat `db:migrate` — no pending migrations.
- `prisma validate` — passed; `pnpm --filter @kanon/api run test:types` — passed; direct no-emit type-check for `work.test.ts`, `identity.test.ts`, and `lifecycle.test.ts` — passed.
- Final focused suites: work **6/6** (including the upgrade regression), lifecycle **6/6**, identity **5/5** passed.
- Prettier checks and `git diff --check` — passed; migration diff reports only pre-existing unrelated drift in `milestone_deliverables`, `milestones`, and `time_entries`, with no A1.4 drift.
- Review boundary: **791 changed lines** including implementation, tests, and tracked progress artifacts; under the 800-line budget with no size exception.
- Temporary upgrade schemas/fixtures were cleaned; the authorized PostgreSQL service remains running.

## A1.4 Files in This Work Unit

- `packages/api/prisma/schema.prisma`
- `packages/api/prisma/migrations/20260722_pm_work_outbox/migration.sql`
- `packages/api/prisma/work.test.ts`
- `openspec/changes/external-pm-integrations/tasks.md`
- `openspec/changes/external-pm-integrations/apply-progress.md`

## A1.4 Deviations

- None — implementation follows the approved deterministic persistence contract and migration path.
- No A1.5 inbound application/conflict persistence, outbox writers, listeners, workers, provider/Redmine behavior, routes, polling, UI, or real-instance connection was added.

## A1.5 Implementation

- Added `InboundApplicationState(claimed, applied, conflict, skipped)` and `ConflictState(open, resolved)`.
- Added `IntegrationInboundApplication` with the approved remote tuple, durable application key/correlation, replay lease/fence state, optional reference/work links, outcome payload, tuple uniqueness, and binding/ref/work delete actions.
- Added `IntegrationConflict` with open/resolved state, local/remote evidence, optional application/work/reference links, binding Cascade, nullable-link SetNull actions, and the approved binding/state index.
- Added additive migration `20260723_pm_inbound_application_conflict`; all earlier migrations remain unchanged and `20260722_pm_work_outbox` remains immediately adjacent before it.

## A1.5 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| A1.5 | `packages/api/prisma/application.test.ts` | Prisma DMMF + PostgreSQL integration | ✅ work 6/6, identity 5/5, lifecycle 6/6 | ✅ New five-test suite failed before the enums/models/migration; missing DMMF contract, client delegates, indexes, and migration adjacency were observed | ✅ Prisma generation, exact migration deploy, and focused application suite passed 5/5 | ✅ Duplicate tuple, duplicate application key, changed remote timestamp, conflict state/evidence, optional SetNull links, binding Cascade, and adjacent upgrade path | ✅ Prettier cleanup plus schema restoration/reapplication removed formatter-only unrelated changes; focused suite remained 5/5 |

### A1.5 Test Summary

- A1.5 tests written: **5**; focused application suite: **5/5 passed**.
- Regression evidence: A1.4 work **6/6**, A1.3 identity **5/5**, and A1.2 lifecycle **6/6** passed before and after the additive schema change.
- Layers used: Prisma DMMF contract assertions, PostgreSQL persistence/constraint/index tests, and isolated migration-upgrade evidence.
- Approval tests: None — A1.5 adds a new persistence contract.
- Pure functions created: None.

## A1.5 Verification

- Authorized PostgreSQL container `kanon-pm182-id-postgres-test-1` was healthy on `127.0.0.1:5433`; no ordinary PostgreSQL service or unidentified container was used.
- Target worktree dependencies were installed with the existing frozen lockfile; no tracked lockfile changes were made.
- `pnpm --filter @kanon/api run db:generate` passed after the A1.5 schema change.
- Exact `DATABASE_URL=postgresql://kanon:kanon@127.0.0.1:5433/kanon_e2e?schema=public` migration deployment applied `20260723_pm_inbound_application_conflict` after A1.4.
- Repeat migration deployment reported no pending migrations; `prisma validate`, API type tests, and direct no-emit type-checking for the application/work/identity/lifecycle tests passed.
- Final focused suites: application **5/5**, work **6/6**, identity **5/5**, and lifecycle **6/6** passed.
- The permanent isolated pre-A1.5 → A1.5 regression deploys all migrations through A1.4, seeds credential/identity/reference/work rows, applies the exact checked-in A1.5 SQL, verifies preservation of those prior rows, then persists and verifies an application row; conflict persistence is covered by a separate fresh-schema database test. It passed in the focused suite.
- Migration diff reports only pre-existing unrelated drift in `milestone_deliverables`, `milestones`, and `time_entries`; no A1.5 drift was reported. Prettier and `git diff --check` passed.
- Review boundary: **741 changed lines** including implementation, test, and tracked progress artifacts; under the 800-line budget with no size exception.
- Temporary upgrade schemas/fixtures were cleaned; the authorized PostgreSQL service remains running.

## A1.5 Files in This Work Unit

- `packages/api/prisma/schema.prisma`
- `packages/api/prisma/migrations/20260723_pm_inbound_application_conflict/migration.sql`
- `packages/api/prisma/application.test.ts`
- `openspec/changes/external-pm-integrations/tasks.md`
- `openspec/changes/external-pm-integrations/apply-progress.md`

## A1.5 Deviations

- None — implementation follows the approved persistence-only contract and additive migration path.
- No A1.6 backfill, A1.7 outbox code, issue writers, provider/Redmine client, routes, listeners/workers, polling, UI, or live connection was added.

## A1.6a Core Implementation

- Added an unwired `backfillExternalRefBindings` operation and transaction-scoped companion in `packages/api/src/modules/integrations/backfill.ts`.
- Scans only `ExternalRef` rows with `bindingId IS NULL`; project references resolve to themselves, while issue and cycle references resolve through their owning project.
- Validates the reference connection, resolved entity/project, binding connection, and binding project against one workspace before assignment. Cross-workspace candidates produce tenant-safe diagnostics with no candidate IDs.
- Uses stable source ordering, sorted diagnostics/candidate IDs, deterministic no-match and ambiguity classification, null-only idempotent updates, and transaction rollback when any source is unresolved.
- Returns a frozen transaction-snapshot result. `snapshot.zeroUnresolved` describes the observed snapshot only; this slice does not provide an immutable concurrency-safe proof.
- Deliberately excludes advisory-lock constants/helpers, `withExternalRefBackfillWriteGate`, cooperating-writer postconditions, multi-client concurrency tests, runtime wiring, schema/migration changes, and A1.7+.

## A1.6a TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| A1.6a | `packages/api/src/modules/integrations/backfill.test.ts` | PostgreSQL integration + pure unit | N/A (new files) | ✅ Test suite written first; missing production module failed collection | ✅ Focused suite 6/6 after minimum core implementation | ✅ 7/7: project/issue/cycle ownership, rerun/already-bound, tenant mismatch with/without candidate, rollback/no-match/unsupported/missing, and candidate ambiguity | ✅ Extracted candidate loading, ownership loading, stable result/diagnostic construction; focused suite remained 7/7 |

### A1.6a Test Summary

- Core tests written: **7**; focused backfill suite: **7/7 passed**.
- Layers used: PostgreSQL transaction integration fixtures and a pure deterministic candidate-resolution unit.
- Approval tests: None — A1.6a adds a new unwired backfill behavior.
- Pure functions created: `resolveBindingCandidates`, diagnostic/result normalization helpers.

### A1.6a Verification

- Authorized PostgreSQL target: `postgresql://kanon:kanon@127.0.0.1:5433/kanon_e2e`; fixtures delete their created workspaces after every test.
- Prisma client generated from the unchanged base schema; `db:migrate` reported no pending migrations; no schema or migration files changed.
- Focused core suite: **7/7 passed**; direct A1.2–A1.5 regression suites: **22/22 passed**; combined run: **29/29 passed**.
- API `test:types`, direct no-emit type-check for `backfill.ts` and `backfill.test.ts`, Prisma validation, Prettier checks, and diff checks passed.
- Review boundary: **799 changed lines** including core code, tests, and tracked split/progress evidence; under the 800-line budget with no exception.

## A1.6b Final Gate Implementation

- Added stable PostgreSQL transaction-level advisory key `EXTERNAL_REF_BACKFILL_LOCK_KEY` and `withExternalRefBackfillWriteGate(database, callback)`, which owns the transaction, acquires the gate before the callback, validates before commit, and rolls back invalid writes.
- The shared validator checks every `ExternalRef` for supported entity type, local entity ownership, non-null/existing binding, same-workspace connection and project ownership, and connection/project consistency.
- `backfillExternalRefBindings` uses the owned gate and validator for the final zero-unresolved proof while preserving the A1.6a snapshot result contract; no caller-owned transaction helper is public.
- **Caller obligation:** A1.7+ writers that create or mutate `ExternalRef`, `IntegrationProjectBinding`, or their ownership sources MUST use the gate until B1 hardening makes the invariant structural. Direct/uncoordinated writes are outside this proof.
- No schema, migration, runtime wiring, provider, route, UI, or A1.7+ implementation was added.

## A1.6b TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| A1.6b | `packages/api/src/modules/integrations/backfill.test.ts` | PostgreSQL integration with two Prisma clients | ✅ A1.6a core 7/7 | ✅ First gated-writer test failed before the API existed | ✅ Focused suite 14/14 | ✅ Valid commit, null-bound rollback, binding/tenant rollback, final proof, lock release, and deterministic insert/source-mutation exclusion | ✅ Shared final assertion extracted; focused suite remained 14/14 |

### A1.6b Test Summary

- New gate tests: **7**; focused backfill suite: **14/14 passed**.
- Regression evidence: A1.2 lifecycle **6/6**, A1.3 identity **5/5**, A1.4 work **6/6**, and A1.5 application **5/5**; combined final run **36/36 passed**.
- Layers used: PostgreSQL transaction integration, two-client advisory-lock coordination, and deterministic deferred barriers; no arbitrary sleeps.
- Approval tests: None — A1.6b adds the final gate contract.
- Pure functions created: None.

### A1.6b Verification

- Authorized PostgreSQL target `127.0.0.1:5433/kanon_e2e` remained healthy; the service was left running.
- `pnpm --filter @kanon/api run test:types` passed; strict no-emit type-check of `backfill.ts` passed.
- Prisma validation, Prettier checks, and `git diff --check` passed; no schema or migration files changed.
- Cleanup check found **0** `backfill-%` workspaces; fixtures and coordination transactions self-cleaned.
- Review boundary: **607 changed lines** across the five tracked A1.6b files; under the 800-line budget with no exception.
- Repository-wide API `tsc --noEmit -p tsconfig.json` was attempted but remains blocked by pre-existing unrelated `@kanon/shared` resolution and auth/issue typing errors; the changed source and configured API type gate pass.

## A1.6b Judgment Day Round 1 remediation — JD-A-701

- Maintainer-authorized fix: removed the exported caller-owned in-transaction backfill helper. The in-transaction implementation remains module-internal, and only `backfillExternalRefBindings(database)` and `withExternalRefBackfillWriteGate(database, callback)` own the transaction through gate acquisition, final invariant validation, and commit.
- Updated rollback/composition and two-client concurrency evidence to use the owned APIs; no A1.7+ behavior or schema/migration scope was added.
- Added a durable public-contract assertion proving `backfillExternalRefBindingsInTransaction` is absent from the module namespace.

### JD-A-701 TDD remediation evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| JD-A-701 | `packages/api/src/modules/integrations/backfill.test.ts` | PostgreSQL integration + public module contract | ✅ Backfill 14/14 | ✅ Public-contract assertion failed while the unsafe export existed | ✅ Focused suite 15/15 after removing the export and replacing unsafe composition | ➖ Structural public-contract behavior has one required outcome; existing 14 behavioral cases remain green | ✅ Private implementation and owned-API test boundary preserved |

- JD-A-701 status: **fixed; not verified**.
- Overall A1.6b Judgment Day status remains **ESCALATED** pending scoped blind re-judgment.

## A1.6 Split Boundary

- Core branch: `feat/pm-182-backfill-core -> feat/pm-182-app`; this slice contains deterministic tenant-safe backfill and snapshot-only evidence.
- Final gate branch: `feat/pm-182-backfill -> feat/pm-182-backfill-core`; it owns advisory/writer coordination and the final immutable proof, and is the only slice that completes A1.6.
- A1.6 implementation is complete on this final gate slice; Judgment Day remains escalated pending blind re-judgment. The proof remains strictly bounded to writers that participate through the gate; this artifact does not copy the preserved full-WIP findings or review status.

## A1.6 Cumulative Scope Boundary (historical)

- A1.1, A1.2, A1.3, A1.4, A1.5, A1.6a core, and A1.6b final gate are complete; A1.7+ and later tasks remain incomplete.
- A1.6 adds deterministic ExternalRef backfill plus a cooperating-writer gate and final validator proof; no A1.7 outbox writers, provider/Redmine behavior, credentials service, polling, routes, workers, or UI was added.
- A1.6's immutable zero-unresolved claim applies only to transactions that acquire the stable gate and pass the shared validator. A1.7+ callers must honor the gate obligation until B1 hardening.
- A1.5 rollback is limited to the additive inbound-application/conflict migration, schema, focused test, and task/progress evidence; committed A1.2/A1.3/A1.4 migrations remain unchanged.
- A1.4 rollback is limited to the additive work-outbox migration, schema, focused test, and task/progress evidence; committed A1.2/A1.3 migrations remain unchanged.
- A1.3 rollback is limited to the additive identity-health migration, schema, focused test, and task/progress evidence; committed A1.2 files remain unchanged.
- Copied proposal/design/spec planning dependencies remain untracked and outside the A1.6 work-unit boundary.

## A1.6 Historical Next Action

A1.6b remediation evidence is green; run the scoped blind re-judgment before verification or commit. Do not apply A1.7+ in this boundary, and do not extend the immutable proof to non-cooperating writers.

## A1.7 Implementation

- Added `packages/api/src/modules/integrations/outbox.ts` with `captureIntegrationWorkTx`, deterministic SHA-256 dedupe/lane key builders, authoritative binding/entity/link validation, binding-epoch capture, idempotent `upsert`, and a read-only `scanIntegrationWork`/`scanIntegrationOutbox` repair scan.
- Capture uses the caller's `Prisma.TransactionClient`, so the domain mutation and durable outbox row commit or roll back together. Repeated correlation capture returns the existing row without rewriting its state or payload.
- Round 1 rejects cross-project/binding/connection/tenant identifiers and stale/future caller epochs before persistence; valid inputs retain idempotent lane behavior.
- The scanner only reads due `queued`/`retry` rows in sequence order and never claims, leases, or changes work; provider I/O and worker claims remain out of scope.
- Added `outbox.int.test.ts` with PostgreSQL fixtures covering durable payload/epoch/link capture, duplicate correlation/lane sequencing, local-correlation compatibility, unknown-binding rejection, enclosing-transaction rollback, due-state filtering, and non-mutating scan behavior.

## A1.7 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| A1.7 | `packages/api/src/modules/integrations/outbox.int.test.ts` | PostgreSQL integration / Prisma transaction | ✅ baseline regression 25/25 | ✅ New ownership/epoch assertions failed against the pre-fix implementation | ✅ focused 6/6; regression 27/27 | ✅ idempotency/rollback, cross-project/binding/connection/tenant rejection, and stale/future epoch paths | ✅ test:types and Prettier checks remain green |

### A1.7 Test Summary

- A1.7 tests written: **6**; focused suite: **6/6 passed**.
- Regression evidence: A1.6 backfill **15/15**, A1.4 work persistence **6/6**; combined targeted run **27/27 passed**.
- Layers used: PostgreSQL persistence, Prisma transaction rollback, durable unique-key behavior, and read-only scanner filtering.
- Approval tests: None — A1.7 adds new outbox behavior.
- Pure functions created: Two deterministic SHA-256 key builders.

## A1.7 Verification

- `pnpm install --frozen-lockfile` — passed in the isolated child worktree; no lockfile changes.
- `pnpm --filter @kanon/api run db:generate` — passed to restore the generated Prisma client required by the fresh worktree.
- `DATABASE_URL=<isolated PostgreSQL test URL; credentials redacted> pnpm --filter @kanon/api exec vitest run src/modules/integrations/outbox.int.test.ts` — **6/6 passed** after the Round 1 RED gate.
- The required regression command ran the A1.7 suite plus `backfill.test.ts` and `prisma/work.test.ts`: **27/27 passed**. `work.test.ts` prints the expected Prisma unique-constraint error from its rejection assertion; the suite passed.
- `pnpm --filter @kanon/api run test:types` — passed.
- Direct strict no-emit type-check of `outbox.ts` and `outbox.int.test.ts` — passed.
- Prettier checks for both A1.7 files and `git diff --check` — passed.
- Repository-wide API `tsc --noEmit -p tsconfig.json` was attempted but remains blocked by pre-existing `@kanon/shared` resolution and auth/issue typing errors; no A1.7 source error was reported.
- No Prisma schema, migration, runtime registration, provider/Redmine behavior, issue writer, scheduler, worker, UI, `.atl/`, or `.codegraph/` file was changed.

## A1.7 Files in This Work Unit

- `packages/api/src/modules/integrations/outbox.ts`
- `packages/api/src/modules/integrations/outbox.int.test.ts`
- `openspec/changes/external-pm-integrations/tasks.md`
- `openspec/changes/external-pm-integrations/apply-progress.md`

## A1.7 Deviations

- None from the assigned A1.7 boundary. The scanner is intentionally read-only; claim/lease, writer integration, worker scheduling, and provider behavior remain later tasks.
- The copied proposal/design/spec files remain untracked local planning context and are not part of the review slice.

## A1.7 Review / Rollback Boundary

- Current work unit starts at exact committed `feat/pm-182-backfill` commit `5bf6d31d70117523081c21565bf4368aba8aa78e` and targets `feat/pm-182-backfill` from child branch `feat/pm-182-outbox`.
- Rollback is limited to `outbox.ts`, its focused integration test, and the A1.7 task/progress/review evidence; no schema or migration rollback is required.
- Review footprint is **798/800 changed lines** across the intended A1.7 files/evidence; copied planning artifacts are excluded and no `size:exception` is needed.
- Round 1 scoped re-judgment: **APPROVED**. Both fresh blind judges independently verified JD-A-801 and JD-A-802 using only the persisted ledger and `/tmp/opencode/kanon-a1-7-round1-fix.patch`; focused A1.7 suite **6/6**, focused regressions **27/27**, boundary **778/800**.
- Judgment Day result: verified BLOCKER/CRITICAL **2**, open BLOCKER/CRITICAL **0**, INFO **3**, fix rounds **1/2**. JD-A-803, JD-B-804, and JD-B-805 remain WARNING/info.
- No commit, push, PR, or Kanon/GitHub comment was created.

## Cumulative Scope Boundary

- A1.1 through A1.6b and A1.7 are complete in this cumulative artifact; A1.8+ and all later tasks remain incomplete.
- A1.7 adds only transactional outbox capture and due-work scanning. It does not wire issue/cycle writers, provider/Redmine behavior, listener/worker/scheduler registration, routes, polling, UI, or schema changes.

## A1.7 Historical Next Action

A1.7 pre-commit and pre-push review gates passed; its authorized commit and push were subsequently completed at `de988c6`. The following A1.8 section is the current cumulative apply result.

## Historical failed A1.8 implementation

> The following failed transaction-composition record is preserved historical evidence only; it is not the current A1.8a state.

- Added `packages/api/src/modules/integrations/issue-tx.ts` with `withIssueMutationTx(issueId, operation)`, a transaction-owning composition seam for issue writers.
- The seam exposes only the caller-owned Prisma transaction client. Each operation must return its useful `result` together with mandatory capture material; the helper invokes and awaits A1.7 `captureIntegrationWorkTx` before the owned transaction can commit.
- The seam injects `entityType: "issue"` and the authoritative `issueId` into the capture passed to A1.7, so callback input cannot redirect capture identity. A1.7 ownership, epoch, idempotency, and rollback guarantees remain delegated to its existing implementation.
- No existing issue writer/service was modified; A1.9 remains responsible for wiring `createIssue`, `updateIssue`, and transition writers.
- Added `packages/api/src/modules/integrations/issue-tx.test.ts` with PostgreSQL integration coverage for mandatory capture rollback, authoritative identity, awaited capture, commit, callback-error rollback, invalid-reference rollback, and non-zero binding-epoch capture.

## A1.8 TDD Cycle Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| A1.8 | `packages/api/src/modules/integrations/issue-tx.test.ts` | PostgreSQL integration / Prisma transaction | ✅ Existing A1.8 baseline 7/7 | ✅ Round 1 mandatory-capture/identity tests were written first; this fix round added three tests before production edits and the pre-fix run was 7/10 passed, 3/10 failed | ✅ Focused suite 10/10 passed | ✅ Commit, awaited capture, callback-error rollback, invalid reference rollback, lifecycle epoch, missing capture rollback, identity redirection, nested object/array thenables, and malformed Map payload | ✅ Added recursive non-invoking thenable detection and strict recursive JSON validation; direct type/format checks remained green |

### A1.8 Test Summary

- A1.8 tests written: **10**; focused suite: **10/10 passed**.
- Regression safety net: A1.7 outbox **6/6** plus A1.6 backfill **15/15**; combined regressions **21/21 passed**.
- Combined A1.8 plus A1.7/A1.6 run: **31/31 passed**.
- Layers used: PostgreSQL persistence, Prisma transaction rollback, A1.7 outbox validation, and lifecycle-epoch delegation.
- Approval tests: None — A1.8 adds a new composition seam.
- Pure functions created: None; the seam deliberately preserves the transaction boundary rather than duplicating outbox logic.

## A1.8 Verification

- `pnpm install --frozen-lockfile` — passed; no lockfile changes.
- `pnpm --filter @kanon/api run db:generate` — passed; generated Prisma client required by the fresh child worktree.
- Isolated PostgreSQL migration deploy on the authorized test service — no pending migrations.
- Focused command `DATABASE_URL=<isolated PostgreSQL test URL; credentials redacted> pnpm --filter @kanon/api exec vitest run src/modules/integrations/issue-tx.test.ts` — **10/10 passed**, including nested deferred transaction promises and malformed `Map` payload rollback.
- Regression command for `outbox.int.test.ts` and `backfill.test.ts` — **21/21 passed**.
- Combined focused/regression command — **31/31 passed**.
- `pnpm --filter @kanon/api run test:types` — passed.
- Direct strict no-emit type-check for `issue-tx.ts` and `issue-tx.test.ts` — passed.
- Prettier checks for both A1.8 files and `git diff --check` — passed.
- The first post-install test attempt was blocked by a missing generated Prisma client; `db:generate` restored the expected generated dependency before the genuine RED run. No application code was changed for that setup issue.
- No Prisma schema/migration, issue writer, cycle/group writer, provider/Redmine, listener/worker/scheduler, route, polling, UI, `.atl/`, or `.codegraph/` file was changed.

## A1.8 Pre-commit reliability fix round 1/2

- R3-008 and R3-009 are **fixed, not verified**; the pre-commit result remains pending scoped re-review.
- R3-008 uses both a compile-time `IssueMutationTxResult<T>` contract and a runtime recursive guard. The guard never invokes a discovered thenable, so a transaction-bound Prisma promise cannot escape and reject after commit.
- R3-009 validates capture payloads inside the owned transaction before A1.7 capture. It accepts JSON-compatible nested objects/arrays/scalars and rejects unsupported prototypes, `Map`, `Set`, promises, functions, symbols, bigint, undefined members, non-finite numbers, and cycles.
- RED evidence: the three new behavior-first tests failed against the pre-fix seam while the seven existing A1.8 tests passed (**7/10**).
- GREEN evidence: A1.8 **10/10**, A1.7/A1.6 **21/21**, combined **31/31**; API type gate, direct seam type-check, Prettier, and `git diff --check` passed.
- Fix patch: `/tmp/opencode/kanon-a1-8-precommit-r1-fix.patch`.

## A1.8 Files in This Work Unit

- `packages/api/src/modules/integrations/issue-tx.ts`
- `packages/api/src/modules/integrations/issue-tx.test.ts`
- `openspec/changes/external-pm-integrations/tasks.md`
- `openspec/changes/external-pm-integrations/apply-progress.md`
- `openspec/changes/external-pm-integrations/review-ledger.md`

## A1.8 Deviations

- None from the assigned A1.8 boundary. The helper is intentionally unwired; actual issue writer integration remains A1.9.
- The exact child worktree had no `.codegraph/` index, so implementation exploration used targeted reads/searches without initializing or modifying CodeGraph.

## Historical A1.8 Review / Rollback Boundary

- Current work unit starts at exact committed `feat/pm-182-outbox` commit `de988c638acef374cebb86caac1c7996196f5eec` and targets `feat/pm-182-outbox` from child branch `feat/pm-182-tx`.
- Rollback is limited to `issue-tx.ts`, `issue-tx.test.ts`, and the A1.8 task/progress/review evidence; no schema or migration rollback is required.
- Forecast was **250 changed lines**, below the 800-line session budget; no `size:exception` was used.
- Initial pre-review-persistence boundary was **302 changed lines**: 38 source, 182 test, and 80 tracked task/progress artifact lines; copied untracked planning artifacts are excluded. Before final persistence, the reported Round 1 boundary was **462/800 changed lines**: 346 source/test, 82 apply-progress, 32 review-ledger, and 2 task lines. The final post-persistence Round 1 boundary was **464/800**; the final post-round-2 boundary is **798/800** (65 changed lines: 31 source additions, 3 source deletions, 19 test additions, and 12 artifact line changes), with copied planning artifacts excluded and no size exception.
- Round 1 scoped re-judgment: **APPROVED**. Both fresh blind judges independently verified JD-A-901 and JD-A-902; Judge A ran A1.8 **7/7**, A1.7 **6/6**, and A1.6 **15/15**. The post-fix focused A1.8 run was **10/10**, inherited regressions were **21/21**, and combined coverage was **31/31**.
- No commit, push, PR, or Kanon/GitHub comment was created.

## Cumulative Scope Boundary

- A1.1 through A1.11 are complete locally in this cumulative artifact; failed A1.8 remains preserved historical evidence, while A1.12+ remain incomplete.
- A1.8a adds only the pure Issue-row/canonical-payload contract and its unit proof. It does not add transaction, issue-writer, provider/runtime/routes/UI behavior.

## Historical failed A1.8 next action

Terminal A1.8 state: **BLOCKED / ESCALATED** after the failed final scoped pre-commit re-review; **R3-008** and **R3-009** remain the two open CRITICAL findings. R3-008 covers custom-prototype arrays hiding inherited transaction thenables/accessors while the validated result remains mutable during awaited capture; R3-009 covers mutable capture replacement during spread and `structuredClone` accepting non-JSON structures. A1.8 **12/12**, inherited **21/21**, and combined **33/33** behavioral gates remain green; type and diff checks pass but do not override the findings. Prettier fails on both A1.8 source/test files. Fix convergence is exhausted at **2/2**; no third round. Historical boundary: **798/800**. Maintainer re-scope/manual decision is required; no commit, push, or A1.9 until a new maintainer-approved plan.

## A1.8a — authoritative current reconciliation

- **State:** Accepted for commit under the maintainer-approved `size:exception`; Judgment Day terminal state remains **`ESCALATED — maintainer exception`**. A1.8b is not started.
- **Current proof:** Focused contract **2/2** and core/types **5/5**. Historical **20/20** is the pre-cancel oracle, not current proof; its reduction is accepted coverage debt.
- **Current gates:** Direct target TypeScript **PASS**, forced Prettier with `--ignore-path /dev/null` **PASS**, and `git diff --check` **PASS**. The configured type gate is supplementary.
- **Judgment rows:** JD-A-1101/JD-B-1101/JD-A-1103 remain **fixed, not verified**; warnings remain unchanged.
- **Scope at A1.8a close:** Pure contract only; final boundary **452 changed lines = 436 additions + 16 deletions**, covered by the maintainer `size:exception`; A1.8b had not started yet.

## A1.8b — owned issue mutation transaction seam

- **State:** Apply and one bounded reliability review complete locally; not committed, pushed, or wired into issue writers.
- Added `withIssueMutationTx(operation, database=prisma)`: owned transaction, awaited operation, one-time A1.8a canonicalization, explicit capture copy, `entityId=result.id`, mandatory awaited A1.7 capture, then detached Issue return.
- RED: focused test failed because `issue-tx.ts` did not exist. GREEN: focused PostgreSQL suite **3/3**.
- Safety net: A1.8b + A1.8a contract + A1.7 outbox + A1.6 backfill **26/26**; shared/API builds, API type gate, direct source/test TypeScript, Prettier, and `git diff --check` passed.
- One reliability review found no BLOCKER/CRITICAL and three test-only warnings; one fix pass made update/transition identities distinct, asserted forwarded operation/actor metadata, and replaced timer racing with deterministic mutation at A1.7's first binding read.
- Scope remains unwired and limited to `issue-tx.ts`, `issue-tx.int.test.ts`, and this task/review evidence. A1.9 owns writer integration.

## A1.9 — issue writer integration

- **State:** Apply and one bounded reliability review complete locally; not committed or pushed.
- Added one `mutateIssueWithCapture` composition in `issue/service.ts`; bound `createIssue`, `updateIssue`, and `transitionIssue` now atomically persist the Issue row and A1.8b/A1.7 capture, while unbound projects keep the existing direct mutation path.
- Capture uses the persisted Issue row, initiating `member:<id>`, human/AI actor kind, the human actor's same-connection credential when present, and only mapped fields changed by update/transition.
- RED failed **2/2** for absent work/rollback; GREEN focused PostgreSQL suite passed **2/2**. Existing issue service tests passed **49/49** and inherited A1.8b/A1.7/A1.6 suites passed **24/24**.
- API type gate/build, changed-file Prettier, and `git diff --check` passed. Final pre-artifact implementation boundary was **274 changed lines** including the new test and three 3-line mock updates, below 400.
- One bounded reliability review found no severe issue and two test-coverage warnings; no fix or second review cycle was warranted.

## A1.10 — batch/group writer integration

- **State:** Complete locally, not committed/pushed. Group and key-batch transitions atomically CAS each expected state, audit and capture every persisted Issue row; concurrent no-ops are excluded. RED/GREEN **2/2**; unit **59/59**, inherited integration **28/28**, event **13/13**, type/build/format/diff pass. One review BLOCKER for concurrent duplicate capture was fixed in one pass.

## A1.11 — cycle writer integration

- **State:** Complete locally, not committed/pushed. Cycle create Path A/B, idempotent close, and pre-delete capture share atomic actor/ref-aware payload capture; binding races enter the transaction. RED/GREEN **2/2**; Cycle unit **42/42**, inherited integration **31/31**, type/build/format/diff pass. Three review BLOCKERs were fixed in one pass.

## A1.12 — automatic scanner scheduling

- **State:** Apply and one bounded reliability review complete locally; not published.
- Added a non-overlapping, self-rearming timer around the existing read-only `scanIntegrationWork`, with isolated scan errors, `unref()`, and idempotent shutdown.
- Registered the scheduler in Fastify `onReady` and stopped it in `onClose`; `BuildAppOptions.integrationScan` keeps lifecycle coverage deterministic without provider or worker behavior.
- Focused A1.12 **4/4**, outbox regression **6/6**, app cleanup lifecycle **4/4**, API build/type checks, formatting, and diff checks passed.
- One bounded review found a lifecycle-wiring coverage BLOCKER; the fix added executable `buildApp()` start/stop coverage. A throwing `onError` callback is also covered without breaking rearming or shutdown.
- Scope remains read-only scheduling. Claim/lease, provider dispatch, retries, and Redmine I/O remain A4 work.

## A2.1 — SSRF and DNS-rebinding protection

- **State:** Apply and one bounded risk review complete locally; not published.
- Added HTTPS-by-default endpoint validation with explicit public-HTTP opt-in, URL-credential rejection, and native IPv4/IPv6 non-public range blocking.
- Every call resolves all DNS answers and rejects the hostname if any answer is unsafe. The returned lookup is pinned to one vetted address and refuses hostname substitution, preventing a second resolver lookup at connect time.
- RED failed because the guard module was absent; GREEN passed **19/19**. The risk fix added a failing `fec0::/10` site-local case, then the final suite passed **20/20**.
- API build, configured type gate, direct source/test TypeScript, Prettier, and `git diff --check` passed after generating the fresh worktree's Prisma client and building `@kanon/shared`.
- One bounded risk review found `R1-001` CRITICAL for omitted legacy IPv6 site-local addresses; `fec0::/10` is now blocked and covered. No second review loop was run.
- No dependency, request/retry/auth/redirect behavior, persistence, provider adapter, route, worker, or UI was added; A2.2 owns the actual HTTP client.

## A2.2 — Redmine HTTP client

- **State:** Apply and one direct bounded resilience review complete locally; not published.
- Added `undici ^6` and a JSON `RedmineHttpClient` with API-key authentication, GET/POST/PUT/DELETE methods, a 10-second default per-attempt timeout covering DNS/connect/body, disabled redirects, and status-only redacted errors.
- Every attempt re-resolves through A2.1 and creates a fresh Agent pinned to the vetted address. HTTP 429 and 500–599 responses retry idempotent methods with bounded exponential delays; POST creates never retry blindly.
- RED failed **0/6** because the client did not exist; GREEN passed **6/6**. Direct review found that DNS resolution preceded the timeout; a new hanging-DNS case now proves credentials are never sent, and final A2.2 passed **7/7** with A2.1 **20/20**.
- API build, configured type gate, direct source/test TypeScript, Prettier, dependency formatting, and `git diff --check` passed.
- The delegated review produced no findings because it was cancelled after an excessive wait. It was not relaunched; the scoped review and fix were completed directly.
- Provider mapping, discovery, role-ceiling behavior, persistence, routes, workers, and UI remain out of scope; A2.3 owns the adapter.
