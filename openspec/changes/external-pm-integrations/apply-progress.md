# Apply Progress — external-pm-integrations

## Status

- Current work unit: **A1.2 — lifecycle and project-binding persistence**
- State: **implemented, tested, and Judgment Day approved**
- Branch: `feat/pm-182-life`
- Worktree: `/srv/workspace/projects/kanon/.claude/worktrees/pm-182-life`
- Base: `feat/pm-182-types` at `f505a2a`
- Intended PR target: `feat/pm-182-types`
- Delivery: feature-branch chain
- Mode: strict TDD

## Completed Tasks

- [x] A1.1 — Canonical PM integration contracts (`f505a2a`)
- [x] A1.2 — Lifecycle, project binding, staged ExternalRef metadata, and additive migration

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

## Files in This Work Unit

- `packages/api/prisma/schema.prisma`
- `packages/api/prisma/migrations/20260720_pm_lifecycle_binding/migration.sql`
- `packages/api/prisma/lifecycle.test.ts`
- `openspec/changes/external-pm-integrations/tasks.md`
- `openspec/changes/external-pm-integrations/review-ledger.md`

## Scope Boundary

- A1.3 and later tasks remain untouched.
- No provider/Redmine behavior, credentials, outbox, polling, routes, or workers were added.
- Rollback remains limited to the additive A1.2 schema, migration, and test changes.

## Next Action

The reliability pre-commit review passed with an empty ledger, and the maintainer authorized the local A1.2 work-unit commit. Create that commit without pushing or opening a PR.
