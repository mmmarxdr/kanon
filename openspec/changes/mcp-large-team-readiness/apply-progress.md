# MCP large-team readiness PR2 Apply Progress

Task 2.1: RED - Wrote failing API migration tests using Prisma integration harness.
Task 2.2: GREEN - Added TriageProposal, TriageProposalContent, TriageProposalLifecycleEvent, and TriagePolicy to Prisma schema with required properties. Created migration SQL and updated workspace service to inject a default policy on creation.
Task 2.3: TRIANGULATE - Wrote validation logic and test helpers to check upgrade scenarios, RESTRICT delete constraints, index generation, and terminal-event uniqueness.
Task 2.4: REFACTOR - Created ADR 0014 for the dedicated immutable triage ledger.
Task 2.5: REFACTOR - Isolated checks, verified everything via `pnpm test`, marked all tasks as complete.

# MCP large-team readiness PR8 Apply Progress

Task 8.1: RED - Added failing integration tests in `packages/api/src/modules/triage/lifecycle.test.ts` covering member dismissal authorization, idempotent repeat dismissal, expired proposal dismissal rejection, disposed proposal dismissal rejection, explicit reason audit, background expiry evaluation, terminal idempotency, lifecycle event creation, zero domain/Issue writes, and concurrent race handling.
Task 8.2: GREEN - Implemented `dismissTriageProposal` in `lifecycle.ts` and `POST /api/triage-proposals/:id/dismiss` in `routes.ts` with member project authorization (via `ProjectMember` checked against `userId`), SERIALIZABLE transaction for transition to `dismissed`, append-only `TriageProposalLifecycleEvent`, server-side `expiresAt` check, terminal idempotency, and background/lazy expiry resolver.
Task 8.3: TRIANGULATE - Added tests and handling for edge cases: non-existent proposal ID (404), unauthorized project member (403), already-dismissed proposal idempotency check (200), expired proposal transition, disposed proposal transition error, and concurrent dismissal race handling.
Task 8.4: REFACTOR - Isolated lifecycle transition logic in `packages/api/src/modules/triage/lifecycle.ts`, rerun `pnpm --filter @kanon/api test`, marked tasks 8.1-8.4 complete in `tasks.md`, and recorded apply-progress in Engram.

# MCP large-team readiness PR9 Apply Progress

Task 9.1: RED - Added 20 failing tests in `packages/api/src/modules/triage/retention.test.ts` covering exported constants (DEFAULT_RETENTION_DAYS=365, MIN_RETENTION_DAYS=7, batch limits=100), sweepExpiry transitions, sweepRetention disposal with audit-before-content-delete ordering, policy-specific retention days, batch limits, double-dispose prevention, policy change behavior, and registerRetentionHousekeeping worker registration.
Task 9.2: GREEN - Implemented full `packages/api/src/modules/triage/retention.ts` with sweepExpiry (FOR UPDATE SKIP LOCKED, SERIALIZABLE transactions, P2034 retry), sweepRetention (audit event first, content deletion, tombstone marking), and registerRetentionHousekeeping (self-rescheduling timers with unref, expiry every 60s, retention every 24h with startup jitter). Wired housekeeping into `packages/api/src/app.ts` onReady/onClose hooks.
Task 9.3: TRIANGULATE - Added 15 edge-case tests: concurrent parallel sweepExpiry/sweepRetention (no double-processing via SKIP LOCKED), eligibility boundaries (only expired/dismissed eligible, not pending/disposed), retention boundary timing, tombstone preservation (content deleted, listSummary preserved, proposals without content), zero-write guarantees (no Issue/ActivityLog entries), and multi-policy independence.
Task 9.4: REFACTOR - Verified retention + triage suites pass, marked tasks 9.1-9.4 complete in `tasks.md`. Retention is the final enablement stage — correctness lives in the database transaction (SERIALIZABLE + FOR UPDATE SKIP LOCKED), not EventBus/process-local state.

Follow-up (resume after rate-limit): Fixed concurrent `sweepRetention` double-dispose by claiming each row with `FOR UPDATE OF p SKIP LOCKED` inside the same ReadCommitted transaction that audits/deletes/tombstones (one row per tx). Added `parseRetentionDays`, migration CHECK `retention_days >= 7`, and `disposed` enum value in the additive migration SQL.

Follow-up (OpenSpec gaps): Captured retention at creation (`retention_eligible_at`, `captured_retention_days`, `captured_policy_version`); sweep uses captured eligibility so live policy edits cannot silently shorten. Disposition audit `details` include policy id/version; `disposition_list_visible` captured at dispose. Superseded/pending-past-expiry eligibility; partial-failure recovery when disposed audit already exists; `disposedListDiscoveryAllowed` + `disposedTombstoneProjection` (410) helpers for get/list.

Stabilize: Wired `proposal-read.ts` / `proposal-list.ts` into routes — authorized get returns 410 tombstone (no content) for disposed; list discovers disposed only for `disposed|all` when `dispositionListVisible`. Isolated vitest default DB to `kanon_test_pr9`; `cleanDatabase` tolerates missing triage tables.

# MCP large-team readiness PR10 Apply Progress

Task 10.1: RED - Added failing MCP tests in `triage.test.ts`, `kanon-client.test.ts`, `errors.test.ts`, `types.test.ts` for five deferred triage tools (prepare/validate, persist, get, required-one-project list, dismiss), annotations, correlation/deadlines, semantic errors, and no non-401 POST retry.
Task 10.2: GREEN - Implemented wire types in `types.ts`, semantic `errorResult`/`triageDataResult` in `errors.ts`, triage client methods with per-call timeout/correlation in `kanon-client.ts`, five adapters in `tools/triage.ts`, registration in `index.ts`, and `DEFERRED_TOOLS` 18→23.
Task 10.3: TRIANGULATE - Contract coverage for prepare-only fallback, validate hostOutcome/suggestion rules, seal forwarding, list filter encoding (`degraded=true|false`, cursor pass-through), 1..50/default-20 limits, Unicode-trimmed 1..1000-codepoint dismiss reason, output budgets (16/48/32/64/8 KiB), and no apply/approval/execution/autonomous wording.
Task 10.4: REFACTOR - Compensating description trims to keep ≤5,350-byte topline ceiling; unrelated calls keep 10s default; `pnpm --filter @kanon/mcp test` green (498 passed). Branch: `feat/kan-193-mcp-triage-tools` (stacked on PR9 retention).

# MCP large-team readiness PR11 Apply Progress

Task 11.1: RED - Added `inventory.test.ts` plus extended instructions/descriptions/baseline asserts for 49/26/23, fixed 5350/1950 ceilings, triage deferred discovery, firing pins, and docs checks for `docs/modules/mcp.mdx` + `packages/mcp/agents/kanon.md`.
Task 11.2: GREEN - Updated instructions with Triage (ToolSearch) enablement order; compressed persona; exported inventory/ceiling constants; documented protocol in mcp.mdx and kanon.md; trimmed ≥445 B from capture/groups/cycles/timesheet vs pre-triage (measured 487 B); instructions ≤1900 under fixed 1950 ceiling.
Task 11.3: TRIANGULATE - Adversarial checks preserve all 44 legacy tool names, core/deferred classification, non-executable/legacy-apply guidance, and explicit "no workspace-wide queue".
Task 11.4: REFACTOR - Consolidated count/ceiling constants without re-anchoring DESCRIPTION_BASELINE_BYTES=5650; `pnpm --filter @kanon/mcp test` green (514 passed). Branch: `feat/kan-193-mcp-inventory-docs`.

# MCP large-team readiness PR12 Apply Progress

Task 12.1: RED - Added observability/metrics/app/perf/MCP privacy tests for correlation, forbidden labels, redaction paths, SQL boundaries (LIMIT 11/51), and named profiles.
Task 12.2: GREEN - `observability.ts` + registry metrics in `metrics.ts`; `app.ts` genReqId/X-Kanon-Correlation-ID echo + TRIAGE_PINO_REDACT_PATHS; `triage-preview-v1` / `triage-proposal-list-v1` harnesses (full 1000-sample behind TRIAGE_PERF=1).
Task 12.3: TRIANGULATE - Fixture gates for P95/output budgets; source-plan asserts for visibility-first + limit+1 + no content fetch; MCP correlation/deadline privacy fixtures. Focused API suites + full `@kanon/mcp test` green (518 passed). Full monorepo/e2e load remains operator TRIAGE_PERF gate.
Task 12.4: REFACTOR - Rollout/rollback runbook in `docs/modules/mcp.mdx` and `agents/kanon.md` (schema → guard → preview → get/list → persist/dismiss → retention; 44-tool rollback; no destructive DB rollback without export/backfill). Branch: `feat/kan-193-observability-perf`.


## 2026-08-13 runtime-proven AUD-015 follow-up

TDD RED/GREEN: fixed persisted triage provenance to retain original ranked candidate order after retention filtering; canonical retained ID bookkeeping remains sorted. Replaced harness JSON-string equality with structural equality that ignores object key order while retaining array order. Focused proposal-write/live-gate tests, API typecheck/build, JS/shell syntax, and diff check passed. This records harness/runtime evidence only and does not alter qualifying task checkbox state.

## 2026-08-14 runtime-measured compact list follow-up

RED: an isolated PostgreSQL 16 rerun returned 503 for a legitimate 50-row compact page and exposed stored-only `targetTitle` and `nonExecutable` fields in list rows.
GREEN/REFACTOR: the same page returned 200 at 31,725 bytes after omitting only those projection extras; the oversized-page rejection stayed 503, all 11 focused proposal-list tests passed, and API TypeScript typecheck was clean. This is runtime evidence only and does not change the normative contract.
