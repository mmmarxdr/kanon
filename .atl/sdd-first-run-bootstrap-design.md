# Design: first-run-bootstrap — Make a Fresh Self-Hosted Instance Usable

## Technical Approach
Introduce an instance-level **admin** tier (orthogonal to super-admin `ownerUserId` and per-workspace `MemberRole`) via a single additive boolean on `User`. Claim dual-grants super-admin + instance-admin through one shared `grantInstanceAdmin(tx, userId)` helper (idempotent by construction). Workspace creation is gated by a new `requireInstanceAdmin` preHandler. Subsequent admins arrive via an instance-scoped onboarding invite that REUSES the kanon:// JWT/scope mechanism (sign/verify, `/api/auth/onboard` entrypoint) but persists to a NEW `InstanceAdminInvite` table — avoiding nullable surgery on the hot `workspace_invites` table. Signup policy is enforced in `register()` as a no-op under default settings. `/me` gains `isSuperAdmin` + `isInstanceAdmin`; web reads them via the hand-written `AuthUser` interface (no bridge Zod for `/me` exists).

## Architecture Decisions

### Decision 1: Instance-admin role storage
**Choice**: `isInstanceAdmin Boolean @default(false)` column on `User`.
**Alternatives**: dedicated `InstanceAdmin` join table; `{USER,ADMIN}` enum on User; extend `InstanceSettings`.
**Rationale**: Purely additive, zero backfill, trivial query, naturally idempotent (set-true-twice is a no-op — dissolves the "idempotent dual-grant" requirement). The third tier (super-admin) lives on `InstanceSettings.ownerUserId`, so an enum would be a boolean with ceremony. Multi-admin is supported (many users, flag=true). Per-grant audit, if ever needed, uses the existing `AdminAuditLog` (schema:562) — killing the join-table argument. **`requireInstanceAdmin` checks ONLY the boolean, never "super-admin OR admin"**; obs #1025 model purity means patient-zero creates workspaces purely via the dual-granted flag, not via super-admin-ness.

### Decision 2: Dual-grant ⊗ onboarding-token composition
**Choice**: Separate additive `InstanceAdminInvite` table; reuse the JWT primitives + `/api/auth/onboard` route with a `scope:"instance_onboard"` branch. One shared `grantInstanceAdmin(tx, userId)` called by BOTH claim and consume.
**Alternatives**: make `WorkspaceInvite.workspaceId` nullable + add `INSTANCE_ADMIN` to `InviteKind`; brand-new token type.
**Rationale**: `onboard()` does `$queryRaw FROM workspace_invites` + `workspace.findUniqueOrThrow` with `workspaceId` NOT NULL. Nullable surgery forces a null-safety audit across every WorkspaceInvite consumer (broad test risk). A separate table costs ZERO on existing consumers. "Reuse the token system, not a new type" is honored at the MECHANISM level (kanon:// onboard JWT, sign/verify, route) — NOT literal table reuse. The instance-consume is a SEPARATE service function so the workspace-member FOR UPDATE tx never entangles instance logic.

### Decision 3: Invite endpoint shape + requireInstanceAdmin
**Choice**: `requireInstanceAdmin()` mirrors `requireSuperAdmin()` (require-role.ts:512) — 401 if unauth, 403 unless `user.isInstanceAdmin`. New endpoints:
| Method/Path | Auth | Body | Response |
|---|---|---|---|
| `POST /api/instance/admins/invites` | super-admin | `{ email, ttlHours? }` | `{ inviteId, url, token, expiresAt }` (mirror `OnboardingInviteResponse`) |
| `POST /api/workspaces` (change) | **requireInstanceAdmin** (was unguarded) | unchanged | unchanged |
| `POST /api/auth/onboard` (change) | public | `{ token }` | branch on JWT scope → instance vs workspace consume |
**Rationale**: super-admin mints (owns admin lifecycle); the consume path reuses the existing public onboard route. Workspace-create guard moves from any-authed-user to instance-admin per B4.

## Data Flow
    claim ──┐                              ┌─→ grantInstanceAdmin(tx,uid) [shared, idempotent]
            ├─ instance/service.ts ────────┤
    onboard(instance_onboard) ─────────────┘
            │
    requireInstanceAdmin ─→ POST /api/workspaces ─→ createWorkspace
    register() ─→ readSettings ─→ [closed→403 | invite→token | open+allowlist→domain check]
    /me ─→ {isSuperAdmin: ownerUserId===id, isInstanceAdmin: user.isInstanceAdmin}

## File Changes
| File | Action | Description |
|---|---|---|
| `prisma/schema.prisma` | Modify | `User.isInstanceAdmin Boolean @default(false)`; new `InstanceAdminInvite` model (id, token, email, tokenHash/jwt sub, consumedAt, revokedAt, expiresAt, createdById) |
| `prisma/migrations/*` | Create | Additive, reversible (ADD COLUMN default false; CREATE TABLE) |
| `middleware/require-role.ts` | Modify | Add `requireInstanceAdmin()` after :528 |
| `modules/instance/service.ts` | Modify | `grantInstanceAdmin` helper; claim dual-grant (step 5b); mint-admin-invite service |
| `modules/instance/routes.ts` + `schema.ts` | Modify | `POST /api/instance/admins/invites` (super-admin) |
| `modules/workspace/routes.ts` | Modify | Add `preHandler:[requireInstanceAdmin()]` to POST `/` (:23) |
| `modules/auth/service.ts` | Modify | `register()` policy enforcement; `onboard()` scope branch → `consumeInstanceAdminInvite` |
| `modules/auth/routes.ts` + `schema.ts` | Modify | `/me` returns `isSuperAdmin`,`isInstanceAdmin`; `MeResponse` Zod +2 fields |
| `web/stores/auth-store.ts` | Modify | `AuthUser` +2 fields |
| `web/routes/setup.tsx` | Modify | Post-claim redirect to usable page |
| `web/components/app-sidebar.tsx` | Modify | Create-project wire (+, :308); admin nav (super-admin); workspace-create + invite-admin affordances (instance-admin) |
| `web/routes/project-select.tsx` | Modify | Create-project empty-state action |
| `web/routes/_authenticated/admin.instance.tsx` | Modify | Editable signup policy (PATCH); invite-admin UI |

## Interfaces / Contracts
- `MeResponse` / `AuthUser` gain `isSuperAdmin: boolean`, `isInstanceAdmin: boolean`. No bridge Zod for `/me` — sync = api `MeResponse` (auth/schema.ts:77) + web `AuthUser` (auth-store.ts:3); web has NO runtime parse so added fields cannot break it. Confirm claim/instance-invite responses are also api-local (not bridge).
- `grantInstanceAdmin(tx, userId)`: `tx.user.update({where:{id},data:{isInstanceAdmin:true}})` — idempotent.
- Instance onboard JWT: `{ sub: inviteId, scope: "instance_onboard" }`.

## Testing Strategy
| Layer | What | Approach |
|---|---|---|
| Unit | `grantInstanceAdmin` idempotency; `requireInstanceAdmin` 401/403/pass; register policy precedence (invite bypasses gate; open+empty=allow-all) | vitest, mocked prisma |
| Integration | claim dual-grants both; re-claim no double-grant; mint→consume grants admin; guarded POST /api/workspaces 403 without flag, 201 with; register closed/invite/domain | Fastify inject |
| E2E | deploy→claim→create workspace+project→invite admin | Playwright (after both slices land) |

## Migration / Rollout
Single additive migration: `ALTER TABLE users ADD COLUMN is_instance_admin BOOLEAN NOT NULL DEFAULT false`; `CREATE TABLE instance_admin_invites`. Reversible (DROP COLUMN/TABLE). No backfill — existing users default non-admin; patient-zero gets the flag on next claim (already-claimed instances need a one-time manual grant or a follow-up, FLAG in tasks).

## PR Cut
API slice FIRST (contract), Web slice SECOND. API slice exceeds 400 lines → recommend 1a (schema+migration+role+requireInstanceAdmin+claim dual-grant) / 1b (workspace guard+instance-admin invite+signup enforcement+/me). Final boundaries are sdd-tasks' call per the Review Workload Guard.

## Open Questions
- [ ] Already-claimed live box: patient-zero (`admin@kanon.io`) won't auto-get the flag — one-time grant script vs. claim-idempotency re-run. Resolve in tasks.
- [ ] Confirm claim + instance-invite responses are not consumed via a bridge Zod schema (spot-check showed none for `/me`).
