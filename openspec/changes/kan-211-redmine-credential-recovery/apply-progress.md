# Apply Progress: KAN-211 - Redmine credential recovery

**Date**: 2026-08-04
**Mode**: Strict TDD
**Status**: Units 1A, 1B, and 2 complete; Unit 3 not started
**Delivery**: feature-branch-chain, Unit 2 branch `fix/kan-211-redmine-replace-health`, base `3bcbbde`

## Completed Tasks

- [x] 1.1-1.6 Outbound 401-only credential fence and auth-blocked work
- [x] 2.1-2.4 Inbound 401 fence, immediate stale-version release, and safe logging
- [x] Unit 1 review fix: auth-blocked service work records the selected credential id
- [x] 3.1-3.8 Wrapped 401 classification, ambiguity auth-block, and lease-independent invalidation
- [x] 4.1-4.5 Validated personal/service replacement and atomic scoped redrive
- [x] 5.1-5.4 Redacted credential health with operator ACL and 20-row cap

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

### Unit 1B TDD Evidence

| Task | Test File | Layer | Safety Net | RED | GREEN | TRIANGULATE | REFACTOR |
|------|-----------|-------|------------|-----|-------|-------------|----------|
| 3.1 | `core/types.test.ts` | Unit | 7/7 | Wrapped cause returned false | 7/7 | Direct, one-level wrapped, nested, message, non-401 | Kept classifier explicit |
| 3.2 | `core/types.test.ts` | Unit | 7/7 | 3.1 RED | 7/7 | Same classifier matrix | No recursive/message parsing |
| 3.3 | `retry.test.ts` | Integration | 38/38 | Observed and reconciliation 401 became `dead` and burned attempts | 40/40, final 41/41 | Observed, reconciliation, already-invalid, no reclaim | Parameterized two entry points |
| 3.4 | `retry.test.ts` | Integration | 38/38 | 3.3 RED | 40/40, final 41/41 | Stable reason/id/future due time; no provider redrive | Explicit `AuthFailureMode` |
| 3.5 | `retry.test.ts` | Integration | 40/40 | Reclaimed work rolled credential back to `valid` | 41/41 | New owner token/fence/state/attempts unchanged | Reused existing fence predicate |
| 3.6 | `retry.test.ts` | Integration | 40/40 | 3.5 RED | 41/41 | Fence win, CAS miss, stale owner | Invalidation commits before best-effort work update |
| 3.7 | `inbound.test.ts` | Integration | 7/7 | Reclaimed lease rolled back invalidation and escaped the cycle | 8/8 | Normal release, CAS miss, reclaimed owner | Existing safe evidence assertion retained |
| 3.8 | `inbound.test.ts` | Integration | 7/7 | 3.7 RED | 8/8 | Credential truth independent of poll ownership | Removed cross-record transaction |

### Unit 2 TDD Evidence

| Area | RED | GREEN | REFACTOR |
|------|-----|-------|----------|
| Failed replacement | Invalid credential/work could not prove zero-write behavior | Failed `whoAmI` leaves credential, identity, and work untouched | Validation remains before encryption/transaction |
| Personal redrive | `dead`/`ambiguous` work stayed auth-blocked | Only matching user work resumes; identity, payload, refs, correlation, and attempts persist | One transaction; other reasons/service work untouched |
| Service replacement | Route absent; old holder and service work stayed bound | Instance-admin route validates, rebinds holder, resumes system/AI and orphaned work | Personal work remains on initiating credential |
| Replacement race | Replacement between invalidation and work transition stranded `dead` work | Connection lock serializes transition and redrive; deterministic trigger regression passes | Reused existing parent-first `lockWork` order |
| Health/ACL | DTO stripped fields and accepted >20 items | Service status + `credential_blocked`; owner/admin total and 20 safe rows; member detail null | No payload, actor, correlation, ciphertext, or raw errors exposed |

## Files Changed

| File | Action | What |
|------|--------|------|
| `packages/api/src/modules/integrations/core/types.ts` | Modified | Classifies direct or one-level `ProviderDispatchError.cause` 401 only |
| `packages/api/src/modules/integrations/core/types.test.ts` | Modified | Covers wrapped, nested, message-only, direct, and non-401 classification |
| `packages/api/src/modules/integrations/worker.ts` | Modified | Keeps auth-blocked creates ambiguous, commits invalidation first, and serializes replacement against the work transition |
| `packages/api/src/modules/integrations/retry.test.ts` | Modified | Covers ambiguity, reclaimed work, and the invalidation-to-replacement race |
| `packages/api/src/modules/integrations/inbound.ts` | Modified | Commits credential invalidation before best-effort poll lease release |
| `packages/api/src/modules/integrations/inbound.test.ts` | Modified | Covers reclaimed lease containment and new-owner preservation |
| `packages/api/src/modules/integrations/service.ts` | Modified | Validated scoped replace+redrive, service holder rebind, and redacted health projection |
| `packages/api/src/modules/integrations/routes.ts` | Modified | Adds validated instance-admin service credential replacement route |
| `packages/api/src/modules/integrations/credentials.test.ts` | Modified | Covers zero-write failure, redrive identity, authz, ACL, cap, and redaction |
| `packages/shared/src/integrations.ts` | Modified | Adds service credential and blocked-work health contract |
| `packages/shared/src/integrations.test.ts` | Modified | Covers DTO parsing and 20-item cap |
| `packages/web/src/features/settings/redmine-section.test.tsx` | Modified | Keeps existing typed fixtures compatible with Unit 2 DTO |
| `openspec/changes/kan-211-redmine-credential-recovery/tasks.md` | Modified | Marks Units 1A, 1B, and 2 complete |
| `openspec/changes/kan-211-redmine-credential-recovery/apply-progress.md` | Modified | Records cumulative Unit 1A/1B/2 TDD and verification evidence |

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
| Unit 1B safety nets, one file/process against `kanon_test_kan211_u1` | Core 7/7, worker 38/38, inbound 7/7 pass |
| Unit 1B RED: wrapped classifier | Wrapped `ProviderDispatchError.cause` 401 failed classification as expected |
| Unit 1B RED: ambiguous auth block | Both observed uncertain-create and reconciliation 401 became `dead` and burned attempts |
| Unit 1B RED: outbound stale owner | Credential incorrectly remained `valid` after fenced transition failed |
| Unit 1B RED: inbound reclaimed lease | Cycle rejected with stale-lease error and rolled invalidation back |
| `pnpm --filter @kanon/api exec prisma generate --schema prisma/schema.prisma` | Local Prisma client prerequisite succeeded; no schema/migration changed |
| `pnpm --filter @kanon/shared build` | Permitted test prerequisite succeeded before Unit 1B edits |
| Final Unit 1B files, one Vitest process each, dedicated database | Core 7/7, worker 41/41, inbound 8/8; 56/56 pass |
| `pnpm --filter @kanon/api test:types` and `pnpm --filter @kanon/api exec tsc --noEmit -p tsconfig.json` | Pass |
| `pnpm exec prettier --check ...` and `git diff --check` | Pass |
| Resumed verification against `kanon_test_kan211_u1` | Focused 56/56 pass; full API 160/160 files, 2185 tests pass, 2 skipped; type checks, Prettier, and diff check pass |
| Unit 2 RED | Missing contract/route/redrive/health failed as expected; concurrent replacement left work `dead`; orphaned service work stayed blocked |
| Unit 2 focused verification | API credential recovery 67/67; shared contract 3/3; Redmine settings consumer 3/3; API/shared/web type checks pass |
| Unit 2 full verification | API 160/160 files, 2190 passed, 2 skipped; shared 7/7 files, 103 passed; web 122/122 files, 962 passed, 5 todo |
| Unit 2 formatting | Prettier and `git diff --check` pass; no Prisma schema or migration change |

The first full-suite attempt shared `kanon_test` with another worktree's active Vitest process and produced cross-file foreign-key cleanup races. Verification was repeated against a dedicated migrated database; the complete suite passed there.

## Workload / PR Boundary

- Unit 1A baseline: 400 changed production + test lines at `2bd5baa`.
- Unit 1B actual against `2bd5baa`: 217 changed production + test lines (167 additions, 50 deletions), 37 above the 180-line target.
- The target deviation retains required observed/reconciliation/already-invalid ambiguity and stale-owner assertions; no correctness case was dropped for size.
- Unit 2 actual against `3bcbbde`: 805 additions and 71 deletions in production/test files; 548 additions are focused credential/retry contract tests.
- Current slice: tasks 4.1-5.4 on `fix/kan-211-redmine-replace-health`.
- Remaining Unit 3 boundary: tasks 6.1-6.4 in the Redmine settings UI, hook, and i18n.

## Deviations And Blockers

- Implementation matches the amended Unit 1B behavior; the only deviation is the 217-line actual versus the 120-180 target.
- The outbound/inbound CAS predicate remains duplicated as the review warning allowed; a shared helper was not smaller or safer for this two-site fix.
- The executor's temporary source aliases were removed. Parent verification used the config-approved shared build prerequisite and normal package resolution.
- An isolated database was required because another concurrent worktree was running Vitest against the default shared test database; no other process or worktree was stopped or modified.

## Full 4R Review

- All four confirmed CRITICAL findings are addressed: one-level wrapped 401 classification; durable ambiguous auth-blocking; outbound commit-first invalidation; inbound commit-first contained invalidation.
- Direct definitive 401 remains `dead`/`credential_invalid`; late A→B CAS misses preserve B and retry/reconcile due without attempt burn.
- Refuted: missing replacement redrive is not a Unit 1 release defect because the selected feature-branch chain cannot ship Unit 1 without Unit 2.
- Readability warning retained: the CAS predicate is duplicated between outbound and inbound; ambiguity routing now uses an explicit failure discriminant.
- Units 1A, 1B, and 2 are internal review boundaries; Unit 3 remains required before feature-chain release.
- Unit 2 final focused review found and fixed the invalidation-to-transition replacement race and orphaned service-work recovery.
