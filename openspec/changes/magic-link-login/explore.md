# Exploration: Magic-Link Login (KAN-9)

## Current State

Auth today covers password login/register, forgot/reset password, email verification, and CLI onboarding — **not** passwordless sign-in.

| Flow | API | Web | Pattern |
|------|-----|-----|---------|
| Password login | `POST /api/auth/login` | `/login` | `signTokens` + cookies |
| Password reset | `POST forgot-password` + `POST reset-password` | `/forgot-password`, `/reset-password` | `PasswordResetToken` (SHA-256 hash, single-use, 60 min) |
| Email verify | `POST verify-email` | `/verify-email?token=` | `EmailVerificationToken` (24 h) |
| Magic link | **missing** | stub disabled (`magic-link-btn`) | — |

Token infrastructure is consistent: `randomBytes(32).base64url` → SHA-256 stored, `usedAt` + `expiresAt`, deleteMany on resend, atomic `$transaction` on redeem.

`login()` rejects `passwordHash === null` with `INVALID_CREDENTIALS` — magic link becomes the passwordless login path for future SSO/OAuth users.

Rate limits follow KAN-77: send 3/min, redeem 10/min (mirror forgot/verify).

## Affected Areas

- `packages/api/prisma/schema.prisma` — new `MagicLinkToken` model
- `packages/api/src/modules/auth/service.ts` — `requestMagicLink`, `verifyMagicLink`
- `packages/api/src/modules/auth/routes.ts` — two new public routes
- `packages/api/src/modules/auth/schema.ts` — Zod bodies/responses
- `packages/api/src/services/email/templates/magic-link.ts` — new template
- `packages/web/src/routes/login.tsx` — enable button + send flow
- `packages/web/src/routes/magic-link.tsx` — redeem page (mirror `verify-email.tsx`)
- `packages/e2e/tests/auth/` — happy + expired paths

## Approaches

| Approach | Pros | Cons | Effort |
|----------|------|------|--------|
| **A: New `MagicLinkToken` table** | Clear semantics, independent TTL (15 min), audit trail | Prisma migration | Medium |
| **B: Reuse `PasswordResetToken`** | No migration | Confusing semantics; reset overwrites magic link | Low |
| **C: JWT-only (no DB row)** | Stateless | No single-use revoke; weaker security | Low |

## Recommendation

**Approach A.** Mirror `PasswordResetToken` / `EmailVerificationToken` — proven, testable, aligns with KAN-77 rate-limit categories.

**Slice for KAN-9:** API send + verify (sets auth cookies like login) + web send UX + redeem page. Defer: invite-aware magic link, SSO button wiring (KAN-8).

**Side effect:** Redeeming magic link SHOULD set `emailVerifiedAt` if null (proves inbox ownership) — same trust model as clicking verify link.

## Risks

- Email enumeration — mitigated by always-200 send response (like forgot-password)
- Token in URL leaked via Referer — use short TTL (15 min), single-use
- Passwordless users blocked today — magic link unlocks them without opening registration abuse

## Ready for Proposal

**Yes.** Scope is bounded, patterns exist, UI stub is ready. KAN-8 (SSO) stays separate — larger external deps.
