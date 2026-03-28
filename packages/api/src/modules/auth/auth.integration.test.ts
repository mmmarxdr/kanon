import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  generateTestToken,
  generateTestRefreshToken,
  seedTestWorkspace,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";

/**
 * Integration tests for the auth module.
 * Requires a running PostgreSQL database (via docker-compose).
 */
describe("Auth Integration", () => {
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
    const ws = await seedTestWorkspace("auth-test");
    workspaceId = ws.id;
  });

  // ── Registration ─────────────────────────────────────────────────────

  describe("POST /api/auth/register", () => {
    it("registers a new member", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          username: "dev",
          password: "Secret123!",
          workspaceId,
        },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body).toHaveProperty("id");
      expect(body.email).toBe("dev@kanon.io");
      expect(body.username).toBe("dev");
      // Password should NOT be in the response
      expect(body).not.toHaveProperty("password");
      expect(body).not.toHaveProperty("passwordHash");
    });

    it("rejects duplicate email in same workspace", async () => {
      // Register first
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          username: "dev1",
          password: "Secret123!",
          workspaceId,
        },
      });

      // Try duplicate
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          username: "dev2",
          password: "Secret123!",
          workspaceId,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe("DUPLICATE_EMAIL");
    });

    it("rejects duplicate username in same workspace", async () => {
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev1@kanon.io",
          username: "dev",
          password: "Secret123!",
          workspaceId,
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev2@kanon.io",
          username: "dev",
          password: "Secret123!",
          workspaceId,
        },
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe("DUPLICATE_USERNAME");
    });

    it("rejects invalid email format", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "not-an-email",
          username: "dev",
          password: "Secret123!",
          workspaceId,
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
          username: "dev",
          password: "Secret123!",
          workspaceId,
        },
      });
    });

    it("returns tokens for valid credentials", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
          workspaceId,
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
          workspaceId,
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
          workspaceId,
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
          username: "dev",
          password: "Secret123!",
          workspaceId,
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "dev@kanon.io",
          password: "Secret123!",
          workspaceId,
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

  // ── Route Protection ─────────────────────────────────────────────────

  describe("Route Protection", () => {
    it("allows access to public auth routes without token", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "dev@kanon.io",
          username: "dev",
          password: "Secret123!",
          workspaceId,
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
      const token = generateTestToken({ workspaceId });

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
      expect(res.json()).toEqual({ status: "ok" });
    });
  });
});
