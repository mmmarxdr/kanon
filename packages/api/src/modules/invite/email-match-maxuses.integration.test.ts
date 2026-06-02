import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  cleanDatabase,
  disconnectTestDb,
  generateTestToken,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";

/**
 * Integration tests for:
 *  - R-NUI-emailmatch: acceptInvite enforces invite.email when set
 *  - R-NUI-maxuses: createInvite defaults maxUses=1 for email-targeted invites
 */
describe("Email-match + maxUses defaults (R-NUI-emailmatch, R-NUI-maxuses)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await cleanDatabase();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ── Helpers ──────────────────────────────────────────────────────────

  async function createUserAndToken(email: string) {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("password123", 4);
    const user = await prisma.user.create({
      data: { email, passwordHash: hash, displayName: "Test User" },
    });
    const token = generateTestToken({ userId: user.id, email });
    return { user, token };
  }

  /**
   * Create an email-targeted invite directly in the DB.
   * Used to set invite.email for email-match tests.
   */
  async function createEmailInviteDirectly(
    workspaceId: string,
    createdById: string,
    targetEmail: string | null,
    overrides?: { maxUses?: number },
  ) {
    const token = randomBytes(32).toString("base64url");
    return prisma.workspaceInvite.create({
      data: {
        token,
        role: "member",
        maxUses: overrides?.maxUses ?? 0,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        email: targetEmail,
        workspaceId,
        createdById,
      },
    });
  }

  // ── R-NUI-emailmatch: email mismatch → 403 ───────────────────────────

  it("acceptInvite with invite.email=alice, caller=bob → 403 EMAIL_MISMATCH", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");

    // Invite targeted at alice
    const invite = await createEmailInviteDirectly(ws.id, admin.userId, "alice@kanon.test");

    // Bob tries to accept alice's invite
    const { token: bobToken } = await createUserAndToken("bob@kanon.test");

    const res = await app.inject({
      method: "POST",
      url: `/api/invites/${invite.token}/accept`,
      headers: { authorization: `Bearer ${bobToken}` },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe("EMAIL_MISMATCH");
  });

  // Triangulation: correct email can accept
  it("acceptInvite with invite.email=alice, caller=alice → 201 (accepted)", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");

    const { user: alice, token: aliceToken } = await createUserAndToken("alice@kanon.test");
    const invite = await createEmailInviteDirectly(ws.id, admin.userId, "alice@kanon.test");

    const res = await app.inject({
      method: "POST",
      url: `/api/invites/${invite.token}/accept`,
      headers: { authorization: `Bearer ${aliceToken}` },
    });

    expect(res.statusCode).toBe(201);

    // Alice should now be a member
    const member = await prisma.member.findUnique({
      where: { userId_workspaceId: { userId: alice.id, workspaceId: ws.id } },
    });
    expect(member).not.toBeNull();
  });

  // Triangulation: link invite (email=null) — any authenticated user may accept
  it("link invite (invite.email=null) — any authenticated user may accept", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");

    // No email on this invite
    const invite = await createEmailInviteDirectly(ws.id, admin.userId, null);

    const { user: charlie, token: charlieToken } = await createUserAndToken("charlie@kanon.test");

    const res = await app.inject({
      method: "POST",
      url: `/api/invites/${invite.token}/accept`,
      headers: { authorization: `Bearer ${charlieToken}` },
    });

    expect(res.statusCode).toBe(201);
    const member = await prisma.member.findUnique({
      where: { userId_workspaceId: { userId: charlie.id, workspaceId: ws.id } },
    });
    expect(member).not.toBeNull();
  });

  // ── R-NUI-maxuses: email invite defaults to maxUses=1 ────────────────

  it("createInvite with email set and no explicit maxUses → maxUses=1", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/invites`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { email: "someone@kanon.test" },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.maxUses).toBe(1);
    expect(body.email).toBe("someone@kanon.test");
  });

  // Triangulation: link invite (no email) → maxUses=0 (unlimited)
  it("createInvite with no email and no explicit maxUses → maxUses=0 (unlimited)", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/invites`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: {},
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.maxUses).toBe(0);
    expect(body.email).toBeNull();
  });

  // Triangulation: explicit maxUses overrides default
  it("createInvite with email AND explicit maxUses=3 → maxUses=3 (explicit wins)", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/invites`,
      headers: { authorization: `Bearer ${admin.token}` },
      payload: { email: "someone@kanon.test", maxUses: 3 },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.maxUses).toBe(3);
  });
});
