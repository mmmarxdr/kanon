# Tasks: KAN-211 — Recover from rejected Redmine credentials

## Apply Gate

- [x] 0.1 Tracker on `origin/main` incl. #248+#249.
- [x] 0.2 No schema/migration in Unit 1 worktree.
- [x] 0.3 No active KAN-211 worker before apply.

## Review Workload Forecast

Est. lines: 1A **400**; 1B **~120–180**; Units 2–3 **~550–650**

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

| Unit | Goal | PR | Base |
|------|------|-----|------|
| Tracker | Chain | — | `fix/kan-211-redmine-credential-expiry`; tracker→`main` |
| 1A | Baseline fence | 1 | tracker; **400** LOC `fix/kan-211-redmine-auth-fence` |
| 1B | Cause/ambiguous/lease | 1b | 1A tip; ~120–180 LOC child |
| 2 | Replace+health | 2 | Unit 1B tip |
| 3 | Web+i18n | 3 | Unit 2 tip |

- Unit 1B branch: `fix/kan-211-redmine-ambiguity-fence`
- Unit 1B base: `2bd5baa` (committed Unit 1A)

## Phase 1: Outbound (Unit 1A)

- [x] 1.1 **RED** — `types.test.ts`: 401 yes; 403/404/429/5xx no.
- [x] 1.2 **GREEN** — `types.ts`: `isProviderAuthenticationError`.
- [x] 1.3 **RED** — worker 401→invalid+dead/`credential_invalid`; invalid no I/O.
- [x] 1.4 **RED** — A→B→A401: B valid; immediate retry.
- [x] 1.5 **GREEN** — `worker.ts`: snapshot+CAS; miss→retry.
- [x] 1.6 **REFACTOR** — create/update/time-entry.

## Phase 2: Inbound (Unit 1A)

- [x] 2.1 **RED** — `inbound.test.ts`: 401 CAS; lease release; skip.
- [x] 2.2 **RED** — late-401: B valid; no poll delay.
- [x] 2.3 **GREEN** — `inbound.ts`: snapshot+CAS; safe evidence.
- [x] 2.4 **REFACTOR** — 403/network/lease.

## Phase 3: Unit 1B fixes

- [x] 3.1 **RED** — `types.test.ts`: `ProviderDispatchError.cause` 401; no message parsing.
- [x] 3.2 **GREEN** — `types.ts`: top-level or `cause` 401 only.
- [x] 3.3 **RED** — `retry.test.ts`: reconcile 401→auth-blocked `ambiguous`; no busy-loop/redrive.
- [x] 3.4 **GREEN** — `worker.ts`: ambiguous block; reconcile-only.
- [x] 3.5 **RED** — `retry.test.ts`: outbound stale work lease; cred `invalid` commits first.
- [x] 3.6 **GREEN** — `worker.ts`: commit-first CAS; stale lease best-effort.
- [x] 3.7 **RED** — `inbound.test.ts`: reclaimed poll lease; cycle contained.
- [x] 3.8 **GREEN** — `inbound.ts`: commit-first invalidate; poll lease best-effort.

## Phase 4: Replace+redrive (Unit 2)

- [x] 4.1 **RED** — `credentials.test.ts`: `whoAmI` fail→zero writes.
- [x] 4.2 **RED** — TX: dead `credential_invalid`→`retry`; ambiguous due now; keep id/dedupe/correlation/op/payload/actor/refs/attempts; other dead untouched.
- [x] 4.3 **RED** — `routes.ts`: `PUT .../service-credential` authz/rebind; personal vs service.
- [x] 4.4 **GREEN** — `service.ts`/`routes.ts`: `whoAmI` gate; atomic valid+redrive.
- [x] 4.5 **REFACTOR** — no schema.

## Phase 5: Health (Unit 2)

- [x] 5.1 **RED** — `integrations.ts`: DTO; `credential_blocked`; ≤20 cap.
- [x] 5.2 **RED** — ACL: admin total; member redact; ≤20.
- [x] 5.3 **GREEN** — health projection.
- [x] 5.4 **REFACTOR** — API/log redaction.

## Phase 6: Web UX (Unit 3)

- [x] 6.1 **RED** — `redmine-section.test.tsx`: replace/block/admin UX; ≤20 health.
- [x] 6.2 **GREEN** — `redmine-section.tsx`+`use-redmine-integration.ts`.
- [x] 6.3 **GREEN** — en/es i18n.
- [x] 6.4 **REFACTOR** — a11y; UI redaction.

## Verify

- [x] 7.1 vitest api/shared/web; diff-check.
- [x] 7.2 spec scenario map; gaps=critical.
- [x] 7.3 smoke: revoke→replace→dead+ambiguous redrive.
- [x] 7.4 403 no replace offer.
- [x] 7.5 adversarial review/PR.
