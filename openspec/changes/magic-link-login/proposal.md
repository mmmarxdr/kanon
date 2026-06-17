# Proposal: Magic-Link Login (KAN-9)

## Intent

Developers and PMs need a passwordless way to sign in when they forget credentials or prefer email-only auth. Today the login screen shows a disabled "Email me a magic link" stub with no backend. KAN-9 closes that gap.

**Persona:** workspace member returning to Kanon web app.

## Scope

### In Scope
- `POST /api/auth/magic-link` — send link (no enumeration)
- `POST /api/auth/verify-magic-link` — redeem token → JWT + cookies (same as login)
- `MagicLinkToken` Prisma model + migration
- Email template `buildMagicLinkEmail`
- Web: enable login button, "check your email" state, `/magic-link?token=` redeem route
- Rate limits (3/min send, 10/min verify per KAN-77)
- Unit + integration + e2e tests (strict TDD)

### Out of Scope
- SSO/OAuth (KAN-8)
- Magic-link registration for unknown emails
- Invite-token preservation through magic-link flow (follow-up)
- MCP/CLI magic-link auth

## Capabilities

### New Capabilities
- `magic-link-auth`: passwordless email login via single-use token

### Modified Capabilities
- None (auth routes extend; no existing spec behavior changes)

## Approach

New `MagicLinkToken` table copying reset-token lifecycle. 15-minute TTL. Send is silent for unknown emails. Verify calls `signTokens`, route sets cookies, optionally marks email verified. Frontend mirrors `verify-email.tsx` but redirects to `/workspaces` on success.

## Affected Areas

| Area | Impact | Description |
|------|--------|-------------|
| `packages/api` | Modified + migration | Token model, service, routes, email template |
| `packages/web` | Modified | Login send UX, redeem route |
| `packages/e2e` | New tests | Send + redeem happy path |

## Risks

| Risk | Likelihood | Mitigation |
|------|------------|------------|
| Prisma migration rollback | Low | Drop table migration; no data coupling |
| Email provider failure | Med | Same as forgot-password — log + 500 on send |
| Token URL leakage | Low | 15 min TTL, single-use, HTTPS only |

## Rollback Plan

Revert deploy. Run down migration dropping `magic_link_tokens`. Disabled UI stub restored if web reverted. No impact on existing password auth.

## Dependencies

- Working `EmailProvider` (already required for reset/verify)
- `env.APP_URL` for link construction

## Success Criteria

- [ ] Registered user receives magic link and lands authenticated in `/workspaces`
- [ ] Unknown email gets same 200 response (no enumeration)
- [ ] Expired/used token returns 400 with clear message
- [ ] LP-3 test updated: button enabled, flow wired
