/**
 * Instance Layer service (KAN-49).
 *
 * Exports:
 *  - bootstrapSetupToken:  extracted onReady logic (unit-testable)
 *  - grantInstanceAdmin:   idempotent instance-admin grant helper (PR1a)
 *  - claimInstance:        atomic claim transaction
 *  - getSettings:          fetch singleton settings
 *  - patchSettings:        update singleton settings
 */
import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import {
  generateOpaqueToken,
  sha256Hex,
  hashPassword,
  signTokens,
} from "../auth/service.js";
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

    // Step 4: Create fresh super-admin user (operator-vouched, emailVerifiedAt set)
    const passwordHash = await hashPassword(password);
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        emailVerifiedAt: new Date(),
      },
    });

    // Step 5: Set ownerUserId on singleton
    await tx.instanceSettings.update({
      where: { id: INSTANCE_SETTINGS_ID },
      data: { ownerUserId: user.id },
    });

    // Step 5b: Grant instance-admin to the claimant (dual-grant, PR1a KAN-49).
    // grantInstanceAdmin is idempotent — set-true-twice is a no-op.
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
