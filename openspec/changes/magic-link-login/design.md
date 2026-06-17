# Design: Magic-Link Login (KAN-9)

## Technical Approach

Add passwordless login by cloning the proven reset-token pattern with a dedicated table and shorter TTL. Verify endpoint issues the same JWT pair as `login()` and the route layer sets auth cookies.

## Architecture Decisions

| Decision | Choice | Alternative | Rationale |
|----------|--------|-------------|-----------|
| Token storage | `MagicLinkToken` table | Reuse `PasswordResetToken` | Independent TTL/semantics; no cross-invalidation |
| TTL | 15 minutes | 60 min (reset parity) | Industry default; limits URL leak window |
| Send response | Always 200 + generic message | 404 for unknown | Matches forgot-password anti-enumeration |
| Email verify on redeem | Set `emailVerifiedAt` if null | Require separate verify | Clicking link proves inbox control |
| Passwordless users | Allow redeem | Require password set | Unblocks `passwordHash === null` users |

## Data Flow

```
Login page                    API                         DB / Email
    │  POST /magic-link {email}
    ├──────────────────────────► find user (silent if missing)
    │                            deleteMany old tokens
    │                            create MagicLinkToken
    │                            send email ──────────────► inbox
    │◄────────────────────────── 200 { message }
    │
User clicks /magic-link?token=...
    │  POST /verify-magic-link {token}
    ├──────────────────────────► find valid tokenHash
    │                            tx: mark used, verify email, signTokens
    │◄────────────────────────── 200 { accessToken, refreshToken }
    │  (route sets cookies)
    └─► navigate /workspaces
```

## Prisma Schema Change

```prisma
model MagicLinkToken {
  id        String    @id @default(uuid()) @db.Uuid
  tokenHash String    @unique @map("token_hash")
  expiresAt DateTime  @map("expires_at")
  usedAt    DateTime? @map("used_at")
  userId    String    @map("user_id") @db.Uuid
  user      User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  createdAt DateTime  @default(now()) @map("created_at")
  @@index([userId])
  @@map("magic_link_tokens")
}
```

## File Changes

| File | Action | Description |
|------|--------|-------------|
| `schema.prisma` + migration | Create | `MagicLinkToken` model |
| `auth/service.ts` | Modify | `requestMagicLink`, `verifyMagicLink` |
| `auth/routes.ts` | Modify | Two routes + rate limits + `setAuthCookies` on verify |
| `auth/schema.ts` | Modify | Request/response Zod schemas |
| `email/templates/magic-link.ts` | Create | CTA href must include `magic-link` for ConsoleProvider |
| `web/routes/login.tsx` | Modify | Enable button; POST send; show sent state |
| `web/routes/magic-link.tsx` | Create | Redeem view (copy `verify-email` pattern) |
| `web/routes/__root.tsx` | Modify | Register route |
| `e2e/tests/auth/magic-link.spec.ts` | Create | Full flow |

## Interfaces

```typescript
// POST /api/auth/magic-link
{ email: string } → { message: "If that email is registered, you will receive a sign-in link" }

// POST /api/auth/verify-magic-link
{ token: string } → { accessToken: string, refreshToken: string }
// + Set-Cookie (access, refresh, csrf) — same as /login
```

## Testing Strategy

| Layer | What | How |
|-------|------|-----|
| Unit | `requestMagicLink` silent miss, `verifyMagicLink` expiry/used | vitest + mocked prisma/email |
| Integration | Routes: 200 send, 400 bad token, cookies on verify | fastify `.inject()` |
| E2E | Click link → workspaces | Playwright + ConsoleProvider email capture |

## Migration / Rollout

Forward migration only. No backfill. Feature ships enabled (stub already visible). No feature flag.

## Open Questions

- [ ] Should invite query param (`?invite=`) survive magic-link send? **Defer** — password login handles invites today.
- [ ] 15 min vs 30 min TTL — **15 min** unless product prefers parity with forgot-password copy.
