## Exploration: kan-211-redmine-credential-recovery

### Current State

Outbound delivery is asynchronous: local mutations enqueue `IntegrationSyncWork`, then `worker.ts` `prepare` resolves a still-`valid` credential, decrypts it, and dispatches via `RedmineHttpClient`. `RedmineHttpError` carries `statusCode`. `isRetryableProviderError` treats only 429 and 5xx as retryable, so HTTP 401 is terminal: `fail` marks the row `dead` on that attempt (`MAX_ATTEMPTS` is 8 but never applies). `fail` does **not** set `skippedReason`, does **not** change `MemberIntegrationCredential.lastAuthStatus`, and continues to leave the credential `valid`. `publicCredential` / UI therefore keep reporting `connected: true`.

Inbound `claimBinding` already requires `last_auth_status = 'valid'`. On poll failure (including 401), `runInboundSyncCycle` only releases the lease with `FAILED_POLL_DELAY_MS` (60s), logs the raw `error` object (not `safeErrorEvidence`), and leaves the credential valid — so claims keep succeeding later.

Credential replacement already validates with Redmine `whoAmI()` before persistence (`connectCredential` / `createConnection`). Upsert is by `memberId_connectionId`, so a replacement **keeps the same credential row id** and only refreshes `encryptedKey` + `lastValidatedAt` (confirmed in `credentials.test.ts`). Replacement does **not** call `requeueDeadIntegrationWork`. That helper exists and only flips `dead → retry` for a single work id; nothing wires it to credential recovery.

`getConnection` exposes redacted `callerCredential` and aggregate coverage counts, but no service-credential health and no authentication-blocked work summary. Workspace settings UI (`redmine-section.tsx`) treats credentials as connected/not connected; there is no actionable `invalid` / blocked-work state. Outbound worker logs already use `safeErrorEvidence` (name/code/statusCode only); inbound failure logging does not.

**Late-401 fence (focus):** Because key A→B replacement reuses the same credential id, invalidating by id alone would mark validated key B invalid. `Prepared` today snapshots only the plaintext api key into adapter options — not `credentialId` + `lastValidatedAt`. Existing fields are enough for a compare-and-set fence: snapshot id + `lastValidatedAt` before I/O; on 401, `UPDATE … SET lastAuthStatus='invalid' WHERE id=? AND lastValidatedAt IS NOT DISTINCT FROM ? AND lastAuthStatus='valid'`. CAS miss means a newer validation won → do **not** invalidate; requeue/retry the work so prepare picks up key B. No Prisma migration required. Residual risk: same-millisecond double validation (low); optional hardening is DB `RETURNING` timestamps or a future version column (avoid while KAN-210 owns schema churn).

### Affected Areas

- `packages/api/src/modules/integrations/core/types.ts` — classify/auth-failure helpers beside `isRetryableProviderError`
- `packages/api/src/modules/integrations/worker.ts` — snapshot fence in `prepare`/`credential`; 401 path in `fail`; stable `skippedReason`; CAS miss → retry
- `packages/api/src/modules/integrations/inbound.ts` — 401 → fenced invalidate; stop reclaim loop; redacted logs
- `packages/api/src/modules/integrations/service.ts` — atomic validate+save+requeue of auth-blocked dead work; extend `getConnection` health (redacted)
- `packages/api/src/modules/integrations/routes.ts` + `packages/shared/src/integrations.ts` — DTO/schema for health + blocked work
- `packages/web/src/features/settings/redmine-section.tsx` (+ tests) — owner replace UX for `invalid` + blocked counts
- Instance-admin Redmine surface (KAN-209 / PR #248) — service-key recovery UX after merge/rebase; do not fork that ownership here
- Tests: `retry.test.ts`, `credentials.test.ts`, `inbound.test.ts`, `types.test.ts`, `redmine-section.test.tsx`, adapter/http redaction regressions

### Approaches

1. **Fenced invalidate + durable auth-blocked dead work (no schema)** — On Redmine 401 only, CAS-invalidate by credential id + `lastValidatedAt`; mark affected outbound work `dead` with stable reason (e.g. `credential_invalid`); inbound stops via existing `valid` claim gate; on successful replacement, atomically requeue matching dead rows (preserve `dedupeKey` / `correlationId` / external refs); extend connection health + settings/admin UX.
   - Pros: Matches existing enums/fields; no migration conflict with KAN-210; prevents late-401 from poisoning key B; resume without duplicate creates when refs exist
   - Cons: Touches worker/inbound/service/shared/web; must rebase after PR #248; reason string convention must stay stable
   - Effort: Medium

2. **Add `credentialVersion` (or similar) column** — Explicit monotonic fence updated on every successful validation.
   - Pros: Clearer than timestamps; avoids same-ms edge case
   - Cons: Prisma migration while KAN-210 has uncommitted schema work; higher coordination cost for little gain
   - Effort: Medium–High

3. **Lifecycle pause / sync mutations on 401** — Disable connection or fail local writes when Redmine rejects auth.
   - Pros: Loud failure
   - Cons: Over-broad blast radius; fights async outbox design; worse UX than credential-scoped block + recovery
   - Effort: High

### Recommendation

Take **Approach 1**. Code already has `CredentialAuthStatus.invalid`, `lastValidatedAt`, work `authCredentialId`/`skippedReason`/`dedupeKey`/`correlationId`, pre-save `whoAmI` validation, inbound `valid`-only claims, and `requeueDeadIntegrationWork`. The missing pieces are 401 classification, the id+`lastValidatedAt` CAS fence (with retry-on-CAS-miss), stable auth-blocked dead retention, replacement-time requeue, redacted health/UX, and inbound parity/logging. Treat credential id + `lastValidatedAt` equality CAS as a sufficient fence given in-place upserts; do not add schema in this slice.

Hard apply dependency: wait for KAN-209 PR #248 merge, then rebase this branch before implementation. Avoid `schema.prisma` changes so KAN-210 can land independently.

### Risks

- Late-401 without `lastValidatedAt` fence incorrectly invalidates a just-validated replacement key (same row id)
- Requeue without preserving work/ref identity could duplicate Redmine issues on create retries
- Overlap with PR #248 (`service.ts`, routes, shared DTOs, admin UI) if apply starts before merge/rebase
- Inbound currently logs raw errors — new paths must use the same redaction contract as outbound `safeErrorEvidence` and keep regression coverage
- Classifying non-401 client errors as auth failure would strand legitimate work

### Ready for Proposal

Yes — requirements map cleanly onto verified code gaps; recommended approach needs no schema change; proposal should lock the CAS fence semantics (snapshot before I/O, equality match, CAS-miss → retry not invalidate), stable `credential_invalid` reason, outbound/inbound parity, replacement requeue rules, and redacted health/UX scope after PR #248.
