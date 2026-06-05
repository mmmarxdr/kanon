/**
 * Instance Layer service (KAN-49).
 *
 * Exports:
 *  - bootstrapSetupToken:         extracted onReady logic (unit-testable)
 *  - grantInstanceAdmin:          idempotent instance-admin grant helper (PR1a)
 *  - claimInstance:               atomic claim transaction
 *  - getSettings:                 fetch singleton settings
 *  - patchSettings:               update singleton settings
 *  - mintInstanceAdminInvite:     PR1b: mint a kanon:// instance-admin invite JWT
 *  - consumeInstanceAdminInvite:  PR1b: consume invite, grant isInstanceAdmin
 */
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import { env } from "../../config/env.js";
import {
  generateOpaqueToken,
  sha256Hex,
  hashPassword,
  signTokens,
} from "../auth/primitives.js";
import type { ClaimBodyType, PatchSettingsBodyType } from "./schema.js";

// ─── Instance-Admin Grant ────────────────────────────────────────────────────

/**
 * Idempotent instance-admin grant helper (PR1a, KAN-49 first-run-bootstrap).
 *
 * Sets `isInstanceAdmin = true` on the given user inside the caller's transaction.
 * Calling this twice on the same userId is a no-op — the flag stays true.
 *
 * @param tx     - Prisma transaction client (caller owns the transaction)
 * @param userId - The user to grant instance-admin to
 */
export async function grantInstanceAdmin(
  tx: Prisma.TransactionClient,
  userId: string,
): Promise<void> {
  await tx.user.update({
    where: { id: userId },
    data: { isInstanceAdmin: true },
  });
}

// ─── Bootstrap / onReady ─────────────────────────────────────────────────────

/**
 * Idempotent setup-token bootstrap logic.
 *
 * Returns the raw token string when a new token was minted.
 * Returns null when: (a) owner is already set, or (b) a live unclaimed token exists.
 *
 * Extracted from the Fastify onReady hook so it can be unit-tested in isolation.
 *
 * @param ttlDays - Token time-to-live in days (from SETUP_TOKEN_TTL_DAYS env)
 */
export async function bootstrapSetupToken(ttlDays: number): Promise<string | null> {
  const settings = await prisma.instanceSettings.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
    select: { ownerUserId: true },
  });

  // (c) Already claimed — noop
  if (settings?.ownerUserId) return null;

  // (b) Live unclaimed token exists — idempotency guard
  const live = await prisma.setupToken.findFirst({
    where: {
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
  });
  if (live) return null;

  // (a) No owner, no live token — mint a new one
  const raw = generateOpaqueToken();
  const hash = sha256Hex(raw);
  await prisma.setupToken.create({
    data: {
      tokenHash: hash,
      expiresAt: new Date(Date.now() + ttlDays * 86_400_000),
    },
  });

  return raw;
}

// ─── Claim ───────────────────────────────────────────────────────────────────

/**
 * Atomically claim the instance: validate token (FOR UPDATE) → assert email
 * is free → create fresh user → set ownerUserId → mark token used.
 *
 * Returns signTokens result (web session, no RefreshToken row — JWT only).
 */
export async function claimInstance(body: ClaimBodyType): Promise<{
  accessToken: string;
  refreshToken: string;
}> {
  const { token, email, password } = body;
  const tokenHash = sha256Hex(token);

  return prisma.$transaction(async (tx) => {
    // Step 1: FOR UPDATE lock on the setup_tokens row
    const rows = await tx.$queryRaw<
      Array<{
        id: string;
        token_hash: string;
        used_at: Date | null;
        expires_at: Date;
      }>
    >`SELECT id, token_hash, used_at, expires_at FROM setup_tokens WHERE token_hash = ${tokenHash} FOR UPDATE`;

    const row = rows[0];

    // Step 2: Validate after lock
    if (!row) {
      throw new AppError(400, "INVALID_TOKEN", "The setup token is invalid");
    }
    if (row.used_at !== null) {
      throw new AppError(410, "TOKEN_USED", "This setup token has already been used");
    }
    if (row.expires_at < new Date()) {
      throw new AppError(410, "TOKEN_EXPIRED", "This setup token has expired");
    }

    // Step 3: Assert email free (Option C — never mutate existing user)
    const existingUser = await tx.user.findUnique({ where: { email } });
    if (existingUser) {
      throw new AppError(409, "EMAIL_EXISTS", "An account with this email already exists");
    }

    // Step 4: Create fresh super-admin user (operator-vouched, emailVerifiedAt set).
    // isSuperAdmin=true is set here atomically alongside isInstanceAdmin=true (MEDIUM-1,
    // KAN-49): single source of truth on the user row, avoids InstanceSettings JOIN in /me.
    const passwordHash = await hashPassword(password);
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
        isSuperAdmin: true,
        isInstanceAdmin: true,
      },
    });

    // Step 5: Set ownerUserId on singleton
    await tx.instanceSettings.update({
      where: { id: INSTANCE_SETTINGS_ID },
      data: { ownerUserId: user.id },
    });

    // Step 5b: grantInstanceAdmin is now a no-op (already set in Step 4), but kept
    // for backward-compat and belt-and-suspenders idempotency.
    await grantInstanceAdmin(tx, user.id);

    // Step 6: Mark token used
    await tx.setupToken.update({
      where: { id: row.id },
      data: { usedAt: new Date() },
    });

    // Step 7: Return web session (signTokens — no RefreshToken row, no workspaceId)
    return signTokens({ sub: user.id, email: user.email });
  });
}

// ─── Settings ────────────────────────────────────────────────────────────────

/**
 * Fetch the singleton InstanceSettings record.
 * Always returns a record (singleton guaranteed by migration).
 */
export async function getSettings() {
  const settings = await prisma.instanceSettings.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
  });
  if (!settings) {
    throw new AppError(500, "INSTANCE_NOT_INITIALIZED", "Instance settings not found");
  }
  return settings;
}

/**
 * Update InstanceSettings fields.
 * signupMode and allowedSignupDomains are stored but NOT enforced (layer 2 deferred).
 */
export async function patchSettings(body: PatchSettingsBodyType) {
  return prisma.instanceSettings.update({
    where: { id: INSTANCE_SETTINGS_ID },
    data: {
      ...(body.instanceName !== undefined ? { instanceName: body.instanceName } : {}),
      ...(body.signupMode !== undefined ? { signupMode: body.signupMode } : {}),
      ...(body.allowedSignupDomains !== undefined
        ? { allowedSignupDomains: body.allowedSignupDomains }
        : {}),
    },
  });
}

// ─── Instance Admin Invite (PR1b) ────────────────────────────────────────────

const DEFAULT_INVITE_TTL_HOURS = 72;

/**
 * Mint an instance-level admin invite JWT (PR1b, KAN-49 first-run-bootstrap).
 *
 * Design notes:
 *   - Uses a SEPARATE `InstanceAdminInvite` table (not workspace_invites) to avoid
 *     nullable surgery on workspace_invites.workspaceId.
 *   - JWT scope="instance_onboard", sub=inviteId. id is pre-generated so the JWT
 *     sub and the DB row id are identical (no chicken-and-egg).
 *   - kanon:// URL mirrors createOnboardingInvite in invite/service.ts.
 *   - Caller owns the transaction (passed as tx).
 *
 * @param tx         - Prisma transaction client (caller owns the transaction)
 * @param opts.email      - Recipient email (admin-controlled)
 * @param opts.ttlHours   - Token TTL in hours (default: 72)
 * @param opts.createdById - ID of the super-admin minting the invite
 * @returns { inviteId, url, token, expiresAt }
 */
export async function mintInstanceAdminInvite(
  tx: Prisma.TransactionClient,
  opts: { email: string; ttlHours?: number; createdById: string },
): Promise<{ inviteId: string; url: string; token: string; expiresAt: string }> {
  const ttlHours = opts.ttlHours ?? DEFAULT_INVITE_TTL_HOURS;
  const expiresAt = new Date(Date.now() + ttlHours * 60 * 60 * 1000);

  // Pre-generate the id so JWT sub === row id (no chicken-and-egg).
  const id = randomUUID();

  // Sign JWT: scope=instance_onboard, sub=id
  const jwtToken = jwt.sign(
    { sub: id, scope: "instance_onboard" },
    env.JWT_SECRET,
    { expiresIn: `${ttlHours}h` },
  );

  // Persist the invite row
  const invite = await tx.instanceAdminInvite.create({
    data: {
      id,
      token: jwtToken,
      email: opts.email,
      jwtSub: id,
      expiresAt,
      createdById: opts.createdById,
    },
  });

  // Build kanon:// URL — mirrors invite/service.ts createOnboardingInvite
  const host = new URL(env.BASE_URL).host;
  const url = `kanon://${host}/onboard?token=${jwtToken}`;

  return {
    inviteId: invite.id,
    url,
    token: jwtToken,
    expiresAt: invite.expiresAt.toISOString(),
  };
}

/**
 * Consume an instance-admin invite JWT (PR1b, KAN-49 first-run-bootstrap).
 *
 * Verifies the JWT signature, looks up the InstanceAdminInvite by sub,
 * asserts not consumed / not revoked / not expired, then:
 *   1. Calls grantInstanceAdmin(tx, userId) to set isInstanceAdmin=true.
 *   2. Sets consumedAt on the invite row.
 *
 * All steps run inside the caller's transaction — atomic with the caller's work.
 *
 * Error map:
 *   - 400 INVALID_TOKEN   — bad signature / wrong scope
 *   - 410 TOKEN_EXPIRED   — JWT or DB expiry in the past
 *   - 410 TOKEN_CONSUMED  — invite.consumedAt already set
 *   - 400 TOKEN_REVOKED   — invite.revokedAt set
 *   - 404 INVITE_NOT_FOUND — no row for the JWT sub
 *
 * @param tx        - Prisma transaction client (caller owns the transaction)
 * @param jwtToken  - Raw JWT string from the kanon:// URL
 * @param userId    - The user to grant instance-admin to (already resolved by caller)
 */
export async function consumeInstanceAdminInvite(
  tx: Prisma.TransactionClient,
  jwtToken: string,
  userId: string,
): Promise<void> {
  // 1. Verify JWT signature + expiry
  let payload: { sub: string; scope: string };
  try {
    payload = jwt.verify(jwtToken, env.JWT_SECRET) as { sub: string; scope: string };
  } catch (err: unknown) {
    if (err instanceof Error && err.name === "TokenExpiredError") {
      throw new AppError(410, "TOKEN_EXPIRED", "Instance admin invite token has expired");
    }
    throw new AppError(400, "INVALID_TOKEN", "Invalid instance admin invite token");
  }

  // 2. Assert scope
  if (payload.scope !== "instance_onboard") {
    throw new AppError(400, "INVALID_TOKEN", "Invalid token scope");
  }

  // 3. Look up invite row by sub (= id = jwtSub)
  const invite = await tx.instanceAdminInvite.findUnique({
    where: { jwtSub: payload.sub },
  });
  if (!invite) {
    throw new AppError(404, "INVITE_NOT_FOUND", "Instance admin invite not found");
  }

  // 4. Status guards (after lookup — defense-in-depth beyond JWT exp)
  if (invite.revokedAt) {
    throw new AppError(400, "TOKEN_REVOKED", "Instance admin invite has been revoked");
  }
  if (invite.consumedAt) {
    throw new AppError(410, "TOKEN_CONSUMED", "Instance admin invite has already been consumed");
  }
  if (invite.expiresAt < new Date()) {
    throw new AppError(410, "TOKEN_EXPIRED", "Instance admin invite has expired");
  }

  // 5. Grant instance-admin (idempotent)
  await grantInstanceAdmin(tx, userId);

  // 6. Mark consumed
  await tx.instanceAdminInvite.update({
    where: { id: invite.id },
    data: { consumedAt: new Date() },
  });
}
