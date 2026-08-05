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

Follow-up (resume after rate-limit): Fixed concurrent `sweepRetention` double-dispose by claiming each row with `FOR UPDATE OF p SKIP LOCKED` inside the same SERIALIZABLE transaction that audits/deletes/tombstones (one row per tx). Added `parseRetentionDays`, migration CHECK `retention_days >= 7`, and `disposed` enum value in the additive migration SQL.
