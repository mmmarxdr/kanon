import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
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
 * Integration tests for workspace invite management.
 * Covers invite CRUD, public metadata, acceptance, domain allowlists,
 * and race condition handling.
 */
describe("Workspace Invites", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ── Helper: create a user not in any workspace ──────────────────────
  async function createStandaloneUser(email?: string) {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("password123", 4);
    const userEmail = email ?? `standalone-${Date.now()}@kanon.test`;
    const user = await prisma.user.create({
      data: {
        email: userEmail,
        passwordHash: hash,
        displayName: "Standalone User",
      },
    });
    const token = generateTestToken({ userId: user.id, email: userEmail });
    return { user, token, email: userEmail };
  }

  // ── Helper: create invite directly in DB ────────────────────────────
  async function createInviteDirectly(
    workspaceId: string,
    createdById: string,
    overrides?: {
      maxUses?: number;
      expiresAt?: Date;
      revokedAt?: Date | null;
      role?: string;
    },
  ) {
    const { randomBytes } = await import("node:crypto");
    const token = randomBytes(32).toString("base64url");
    return prisma.workspaceInvite.create({
      data: {
        token,
        role: overrides?.role ?? "member",
        maxUses: overrides?.maxUses ?? 0,
        expiresAt: overrides?.expiresAt ?? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        revokedAt: overrides?.revokedAt ?? null,
        workspaceId,
        createdById,
      },
    });
  }

  // ── 6.1: Create invite ──────────────────────────────────────────────

  describe("POST /api/workspaces/:wid/invites", () => {
    it("admin creates invite — returns token, inviteUrl, correct defaults (201)", async () => {
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
      expect(body).toHaveProperty("token");
      expect(body).toHaveProperty("inviteUrl");
      expect(body.inviteUrl).toBe(`/invite/${body.token}`);
      expect(body.role).toBe("member"); // default role
      expect(body.maxUses).toBe(0); // default unlimited
      expect(body.useCount).toBe(0);
      expect(body.revokedAt).toBeNull();
      expect(body.createdBy).toHaveProperty("email", admin.email);
    });

    it("owner creates invite with custom options (201)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/invites`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { role: "viewer", maxUses: 5, expiresInHours: 24, label: "Test invite" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.role).toBe("viewer");
      expect(body.maxUses).toBe(5);
      expect(body.label).toBe("Test invite");
    });

    it("member cannot create invites — 403", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const member = await seedTestMemberWithRole(ws.id, "member");

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/invites`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(403);
    });

    it("viewer cannot create invites — 403", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const viewer = await seedTestMemberWithRole(ws.id, "viewer");

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/invites`,
        headers: { authorization: `Bearer ${viewer.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── 6.1: List invites ──────────────────────────────────────────────

  describe("GET /api/workspaces/:wid/invites", () => {
    it("admin lists all invites for workspace (200)", async () => {
      const ws = await seedTestWorkspace();
      const admin = await seedTestMemberWithRole(ws.id, "admin");

      // Create two invites
      await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/invites`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { label: "Invite 1" },
      });
      await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/invites`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { label: "Invite 2" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/invites`,
        headers: { authorization: `Bearer ${admin.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.invites).toHaveLength(2);
      for (const inv of body.invites) {
        expect(inv).toHaveProperty("token");
        expect(inv).toHaveProperty("inviteUrl");
        expect(inv).toHaveProperty("createdBy");
      }
    });

    it("member cannot list invites — 403", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const member = await seedTestMemberWithRole(ws.id, "member");

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/invites`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── 6.1: Revoke invite ─────────────────────────────────────────────

  describe("DELETE /api/workspaces/:wid/invites/:inviteId", () => {
    it("admin revokes invite — revokedAt is set (200)", async () => {
      const ws = await seedTestWorkspace();
      const admin = await seedTestMemberWithRole(ws.id, "admin");

      // Create an invite
      const createRes = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/invites`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: {},
      });
      const invite = createRes.json();

      const revokeRes = await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/invites/${invite.id}`,
        headers: { authorization: `Bearer ${admin.token}` },
      });

      expect(revokeRes.statusCode).toBe(200);
      const body = revokeRes.json();
      expect(body.revokedAt).not.toBeNull();
    });

    it("revoking already-revoked invite — 422", async () => {
      const ws = await seedTestWorkspace();
      const admin = await seedTestMemberWithRole(ws.id, "admin");

      const createRes = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/invites`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: {},
      });
      const invite = createRes.json();

      // Revoke once
      await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/invites/${invite.id}`,
        headers: { authorization: `Bearer ${admin.token}` },
      });

      // Revoke again
      const res = await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/invites/${invite.id}`,
        headers: { authorization: `Bearer ${admin.token}` },
      });

      expect(res.statusCode).toBe(422);
    });
  });

  // ── 6.1: Get metadata (public) ─────────────────────────────────────

  describe("GET /api/invites/:token", () => {
    it("unauthenticated user gets invite metadata — workspace name, validity (200)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId);

      const res = await app.inject({
        method: "GET",
        url: `/api/invites/${invite.token}`,
        // No auth headers
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.workspaceName).toBe(ws.name);
      expect(body.workspaceSlug).toBe(ws.slug);
      expect(body.role).toBe("member");
      expect(body.isValid).toBe(true);
      expect(body.isExpired).toBe(false);
      expect(body.isExhausted).toBe(false);
      expect(body.isRevoked).toBe(false);
    });

    it("expired invite shows isExpired=true, isValid=false", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId, {
        expiresAt: new Date(Date.now() - 1000), // expired 1 second ago
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/invites/${invite.token}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isExpired).toBe(true);
      expect(body.isValid).toBe(false);
    });

    it("revoked invite shows isRevoked=true, isValid=false", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId, {
        revokedAt: new Date(),
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/invites/${invite.token}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isRevoked).toBe(true);
      expect(body.isValid).toBe(false);
    });

    it("exhausted invite shows isExhausted=true, isValid=false", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId, {
        maxUses: 1,
      });
      // Manually set useCount to maxUses
      await prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { useCount: 1 },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/invites/${invite.token}`,
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.isExhausted).toBe(true);
      expect(body.isValid).toBe(false);
    });

    it("non-existent token — 404", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/invites/nonexistent-token-value",
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── 6.1: Accept invite ─────────────────────────────────────────────

  describe("POST /api/invites/:token/accept", () => {
    it("authenticated user accepts valid invite — becomes workspace member (201)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId);

      const { token, user } = await createStandaloneUser();

      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.role).toBe("member");
      expect(body.user.email).toBe(user.email);

      // Verify member was created in DB
      const member = await prisma.member.findUnique({
        where: { userId_workspaceId: { userId: user.id, workspaceId: ws.id } },
      });
      expect(member).not.toBeNull();
      expect(member!.role).toBe("member");

      // Verify useCount was incremented
      const updatedInvite = await prisma.workspaceInvite.findUnique({
        where: { id: invite.id },
      });
      expect(updatedInvite!.useCount).toBe(1);
    });

    it("already a member — 409", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId);

      // owner is already a member
      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(409);
    });

    it("expired invite — 410", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId, {
        expiresAt: new Date(Date.now() - 1000),
      });

      const { token } = await createStandaloneUser();

      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(410);
    });

    it("revoked invite — 410", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId, {
        revokedAt: new Date(),
      });

      const { token } = await createStandaloneUser();

      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(410);
    });

    it("exhausted invite (maxUses reached) — 410", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId, {
        maxUses: 1,
      });
      // Simulate the invite already being used
      await prisma.workspaceInvite.update({
        where: { id: invite.id },
        data: { useCount: 1 },
      });

      const { token } = await createStandaloneUser();

      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(410);
    });

    it("unauthenticated user cannot accept — 401", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId);

      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        // No auth
        payload: {},
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── 6.2: Race condition test ────────────────────────────────────────

  describe("Concurrent invite acceptance (race condition)", () => {
    it("only 1 of 2 concurrent accepts succeeds for maxUses=1 invite", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId, {
        maxUses: 1,
      });

      // Create two standalone users
      const user1 = await createStandaloneUser(`racer1-${Date.now()}@kanon.test`);
      const user2 = await createStandaloneUser(`racer2-${Date.now()}@kanon.test`);

      // Fire both accept requests concurrently
      const [res1, res2] = await Promise.all([
        app.inject({
          method: "POST",
          url: `/api/invites/${invite.token}/accept`,
          headers: { authorization: `Bearer ${user1.token}` },
          payload: {},
        }),
        app.inject({
          method: "POST",
          url: `/api/invites/${invite.token}/accept`,
          headers: { authorization: `Bearer ${user2.token}` },
          payload: {},
        }),
      ]);

      const statuses = [res1.statusCode, res2.statusCode].sort();
      // One should succeed (201), the other should fail (410 exhausted)
      expect(statuses).toContain(201);
      expect(statuses.filter((s) => s === 201)).toHaveLength(1);

      // Verify useCount is exactly 1
      const updatedInvite = await prisma.workspaceInvite.findUnique({
        where: { id: invite.id },
      });
      expect(updatedInvite!.useCount).toBe(1);

      // Verify exactly one member was created
      const members = await prisma.member.findMany({
        where: {
          workspaceId: ws.id,
          userId: { in: [user1.user.id, user2.user.id] },
        },
      });
      expect(members).toHaveLength(1);
    });
  });

  // ── 6.3: Domain allowlist tests ─────────────────────────────────────

  describe("Domain allowlist", () => {
    it("user with allowed domain can accept invite (201)", async () => {
      const ws = await prisma.workspace.create({
        data: {
          name: "Domain Test WS",
          slug: `domain-ws-${Date.now()}`,
          allowedDomains: ["company.com"],
        },
      });
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId);

      const { token } = await createStandaloneUser(`allowed@company.com`);

      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(201);
    });

    it("user with disallowed domain cannot accept invite — 403", async () => {
      const ws = await prisma.workspace.create({
        data: {
          name: "Domain Test WS",
          slug: `domain-ws-${Date.now()}`,
          allowedDomains: ["company.com"],
        },
      });
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId);

      const { token } = await createStandaloneUser(`outsider@gmail.com`);

      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(403);
    });

    it("empty allowedDomains means any domain can accept (201)", async () => {
      const ws = await prisma.workspace.create({
        data: {
          name: "Open Domain WS",
          slug: `open-ws-${Date.now()}`,
          allowedDomains: [],
        },
      });
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId);

      const { token } = await createStandaloneUser(`anyone@random.org`);

      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(201);
    });

    it("domain check is case-insensitive (201)", async () => {
      const ws = await prisma.workspace.create({
        data: {
          name: "Case Insensitive WS",
          slug: `case-ws-${Date.now()}`,
          allowedDomains: ["Company.COM"],
        },
      });
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const invite = await createInviteDirectly(ws.id, owner.userId);

      const { token } = await createStandaloneUser(`user@company.com`);

      const res = await app.inject({
        method: "POST",
        url: `/api/invites/${invite.token}/accept`,
        headers: { authorization: `Bearer ${token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(201);
    });
  });
});
