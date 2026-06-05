/**
 * Instance Layer — Service tests (real DB)
 *
 * Tests for:
 * - 1a.1 / 1a.3: grantInstanceAdmin idempotency
 * - 1a.8 / 1a.9: claimInstance dual-grant (ownerUserId + isInstanceAdmin)
 *
 * No vi.mock — all real Prisma.
 */
import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";
import { prisma } from "../../config/prisma.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import { cleanDatabase, disconnectTestDb } from "../../test/helpers.js";
import { grantInstanceAdmin, claimInstance, mintInstanceAdminInvite, consumeInstanceAdminInvite } from "./service.js";
import { sha256Hex, generateOpaqueToken } from "../auth/service.js";

// ---------------------------------------------------------------------------
// Shared cleanup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await disconnectTestDb();
});

// ---------------------------------------------------------------------------
// Helper: create a minimal test user directly via Prisma
// ---------------------------------------------------------------------------
async function createTestUser(email?: string): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({
    data: {
      email: email ?? `test-${randomUUID().slice(0, 8)}@kanon.test`,
      passwordHash: "$2b$04$placeholder",
    },
  });
  return user;
}

// ---------------------------------------------------------------------------
// 1a.1 / 1a.3 — grantInstanceAdmin idempotency
// ---------------------------------------------------------------------------

describe("grantInstanceAdmin", () => {
  it("sets isInstanceAdmin=true for a user", async () => {
    const user = await createTestUser();

    await prisma.$transaction((tx) => grantInstanceAdmin(tx, user.id));

    const updated = await prisma.user.findUnique({
      where: { id: user.id },
      select: { isInstanceAdmin: true },
    });
    expect(updated?.isInstanceAdmin).toBe(true);
  });

  it("is idempotent — calling twice leaves flag true with no error", async () => {
    const user = await createTestUser();

    await prisma.$transaction((tx) => grantInstanceAdmin(tx, user.id));
    await prisma.$transaction((tx) => grantInstanceAdmin(tx, user.id));

    const updated = await prisma.user.findUnique({
      where: { id: user.id },
      select: { isInstanceAdmin: true },
    });
    expect(updated?.isInstanceAdmin).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 1a.8 / 1a.9 — claimInstance dual-grant
// ---------------------------------------------------------------------------

async function seedLiveToken(ttlDays = 7): Promise<string> {
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

describe("claimInstance dual-grant", () => {
  it("fresh claim sets ownerUserId AND isInstanceAdmin=true AND isSuperAdmin=true on the claimant (FIX4)", async () => {
    const rawToken = await seedLiveToken();

    await claimInstance({
      token: rawToken,
      email: "fix4-claim@kanon.test",
      password: "SecurePassword123!",
    });

    const user = await prisma.user.findUnique({
      where: { email: "fix4-claim@kanon.test" },
      select: { isSuperAdmin: true, isInstanceAdmin: true },
    });
    expect(user?.isSuperAdmin).toBe(true);
    expect(user?.isInstanceAdmin).toBe(true);
  });

  it("fresh claim sets ownerUserId AND isInstanceAdmin=true on the claimant", async () => {
    const rawToken = await seedLiveToken();

    await claimInstance({
      token: rawToken,
      email: "admin@kanon.test",
      password: "SecurePassword123!",
    });

    // Verify super-admin set
    const settings = await prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { ownerUserId: true },
    });
    expect(settings?.ownerUserId).not.toBeNull();

    // Verify instance-admin flag set on same user
    const user = await prisma.user.findUnique({
      where: { email: "admin@kanon.test" },
      select: { id: true, isInstanceAdmin: true },
    });
    expect(user).not.toBeNull();
    expect(user?.isInstanceAdmin).toBe(true);
    expect(user?.id).toBe(settings?.ownerUserId);
  });

  it("second claim attempt with consumed token throws 410 TOKEN_USED and leaves state unchanged", async () => {
    const rawToken = await seedLiveToken();

    // First claim — succeeds, consumes the token
    await claimInstance({
      token: rawToken,
      email: "admin@kanon.test",
      password: "SecurePassword123!",
    });

    // Capture DB state after first claim (fresh fetch)
    const settingsAfterFirst = await prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { ownerUserId: true },
    });
    const ownerIdAfterFirst = settingsAfterFirst?.ownerUserId;
    expect(ownerIdAfterFirst).not.toBeNull();

    // Second claim attempt with the same (now-consumed) token — must throw 410
    await expect(
      claimInstance({
        token: rawToken,
        email: "admin2@kanon.test",
        password: "SecurePassword123!",
      }),
    ).rejects.toMatchObject({ statusCode: 410, code: "TOKEN_USED" });

    // Fresh DB fetch after the second attempt — ownerUserId must be UNCHANGED
    const settingsAfterSecond = await prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { ownerUserId: true },
    });
    expect(settingsAfterSecond?.ownerUserId).toBe(ownerIdAfterFirst);

    // The original user retains their instance-admin flag
    const user = await prisma.user.findUnique({
      where: { email: "admin@kanon.test" },
      select: { isInstanceAdmin: true },
    });
    expect(user?.isInstanceAdmin).toBe(true);

    // No second user was created
    const users = await prisma.user.findMany({ where: { email: "admin2@kanon.test" } });
    expect(users).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 1b.1 / 1b.3 / 1b.4 — mintInstanceAdminInvite + consumeInstanceAdminInvite
// ---------------------------------------------------------------------------

async function createSuperAdmin(): Promise<{ id: string; email: string }> {
  const user = await prisma.user.create({
    data: {
      email: `super-${randomUUID().slice(0, 8)}@kanon.test`,
      passwordHash: "$2b$04$placeholder",
      isSuperAdmin: true,
      isInstanceAdmin: true,
    },
  });
  return user;
}

describe("mintInstanceAdminInvite + consumeInstanceAdminInvite", () => {
  it("1b.1: consumeInstanceAdminInvite grants isInstanceAdmin=true and marks token consumed", async () => {
    const admin = await createSuperAdmin();
    // Mint invite
    const { token, inviteId } = await prisma.$transaction((tx) =>
      mintInstanceAdminInvite(tx, { email: "invitee@kanon.test", createdById: admin.id }),
    );

    // Create the invitee user (passwordless)
    const invitee = await prisma.user.create({
      data: { email: "invitee@kanon.test", passwordHash: null },
    });

    // Consume
    await prisma.$transaction((tx) => consumeInstanceAdminInvite(tx, token, invitee.id));

    // Assert isInstanceAdmin=true
    const updated = await prisma.user.findUnique({
      where: { id: invitee.id },
      select: { isInstanceAdmin: true },
    });
    expect(updated?.isInstanceAdmin).toBe(true);

    // Assert consumedAt set on invite row
    const invite = await (prisma as any).instanceAdminInvite.findUnique({
      where: { id: inviteId },
      select: { consumedAt: true },
    });
    expect(invite?.consumedAt).not.toBeNull();
  });

  it("1b.1: reusing a consumed token returns 4xx (TOKEN_CONSUMED)", async () => {
    const admin = await createSuperAdmin();
    const { token } = await prisma.$transaction((tx) =>
      mintInstanceAdminInvite(tx, { email: "invitee2@kanon.test", createdById: admin.id }),
    );

    const invitee = await prisma.user.create({
      data: { email: "invitee2@kanon.test", passwordHash: null },
    });

    // First consume — succeeds
    await prisma.$transaction((tx) => consumeInstanceAdminInvite(tx, token, invitee.id));

    // Second consume — must reject
    const invitee2 = await prisma.user.create({
      data: { email: "invitee2b@kanon.test", passwordHash: null },
    });
    await expect(
      prisma.$transaction((tx) => consumeInstanceAdminInvite(tx, token, invitee2.id)),
    ).rejects.toMatchObject({ statusCode: 410, code: "TOKEN_CONSUMED" });
  });

  it("1b.3: mintInstanceAdminInvite returns { inviteId, url, token, expiresAt } with correct structure", async () => {
    const admin = await createSuperAdmin();
    const result = await prisma.$transaction((tx) =>
      mintInstanceAdminInvite(tx, { email: "newinvitee@kanon.test", createdById: admin.id }),
    );

    expect(result).toHaveProperty("inviteId");
    expect(result).toHaveProperty("url");
    expect(result).toHaveProperty("token");
    expect(result).toHaveProperty("expiresAt");

    // url is kanon://
    expect(result.url).toMatch(/^kanon:\/\//);

    // token is a valid JWT with scope=instance_onboard
    const payload = jwt.decode(result.token) as Record<string, unknown>;
    expect(payload["scope"]).toBe("instance_onboard");
    expect(typeof payload["sub"]).toBe("string");
  });
});
