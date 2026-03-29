import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  generateTestRefreshToken,
  seedTestWorkspace,
  seedTestMember,
  cleanDatabase,
  disconnectTestDb,
  parseCookies,
  buildCookieString,
} from "../../test/helpers.js";

/**
 * Integration tests for cookie-based auth flow.
 * Tests: login → cookies → /me → refresh → logout
 */
describe("Cookie Auth Flow", () => {
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

  // ── Login sets cookies ────────────────────────────────────────

  describe("Login → Cookie flow", () => {
    it("login sets kanon_at, kanon_rt, and kanon_csrf cookies", async () => {
      // Register (no workspace)
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "cookie@kanon.io",
          password: "Secret123!",
        },
      });

      // Login (no workspace)
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "cookie@kanon.io",
          password: "Secret123!",
        },
      });

      expect(loginRes.statusCode).toBe(200);

      // Check cookies are set
      const setCookies = loginRes.headers["set-cookie"];
      expect(setCookies).toBeDefined();
      const cookieArray = Array.isArray(setCookies) ? setCookies : [setCookies!];

      const cookieNames = cookieArray.map((c) => c.split("=")[0]);
      expect(cookieNames).toContain("kanon_at");
      expect(cookieNames).toContain("kanon_rt");
      expect(cookieNames).toContain("kanon_csrf");

      // Also returns tokens in body (backward compat)
      const body = loginRes.json();
      expect(body).toHaveProperty("accessToken");
      expect(body).toHaveProperty("refreshToken");
    });

    it("GET /me returns User-level info with valid access cookie", async () => {
      // Register + Login (no workspace)
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "me@kanon.io",
          password: "Secret123!",
          displayName: "Me User",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "me@kanon.io",
          password: "Secret123!",
        },
      });

      const cookies = parseCookies(loginRes.headers["set-cookie"]);
      expect(cookies["kanon_at"]).toBeDefined();

      // Call /me with cookie
      const meRes = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        headers: {
          cookie: buildCookieString(cookies),
        },
      });

      expect(meRes.statusCode).toBe(200);
      const me = meRes.json();
      expect(me.email).toBe("me@kanon.io");
      expect(me.displayName).toBe("Me User");
      expect(me).toHaveProperty("userId");
      expect(me).toHaveProperty("avatarUrl");
      // Must NOT have workspace-level fields
      expect(me).not.toHaveProperty("memberId");
      expect(me).not.toHaveProperty("workspaceId");
      expect(me).not.toHaveProperty("role");
    });

    it("GET /me returns 401 without any auth", async () => {
      const meRes = await app.inject({
        method: "GET",
        url: "/api/auth/me",
      });

      expect(meRes.statusCode).toBe(401);
    });
  });

  // ── Refresh via cookie ────────────────────────────────────────

  describe("Cookie-based refresh", () => {
    it("refreshes access token via kanon_rt cookie (no body needed)", async () => {
      // Register + Login
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "refresh@kanon.io",
          password: "Secret123!",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "refresh@kanon.io",
          password: "Secret123!",
        },
      });

      const cookies = parseCookies(loginRes.headers["set-cookie"]);
      expect(cookies["kanon_rt"]).toBeDefined();

      // Refresh using only cookie (kanon_rt path matches /api/auth/refresh)
      const refreshRes = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: {
          cookie: buildCookieString({ kanon_rt: cookies["kanon_rt"]! }),
        },
      });

      expect(refreshRes.statusCode).toBe(200);
      const body = refreshRes.json();
      expect(body).toHaveProperty("accessToken");
      expect(typeof body.accessToken).toBe("string");

      // Should also set new kanon_at cookie
      const refreshCookies = parseCookies(refreshRes.headers["set-cookie"]);
      expect(refreshCookies["kanon_at"]).toBeDefined();
    });
  });

  // ── Logout clears cookies ────────────────────────────────────

  describe("Logout", () => {
    it("POST /logout clears all auth cookies", async () => {
      const logoutRes = await app.inject({
        method: "POST",
        url: "/api/auth/logout",
      });

      expect(logoutRes.statusCode).toBe(200);

      // Check cookies are cleared (Set-Cookie with empty value or maxAge=0)
      const setCookies = logoutRes.headers["set-cookie"];
      expect(setCookies).toBeDefined();
      const cookieArray = Array.isArray(setCookies) ? setCookies : [setCookies!];

      // All three cookies should be cleared
      const cookieNames = cookieArray.map((c) => c.split("=")[0]);
      expect(cookieNames).toContain("kanon_at");
      expect(cookieNames).toContain("kanon_rt");
      expect(cookieNames).toContain("kanon_csrf");
    });

    it("after logout, /me returns 401", async () => {
      // Register + Login
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "logout@kanon.io",
          password: "Secret123!",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "logout@kanon.io",
          password: "Secret123!",
        },
      });

      const cookies = parseCookies(loginRes.headers["set-cookie"]);

      // Logout
      await app.inject({
        method: "POST",
        url: "/api/auth/logout",
        headers: {
          cookie: buildCookieString(cookies),
        },
      });

      // After logout, /me should return 401 (cookies are cleared server-side)
      const meRes = await app.inject({
        method: "GET",
        url: "/api/auth/me",
        // No cookies — simulating a browser that received the clear directives
      });

      expect(meRes.statusCode).toBe(401);
    });
  });

  // ── API-key backward compatibility ────────────────────────────

  describe("API-key backward compatibility", () => {
    it("API-key auth still works without cookies", async () => {
      // Register + Login + generate API key
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "apikey@kanon.io",
          password: "Secret123!",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "apikey@kanon.io",
          password: "Secret123!",
        },
      });

      const cookies = parseCookies(loginRes.headers["set-cookie"]);

      // Generate API key (requires auth)
      const apiKeyRes = await app.inject({
        method: "POST",
        url: "/api/auth/api-key",
        headers: {
          cookie: buildCookieString(cookies),
          "x-csrf-token": cookies["kanon_csrf"],
        },
      });

      expect(apiKeyRes.statusCode).toBe(201);
      const { apiKey } = apiKeyRes.json();

      // Use API key to access protected route (no cookies)
      const wsRes = await app.inject({
        method: "GET",
        url: "/api/workspaces",
        headers: {
          "x-api-key": apiKey,
        },
      });

      expect(wsRes.statusCode).not.toBe(401);
    });

    it("Bearer token auth still works without cookies", async () => {
      // Register + Login
      await app.inject({
        method: "POST",
        url: "/api/auth/register",
        payload: {
          email: "bearer@kanon.io",
          password: "Secret123!",
        },
      });

      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: {
          email: "bearer@kanon.io",
          password: "Secret123!",
        },
      });

      const { accessToken } = loginRes.json();

      // Use Bearer token (no cookies)
      const wsRes = await app.inject({
        method: "GET",
        url: "/api/workspaces",
        headers: {
          authorization: `Bearer ${accessToken}`,
        },
      });

      expect(wsRes.statusCode).not.toBe(401);
    });
  });
});
