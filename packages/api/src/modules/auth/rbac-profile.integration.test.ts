import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
  parseCookies,
  buildCookieString,
} from "../../test/helpers.js";

/**
 * Integration tests for RBAC (role-based access control) and profile endpoints.
 * RBAC now resolves workspace from URL param and verifies membership via Member table.
 */
describe("RBAC & Profile Integration", () => {
  let app: FastifyInstance;
  let workspaceId: string;

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
    const ws = await seedTestWorkspace("rbac-test");
    workspaceId = ws.id;
  });

  // ── RBAC: Project Deletion ─────────────────────────────────────

  describe("Role-protected DELETE /api/projects/:key", () => {
    it("owner can delete a project", async () => {
      const owner = await seedTestMemberWithRole(workspaceId, "owner");
      const project = await seedTestProject(workspaceId, "OWN");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}`,
        headers: {
          authorization: `Bearer ${owner.token}`,
        },
      });

      // Should succeed (200 or 204)
      expect(res.statusCode).toBeLessThan(300);
    });

    it("admin cannot delete a project (owner-only)", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const project = await seedTestProject(workspaceId, "ADM");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}`,
        headers: {
          authorization: `Bearer ${admin.token}`,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    });

    it("member cannot delete a project", async () => {
      const member = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "MEM");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}`,
        headers: {
          authorization: `Bearer ${member.token}`,
        },
      });

      expect(res.statusCode).toBe(403);
    });

    it("viewer cannot delete a project", async () => {
      const viewer = await seedTestMemberWithRole(workspaceId, "viewer");
      const project = await seedTestProject(workspaceId, "VWR");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}`,
        headers: {
          authorization: `Bearer ${viewer.token}`,
        },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    });
  });

  // ── Profile CRUD ───────────────────────────────────────────────

  describe("Profile endpoints: GET/PATCH /api/members/me", () => {
    it("GET /api/members/me returns the authenticated user profile", async () => {
      const member = await seedTestMemberWithRole(workspaceId, "member");

      const res = await app.inject({
        method: "GET",
        url: "/api/members/me",
        headers: {
          authorization: `Bearer ${member.token}`,
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(member.id);
      expect(body.email).toBe(member.email);
      expect(body).toHaveProperty("displayName");
      expect(body).toHaveProperty("avatarUrl");
      expect(body).toHaveProperty("role");
      expect(body).toHaveProperty("workspaceId");
    });

    it("PATCH /api/members/me updates displayName", async () => {
      const member = await seedTestMemberWithRole(workspaceId, "member");

      const res = await app.inject({
        method: "PATCH",
        url: "/api/members/me",
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        payload: { displayName: "New Display Name" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.displayName).toBe("New Display Name");
    });

    it("PATCH /api/members/me updates avatarUrl with valid URL", async () => {
      const member = await seedTestMemberWithRole(workspaceId, "member");

      const res = await app.inject({
        method: "PATCH",
        url: "/api/members/me",
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        payload: { avatarUrl: "https://example.com/avatar.png" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.avatarUrl).toBe("https://example.com/avatar.png");
    });

    it("PATCH /api/members/me rejects invalid avatarUrl", async () => {
      const member = await seedTestMemberWithRole(workspaceId, "member");

      const res = await app.inject({
        method: "PATCH",
        url: "/api/members/me",
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        payload: { avatarUrl: "not-a-url" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("PATCH /api/members/me can set displayName to null", async () => {
      const member = await seedTestMemberWithRole(workspaceId, "member");

      // First set a display name
      await app.inject({
        method: "PATCH",
        url: "/api/members/me",
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        payload: { displayName: "Temp Name" },
      });

      // Then clear it
      const res = await app.inject({
        method: "PATCH",
        url: "/api/members/me",
        headers: {
          authorization: `Bearer ${member.token}`,
          "content-type": "application/json",
        },
        payload: { displayName: null },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().displayName).toBeNull();
    });
  });

  // ── Change Password ────────────────────────────────────────────

  describe("POST /api/auth/change-password", () => {
    it("changes password with correct current password", async () => {
      // Register a user with known password (no workspace)
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "chgpwd@kanon.io",
          password: "OldPass123!",
        },
      });

      // Login to get auth token
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "chgpwd@kanon.io",
          password: "OldPass123!",
        },
      });

      const cookies = parseCookies(loginRes.headers["set-cookie"]);

      // Change password
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/change-password",
        headers: {
          cookie: buildCookieString(cookies),
          "x-csrf-token": cookies["kanon_csrf"],
          "content-type": "application/json",
        },
        payload: {
          currentPassword: "OldPass123!",
          newPassword: "NewPass456!",
        },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().success).toBe(true);

      // Verify new password works for login
      const newLoginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "chgpwd@kanon.io",
          password: "NewPass456!",
        },
      });
      expect(newLoginRes.statusCode).toBe(200);
    });

    it("rejects wrong current password", async () => {
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "wrongpwd@kanon.io",
          password: "Correct123!",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "wrongpwd@kanon.io",
          password: "Correct123!",
        },
      });

      const cookies = parseCookies(loginRes.headers["set-cookie"]);

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/change-password",
        headers: {
          cookie: buildCookieString(cookies),
          "x-csrf-token": cookies["kanon_csrf"],
          "content-type": "application/json",
        },
        payload: {
          currentPassword: "WrongPassword!",
          newPassword: "NewPass456!",
        },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_PASSWORD");
    });

    it("requires authentication", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/change-password",
        headers: {
          "content-type": "application/json",
        },
        payload: {
          currentPassword: "Old123!",
          newPassword: "New123456!",
        },
      });

      expect(res.statusCode).toBe(401);
    });
  });
});
