# Apply Progress — external-pm-integrations

## Status

- Current work unit: **A1.5 — inbound application/conflict persistence**
- State: **implemented and focused evidence green; pending verification**
- Branch: `feat/pm-182-app`
- Worktree: `/srv/workspace/projects/kanon/.claude/worktrees/pm-182-app`
- Base: `feat/pm-182-work` at `345d9a7`
- Intended PR target: `feat/pm-182-work`
- Delivery: feature-branch chain
- Mode: strict TDD
- Review budget: 800 changed lines; A1.5 forecast 270; no size exception
- Maintainer-approved migration correction: A1.3 uses `20260721_pm_identity_health`; A1.2 remains unchanged; A1.4 uses `20260722_pm_work_outbox`; A1.5 uses `20260723_pm_inbound_application_conflict`.

## Completed Tasks

- [x] A1.1 — Canonical PM integration contracts (`f505a2a`)
- [x] A1.2 — Lifecycle, project binding, staged ExternalRef metadata, and additive migration
- [x] A1.3 — External identity mappings, credential health fields, and additive migration
- [x] A1.4 — Durable integration sync work/outbox persistence and additive migration
- [x] A1.5 — Inbound application/conflict persistence and additive migration

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

## Cumulative Scope Boundary

- A1.1, A1.2, A1.3, A1.4, and A1.5 are complete; A1.6 and later tasks remain untouched.
- A1.5 adds inbound application/conflict persistence only; no A1.6 backfill, A1.7 outbox writers, provider/Redmine behavior, credentials service, polling, routes, workers, or UI were added.
- A1.5 rollback is limited to the additive inbound-application/conflict migration, schema, focused test, and task/progress evidence; committed A1.2/A1.3/A1.4 migrations remain unchanged.
- A1.4 rollback is limited to the additive work-outbox migration, schema, focused test, and task/progress evidence; committed A1.2/A1.3 migrations remain unchanged.
- A1.3 rollback is limited to the additive identity-health migration, schema, focused test, and task/progress evidence; committed A1.2 files remain unchanged.
- Copied proposal/design/spec planning dependencies remain untracked and outside the A1.5 work-unit boundary.

## Next Action

A1.5 focused evidence is green; run the narrow verification/pre-commit review for this child slice. Do not commit, push, or open a PR in this phase.
