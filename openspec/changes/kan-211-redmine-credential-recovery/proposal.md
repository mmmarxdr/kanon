# Proposal: KAN-211 — Recover from rejected Redmine credentials

## Intent

Devs/PMs see Redmine as connected while sync silently dies after an externally rotated/revoked API key (HTTP 401). Make auth failure truthful and recoverable: invalidate the rejected credential, block safely, actionable UX, resume after validated replacement.

## Scope

### In Scope

- HTTP 401 on outbound + inbound (parity); race-safe invalidate of used credential.
- Durable auth-blocked outbound work + redrive after replacement.
- Personal key replace (member flow); service key replace via KAN-209 admin UI.
- Redacted health + settings/admin UX; secret-redaction regressions.

### Out of Scope

- Sync delivery on mutations; notifications; generic dead-letter console.
- Auto-pausing connection on one personal-key failure; treating 403 as auth failure.
- Prisma schema/migrations; MCP/CLI; KAN-210 schema work.

## Capabilities

### New Capabilities

- `redmine-credential-recovery`: 401 rejection, fenced invalidate, blocked-work retention, validated replace+redrive, redacted health/UX.

### Modified Capabilities

- `pm-integration-connection`: rejected → `invalid` until revalidated; validate before save.
- `pm-integration-outbound-sync`: auth-blocked dead work queryable/redriven (`credential_invalid`).
- `pm-integration-inbound-sync`: rejected service credential stops polling; redacted logs.
- `pm-integration-admin-ui`: blocked state + authorized replace actions.

*(From `external-pm-integrations`; absent from `openspec/specs/`.)*

## Approach

- Classify 401 only. Snapshot credential id + `lastValidatedAt` before I/O; CAS-invalidate while `valid`. CAS miss → retry (keep key B; upsert reuses row id).
- Outbound: `dead` + `skippedReason` `credential_invalid`. Inbound stops via `valid`-only `claimBinding`.
- Successful `whoAmI()` replace: atomic save-as-valid + requeue matching rows; preserve `dedupeKey`/`correlationId`/refs. Failed replace mutates nothing.
- Extend health DTOs + web settings after #248 rebase. Packages: `@kanon/api`, `@kanon/shared`, `@kanon/web`.

## Affected Areas

| Area | Impact | Description |
|---|---|---|
| `integrations/{types,worker,inbound,service,routes}` | Modified | Fence, invalidate, requeue, health, admin replace |
| `shared/integrations.ts` | Modified | Health/blocked-work DTOs |
| `web/.../redmine*` + i18n | Modified | Invalid/blocked UX |

## Risks

| Risk | Likelihood | Mitigation |
|---|---|---|
| Late 401 poisons key B | High | id+`lastValidatedAt` CAS; miss→retry |
| Requeue duplicates creates | Low | Preserve dedupe/correlation/refs |
| Apply before #248 | High | Gate apply; rebase first |
| Secret/raw-body leak | High | Redaction + regressions |

## Rollback Plan

Code revert only (no migration). Re-validate via replace flow; blocked rows requeueable.

## Dependencies

- **Hard apply gate:** KAN-209 PR #248 merge + rebase.
- Rebase after KAN-210 if it lands first (tests only).
- Existing `invalid`, `lastValidatedAt`, `requeueDeadIntegrationWork`, `whoAmI()`.

## Success Criteria

- [ ] 401 invalidates only observed version; CAS miss leaves key B valid.
- [ ] Outbound/inbound stop invalid credentials without auth thrash.
- [ ] Owner/admin replace actions; safe blocked UX; health without secrets.
- [ ] Valid replace redrives without dupes; failed replace unchanged.
- [ ] No Prisma schema/migration changes.
