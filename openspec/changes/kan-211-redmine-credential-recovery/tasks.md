# Tasks: KAN-211 — Recover from rejected Redmine credentials

## Apply Gate (hard pre-apply)

- [x] 0.1 Tracker `fix/kan-211-redmine-credential-expiry` is based on current `origin/main`, including merged KAN-209 #248 and KAN-210 #249.
- [x] 0.2 KAN-210 #249 is merged; Unit 1 does not edit schema/migrations or its worktree.
- [x] 0.3 Confirmed no active KAN-211 worker before apply.

No apply until 0.1–0.3 done.

## Review Workload Forecast

Estimated changed lines: 950–1250

Decision needed before apply: No
Chained PRs recommended: Yes
Chain strategy: feature-branch-chain
400-line budget risk: High

Delivery strategy: feature-branch-chain. Suggested split: Unit 1 → 2 → 3.

### Suggested Work Units

| Unit | Goal | Likely PR | Notes |
|------|------|-----------|-------|
| 1 | 401 fence + outbound/inbound | PR 1 | `fix/kan-211-redmine-auth-fence`; base/target `fix/kan-211-redmine-credential-expiry` |
| 2 | Replace+redrive + health DTO | PR 2 | `fix/kan-211-redmine-recovery-health`; base/target `fix/kan-211-redmine-auth-fence` |
| 3 | Web remediation + i18n | PR 3 | `fix/kan-211-redmine-recovery-ui`; base/target `fix/kan-211-redmine-recovery-health` |

Only the tracker/final integration branch merges to `main`. Child PRs must stay focused and not display parent changes.

## Phase 1: Outbound fence (Unit 1)

- [ ] 1.1 **RED** — `core/types.test.ts`: 401 yes; 403/404/429/5xx no.
- [ ] 1.2 **GREEN** — `core/types.ts`: `isProviderAuthenticationError` (`statusCode`).
- [ ] 1.3 **RED** — worker: 401→invalid+dead/`credential_invalid`; already-invalid no I/O; 403 ok.
- [ ] 1.4 **RED** — worker race: A→B→A401 keeps B valid + immediate retry.
- [ ] 1.5 **GREEN** — `worker.ts`: snapshot id+`lastValidatedAt`; CAS on 401; miss→retry.
- [ ] 1.6 **REFACTOR** — create/update/time-entry, null timestamp, redaction; api tests.

## Phase 2: Inbound stop (Unit 1)

- [ ] 2.1 **RED** — `inbound.test.ts`: 401 CAS-invalidates; lease release; claim skips.
- [ ] 2.2 **RED** — inbound late-401: B valid; no failed-poll delay.
- [ ] 2.3 **GREEN** — `inbound.ts`: claim snapshot + CAS; `safeErrorEvidence`.
- [ ] 2.4 **REFACTOR** — 403/network/lease/multi-binding; api tests.

## Phase 3: Replace+redrive (Unit 2)

- [ ] 3.1 **RED** — credentials: fail `whoAmI` zero writes; success valid+requeue.
- [ ] 3.2 **RED** — `PUT .../service-credential`: authz, membership, holder rebind.
- [ ] 3.3 **GREEN** — `service.ts`/`routes.ts`: validate→TX upsert+requeue; keep ids.
- [ ] 3.4 **REFACTOR** — other-reason dead untouched; api tests.

## Phase 4: Health (Unit 2)

- [ ] 4.1 **RED** — shared: `serviceCredentialStatus`+`syncHealth` bounds/null ACL.
- [ ] 4.2 **RED** — API ACL: admin/owner detail; member redact; ≤20; healthy.
- [ ] 4.3 **GREEN** — `integrations.ts` + `getConnection` redacted projection.
- [ ] 4.4 **REFACTOR** — sentinel secrets absent API/logs; shared+api tests.

## Phase 5: Web UX (Unit 3)

- [ ] 5.1 **RED** — `redmine-section.test.tsx`: personal replace; member safe block.
- [ ] 5.2 **RED** — admin section: replace sans discovery; errors; ≤20 list.
- [ ] 5.3 **GREEN** — redmine/admin sections + `use-redmine-integration.ts`.
- [ ] 5.4 **GREEN** — en/es i18n parity.
- [ ] 5.5 **REFACTOR** — a11y/double-submit/secret-free; web tests.

## Phase 6: Verify

- [ ] 6.1 `git diff --check`; api/shared/web vitest (no builds).
- [ ] 6.2 Map all Given/When/Then to tests; gaps=critical.
- [ ] 6.3 Smoke: revoke A→block→replace B→same work once, no dupes.
- [ ] 6.4 403 never offers credential replace.
- [ ] 6.5 Adversarial review before each PR.
