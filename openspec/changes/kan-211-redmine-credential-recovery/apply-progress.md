# Apply Progress: KAN-211 - Redmine credential recovery

**Date**: 2026-08-03
**Mode**: Strict TDD
**Status**: Unit 1 complete; Unit 2 not started
**Delivery**: feature-branch-chain, Unit 1 branch `fix/kan-211-redmine-auth-fence`

## Completed Tasks

- [x] 1.1-1.6 Outbound 401-only credential fence and auth-blocked work
- [x] 2.1-2.4 Inbound 401 fence, immediate stale-version release, and safe logging
- [x] Unit 1 review fix: auth-blocked service work records the selected credential id

## TDD Cycle Evidence

| Task | RED | GREEN | REFACTOR |
|------|-----|-------|----------|
| 1.1 | `isProviderAuthenticationError is not a function`; classifier test failed before implementation | 401 true; 403/404/429/500/503 false | Retry classifier left unchanged |
| 1.2 | Same classifier RED test | `core/types.test.ts` 7/7 pass | Classifier reads only explicit `statusCode` |
| 1.3 | Worker tests authored first; initial collection blocked by missing generated Prisma client | 401 invalidates and writes `dead`/`credential_invalid`; invalid credential causes no second provider call; 403 stays valid | Existing missing/revoked/scope semantics retained |
| 1.4 | Late-A-401 race test authored before worker changes; initial collection blocked by Prisma client | Replacement remains valid; work is `retry` at current time with attempts unchanged | Uses the prepared credential snapshot |
| 1.5 | 1.3/1.4 tests defined required fence behavior first | Credential id + nullable `lastValidatedAt` CAS; fence win and miss pass | Shared atomic failure path also covers ambiguity reconciliation |
| 1.6 | Create/time-entry/null-version assertions added before implementation; existing update path covered by late-401 test | Worker suite 37/37 pass | Reused safe error evidence and kept durable identity fields |
| 2.1 | Inbound 401/multi-binding test authored first; initial collection blocked by Prisma client | CAS invalidates, lease clears, and the second binding is not claimed | Service credential snapshot is internal only |
| 2.2 | Late-401 replacement test authored before inbound changes | Replacement stays valid and lease clears without failed-poll delay | No retry-delay special case outside auth classification |
| 2.3 | Secret-shaped 401 log assertion authored first | Inbound suite 7/7 pass with safe `{name, code, statusCode}` evidence | Moved existing safe evidence pattern to `core/types.ts` |
| 2.4 | 403 and network delay/redaction cases authored first | Both retain the 60-second delay and valid credential | Existing lease and multi-binding behavior preserved |

### Review Fix TDD Evidence

| RED | GREEN | REFACTOR |
|-----|-------|----------|
| Service-fallback 401 and already-invalid rows both received `authCredentialId: null` | Both rows persist the selected service credential id; one provider call total; actor key/kind unchanged | Replaced redundant user-create setup with compact create/update/time-entry coverage; no new helper or schema |

## Files Changed

| File | Action | What |
|------|--------|------|
| `packages/api/src/modules/integrations/core/types.ts` | Modified | Added 401-only classifier and reusable safe error evidence |
| `packages/api/src/modules/integrations/core/types.test.ts` | Modified | Added explicit authentication classification coverage |
| `packages/api/src/modules/integrations/worker.ts` | Modified | Snapshots credential version; CAS-invalidates on 401; records selected credential on auth-blocked work; retries CAS misses immediately |
| `packages/api/src/modules/integrations/retry.test.ts` | Modified | Covers create/update/time-entry, service fallback audit identity, invalid target, 403, nullable version, late 401, and retained actor/work identity |
| `packages/api/src/modules/integrations/inbound.ts` | Modified | Snapshots service credential version; fenced invalidation and lease release; safe logs |
| `packages/api/src/modules/integrations/inbound.test.ts` | Modified | Covers fence win/loss, multi-binding stop, normal failure delay, and redaction |
| `openspec/changes/kan-211-redmine-credential-recovery/tasks.md` | Modified | Marked only Unit 1 tasks complete |
| `openspec/changes/kan-211-redmine-credential-recovery/apply-progress.md` | Added | Recorded Unit 1 execution and verification |

## Commands And Results

| Command | Result |
|---------|--------|
| `pnpm --filter @kanon/api exec vitest run src/modules/integrations/core/types.test.ts src/modules/integrations/retry.test.ts src/modules/integrations/inbound.test.ts` (RED) | Classifier failed as expected; DB suites could not collect because the local Prisma client was absent |
| `pnpm --filter @kanon/api exec prisma generate --schema prisma/schema.prisma` | Local test prerequisite succeeded; no schema or migration changed |
| Same focused Vitest command (GREEN) | Core 7/7 and worker 37/37 pass; inbound collection required unavailable `@kanon/shared/dist` |
| `pnpm --filter @kanon/api exec vitest run src/modules/integrations/inbound.test.ts --config vitest.source-alias.config.ts` | Inbound 7/7 pass; temporary source-alias config removed |
| Final focused command for all three Unit 1 files with the same temporary source alias | 3 files, 52/52 tests pass; temporary config removed |
| `pnpm --filter @kanon/api test:types` | Pass |
| `pnpm --filter @kanon/api exec tsc --noEmit -p tsconfig.source-check.json` | Full API source type-check pass; temporary source-check config removed |
| `pnpm --filter @kanon/api exec vitest run --config vitest.source-alias.config.ts` | Full API runtime run exceeded 300 seconds; three unrelated existing mention-index schema checks failed before timeout; temporary config removed |
| `pnpm exec prettier --check ...` and `git diff --check` | Pass |
| `pnpm --filter @kanon/shared build` | Pass; permitted test prerequisite from `openspec/config.yaml` |
| Focused Unit 1 files, one Vitest process each, isolated migrated database | Core 7/7, worker 38/38, inbound 7/7 pass |
| `DATABASE_URL=<isolated> pnpm --filter @kanon/api test` | 160/160 files pass; 2181 tests pass, 2 skipped |

The first full-suite attempt shared `kanon_test` with another worktree's active Vitest process and produced cross-file foreign-key cleanup races. Verification was repeated against a dedicated migrated database; the complete suite passed there.

## Workload / PR Boundary

- Forecast: Unit 1 expected near the 400-line review boundary.
- Actual production + test diff: 400 changed lines (358 additions, 42 deletions).
- Current slice: tasks 1.1-1.6 and 2.1-2.4 only.
- Remaining Unit 2 boundary: tasks 3.1-4.4 in `service.ts`, `routes.ts`, shared DTOs, and their tests.
- Unit 2 was not started. No shared/web/recovery/health/schema/migration work was changed.

## Deviations And Blockers

- Implementation matches the Unit 1 design.
- The executor's temporary source aliases were removed. Parent verification used the config-approved shared build prerequisite and normal package resolution.
- An isolated database was required because another concurrent worktree was running Vitest against the default shared test database; no other process or worktree was stopped or modified.

## Full 4R Review

- Review completed for risk, readability, reliability, and resilience; every CRITICAL candidate was refuted through general, correctness, impact, and reproducibility lenses.
- Confirmed: wrapped observation 401 is missed; ambiguous-create auth handling can redrive duplicate creates; outbound stale leases can roll back credential invalidation; inbound reclaimed leases can roll back invalidation and escape the cycle.
- Refuted: missing replacement redrive is not a Unit 1 release defect because the selected feature-branch chain cannot ship Unit 1 without Unit 2.
- Readability warnings: failure metadata currently doubles as a state discriminant, and the CAS predicate is duplicated between outbound and inbound.
- Unit 1A is a committed internal review boundary only. It MUST NOT be merged into the tracker or opened for final review until Unit 1B tasks 3.1-3.8 close the confirmed findings.
