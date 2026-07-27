# Apply Progress — external-pm-integrations

## Status

- Current work unit: **A1.3 — identity and credential-health persistence**
- State: **implemented and focused evidence green; pending verification**
- Branch: `feat/pm-182-id`
- Worktree: `/srv/workspace/projects/kanon/.claude/worktrees/pm-182-id`
- Base: `feat/pm-182-life` at `e00f00e`
- Intended PR target: `feat/pm-182-life`
- Delivery: feature-branch chain
- Mode: strict TDD
- Review budget: 800 changed lines; A1.3 forecast 230; no size exception
- Maintainer-approved migration correction: A1.3 uses `20260721_pm_identity_health`; A1.2 remains unchanged and future planned migrations use unique later prefixes.

## Completed Tasks

- [x] A1.1 — Canonical PM integration contracts (`f505a2a`)
- [x] A1.2 — Lifecycle, project binding, staged ExternalRef metadata, and additive migration
- [x] A1.3 — External identity mappings, credential health fields, and additive migration

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

## Cumulative Scope Boundary

- A1.1, A1.2, and A1.3 are complete; A1.4 and later tasks remain untouched.
- No provider/Redmine behavior, credentials, outbox, polling, routes, or workers were added.
- A1.3 rollback is limited to the additive identity-health migration, schema, focused test, and task/progress evidence; committed A1.2 files remain unchanged.
- Copied proposal/design/spec planning dependencies remain untracked and outside the A1.3 work-unit boundary.

## Next Action

A1.3 focused evidence is green, and both blind judges verified JD-A-201. Judgment Day is approved; run the required pre-commit review before any local commit. Do not push or open a PR in this phase.
