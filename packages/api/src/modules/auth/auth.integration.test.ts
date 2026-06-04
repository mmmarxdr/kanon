import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  generateTestToken,
  generateTestRefreshToken,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";

/**
 * Integration tests for the auth module.
 * Requires a running PostgreSQL database (via docker-compose).
 */
describe("Auth Integration", () => {
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

  // ── Registration ─────────────────────────────────────────────────────

  describe("POST /api/auth/register", () => {
    it("registers a new user (no workspace required)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
          displayName: "Dev User",
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty("id");
      expect(body.email).toBe("dev@kanon.io");
      expect(body.displayName).toBe("Dev User");
      // Password should NOT be in the response
      expect(body).not.toHaveProperty("password");
      expect(body).not.toHaveProperty("passwordHash");
      // No workspace fields
      expect(body).not.toHaveProperty("workspaceId");
      expect(body).not.toHaveProperty("username");
    });

    it("rejects duplicate email", async () => {
      // Register first
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
        },
      });

      // Try duplicate
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe("DUPLICATE_EMAIL");
    });

    it("rejects invalid email format", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "not-an-email",
          password: "Secret123!",
        },
      });

      expect(res.statusCode).toBe(400);
    });

    it("rejects weak password (< 8 chars)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "weak@kanon.io",
          password: "short",
        },
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── Login ────────────────────────────────────────────────────────────

  describe("POST /api/auth/login", () => {
    beforeEach(async () => {
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
        },
      });
    });

    it("returns tokens for valid credentials (no workspace)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("accessToken");
      expect(body).toHaveProperty("refreshToken");
      expect(typeof body.accessToken).toBe("string");
      expect(typeof body.refreshToken).toBe("string");
    });

    it("rejects invalid password", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "dev@kanon.io",
          password: "WrongPassword!",
        },
      });

      expect(res.statusCode).toBe(401);
    });

    it("rejects non-existent email", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "nobody@kanon.io",
          password: "Secret123!",
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── Token Refresh ────────────────────────────────────────────────────

  describe("POST /api/auth/refresh", () => {
    it("returns new access token for valid refresh token", async () => {
      // Register and login to get real tokens
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
        },
      });

      const { refreshToken } = loginRes.json();

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        payload: { refreshToken },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("accessToken");
      expect(typeof body.accessToken).toBe("string");
    });

    it("rejects invalid refresh token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        payload: { refreshToken: "invalid.jwt.token" },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── /me Endpoint ────────────────────────────────────────────────────

  describe("GET /api/auth/me", () => {
    it("returns user-level data with valid token", async () => {
      // Register
      const regRes = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "me@kanon.io",
          password: "Secret123!",
          displayName: "Me User",
        },
      });

      // Login to get real token
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "me@kanon.io",
          password: "Secret123!",
        },
      });

      const { accessToken } = loginRes.json();

      const meRes = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(meRes.statusCode).toBe(200);
      const me = meRes.json();
      expect(me.email).toBe("me@kanon.io");
      expect(me.displayName).toBe("Me User");
      expect(me).toHaveProperty("userId");
      expect(me).toHaveProperty("avatarUrl");
      // Must NOT contain workspace fields
      expect(me).not.toHaveProperty("workspaceId");
      expect(me).not.toHaveProperty("role");
      expect(me).not.toHaveProperty("memberId");
    });

    it("returns 401 without any auth", async () => {
      const meRes = await app.inject({
        method: "GET",
        url: "/api/auth/me",
      });

      expect(meRes.statusCode).toBe(401);
    });

    // 1a.10 / 1a.11 — isSuperAdmin + isInstanceAdmin flags (KAN-49 PR1a)

    it("returns isSuperAdmin:true and isInstanceAdmin:true for patient-zero user", async () => {
      // Seed a live token and claim the instance to create the patient-zero user
      const { sha256Hex } = await import("../auth/service.js");
      const { generateOpaqueToken } = await import("../auth/service.js");
      const raw = generateOpaqueToken();
      const hash = sha256Hex(raw);
      await prisma.setupToken.create({
        data: {
          tokenHash: hash,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
        },
      });

      const claimRes = await app.inject({
        method: "POST",
        url: "/api/instance/setup/claim",
        payload: {
          token: raw,
          email: "patient-zero@kanon.test",
          password: "SecurePassword123!",
        },
      });
      expect(claimRes.statusCode).toBe(200);
      const { accessToken } = claimRes.json();

      const meRes = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(meRes.statusCode).toBe(200);
      const me = meRes.json();
      expect(me.isSuperAdmin).toBe(true);
      expect(me.isInstanceAdmin).toBe(true);
    });

    it("returns isSuperAdmin:false and isInstanceAdmin:false for workspace-only user", async () => {
      // Plain registered user — no instance roles
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "plain-ws-user@kanon.test",
          password: "Secret123!",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "plain-ws-user@kanon.test",
          password: "Secret123!",
        },
      });
      const { accessToken } = loginRes.json();

      const meRes = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: { authorization: `Bearer ${accessToken}` },
      });

      expect(meRes.statusCode).toBe(200);
      const me = meRes.json();
      expect(me.isSuperAdmin).toBe(false);
      expect(me.isInstanceAdmin).toBe(false);
    });
  });

  // ── Route Protection ─────────────────────────────────────────────────

  describe("Route Protection", () => {
    it("allows access to public auth routes without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
        },
      });

      // Should not be 401 (may be 201 or other non-auth error)
      expect(res.statusCode).not.toBe(401);
    });

    it("rejects protected routes without token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/workspaces",
      });

      expect(res.statusCode).toBe(401);
    });

    it("allows protected routes with valid token", async () => {
      const token = generateTestToken();

      const res = await app.inject({
        method: "GET",
        url: "/api/workspaces",
        headers: { authorization: `Bearer ${token}` },
      });

      // Should not be 401 (may be 200 or other non-auth error)
      expect(res.statusCode).not.toBe(401);
    });

    it("allows health check without token", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/health",
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.status).toBe("ok");
      expect(body.db).toBe("connected");
    });
  });

  // ── Phase 6 (PR2): onboard applies project assignments ─────────────────────

  describe("POST /api/auth/onboard — project assignment application (R-INV-onboard)", () => {
    /**
     * Helper: create an onboarding invite directly in DB with projectAssignments.
     * Returns the signed JWT token needed to call /api/auth/onboard.
     */
    async function createOnboardingInviteWithAssignments(
      workspaceId: string,
      createdById: string,
      targetEmail: string,
      projectAssignments: Array<{ projectId: string; role: string }>,
    ): Promise<string> {
      const { randomBytes } = await import("node:crypto");
      const jwt = await import("jsonwebtoken");
      const opaqueToken = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

      const invite = await prisma.workspaceInvite.create({
        data: {
          token: opaqueToken,
          role: "member",
          maxUses: 1,
          expiresAt,
          label: "Onboarding link",
          email: targetEmail,
          kind: "ONBOARDING",
          workspaceId,
          createdById,
          projectAssignments: projectAssignments as any,
        },
      });

      // Sign the JWT the same way createOnboardingInvite does
      return jwt.sign(
        { sub: invite.id, scope: "onboard" },
        process.env["JWT_SECRET"]!,
        { expiresIn: "72h" },
      );
    }

    // 6.3-T1: onboard with assignments → PM rows created + invite consumed
    it("onboard with assignments → PM rows created and invite consumed", async () => {
      const ws = await seedTestWorkspace();
      const admin = await seedTestMemberWithRole(ws.id, "admin");
      const dev = await seedTestMemberWithRole(ws.id, "member");
      const projectA = await seedTestProject(ws.id, "OPA1");
      const projectB = await seedTestProject(ws.id, "OPB1");

      const onboardToken = await createOnboardingInviteWithAssignments(
        ws.id,
        admin.userId,
        dev.email,
        [
          { projectId: projectA.id, role: "member" },
          { projectId: projectB.id, role: "viewer" },
        ],
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/onboard",
        payload: { token: onboardToken },
      });

      expect(res.statusCode).toBe(200);

      // PM rows created for dev.userId (not member.id)
      const pmRows = await prisma.projectMember.findMany({
        where: { userId: dev.userId },
        orderBy: { projectId: "asc" },
      });
      expect(pmRows).toHaveLength(2);
      for (const pm of pmRows) {
        expect(pm.userId).toBe(dev.userId);
      }

      // Invite consumed
      const invite = await prisma.workspaceInvite.findFirst({
        where: { email: dev.email, kind: "ONBOARDING" },
      });
      expect(invite?.consumedAt).not.toBeNull();
    });

    // 6.3-T2: stale project → skipped + invite still consumed (R-INV-idempotent)
    it("stale project in assignments → skipped, invite consumed normally", async () => {
      const ws = await seedTestWorkspace();
      const admin = await seedTestMemberWithRole(ws.id, "admin");
      const dev = await seedTestMemberWithRole(ws.id, "member");
      const liveProject = await seedTestProject(ws.id, "OLIV1");
      const STALE_ID = "00000000-dead-dead-dead-000000000002";

      const onboardToken = await createOnboardingInviteWithAssignments(
        ws.id,
        admin.userId,
        dev.email,
        [
          { projectId: liveProject.id, role: "admin" },
          { projectId: STALE_ID, role: "member" },
        ],
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/onboard",
        payload: { token: onboardToken },
      });

      expect(res.statusCode).toBe(200);

      // Only one PM row — for the live project
      const pmRows = await prisma.projectMember.findMany({
        where: { userId: dev.userId },
      });
      expect(pmRows).toHaveLength(1);
      expect(pmRows[0]!.projectId).toBe(liveProject.id);
      expect(pmRows[0]!.role).toBe("admin");

      // Invite consumed (stale project doesn't block consumption)
      const invite = await prisma.workspaceInvite.findFirst({
        where: { email: dev.email, kind: "ONBOARDING" },
      });
      expect(invite?.consumedAt).not.toBeNull();
    });

    // 6.3-T3: no assignments → existing behavior preserved (invite consumed, no PM rows)
    it("onboard with no assignments → invite consumed, no PM rows", async () => {
      const ws = await seedTestWorkspace();
      const admin = await seedTestMemberWithRole(ws.id, "admin");
      const dev = await seedTestMemberWithRole(ws.id, "member");

      const onboardToken = await createOnboardingInviteWithAssignments(
        ws.id,
        admin.userId,
        dev.email,
        [], // no assignments
      );

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/onboard",
        payload: { token: onboardToken },
      });

      expect(res.statusCode).toBe(200);

      const pmRows = await prisma.projectMember.findMany({
        where: { userId: dev.userId },
      });
      expect(pmRows).toHaveLength(0);
    });
  });

  // ── X-API-Key hard cut (KAN-35 / PR1) ────────────────────────────────────
  // After PR1, the X-API-Key auth path is removed. Any request carrying that
  // header on a protected route MUST receive 401 — no silent fallback.

  describe("X-API-Key header rejected (wrapper-only auth)", () => {
    it("401 on protected route with X-API-Key header (no bearer)", async () => {
      const ws = await seedTestWorkspace();
      // Register a user to get a valid userId for a "well-formed" API key attempt
      const reg = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: { email: "apikey-test@example.com", password: "Secret123!" },
      });
      expect(reg.statusCode).toBe(201);

      // Send a request to a protected route with only X-API-Key
      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}`,
        headers: { "x-api-key": "some-key-that-should-no-longer-work" },
      });

      // Must be 401 — X-API-Key is no longer accepted
      expect(res.statusCode).toBe(401);
    });

    it("401 on protected route with no auth at all", async () => {
      const ws = await seedTestWorkspace();

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}`,
        // No Authorization header, no cookie, no X-API-Key
      });

      expect(res.statusCode).toBe(401);
    });

    it("POST /api/auth/api-key endpoint no longer exists (404 or 405)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/api-key",
        headers: { authorization: "Bearer fake-token" },
        payload: {},
      });

      // Route is removed — must be 404 (not found) after PR1
      expect(res.statusCode).toBe(404);
    });
  });
});
