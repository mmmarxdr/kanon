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
});
