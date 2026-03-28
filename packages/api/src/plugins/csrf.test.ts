import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, generateTestToken } from "../test/helpers.js";
import { COOKIE_NAMES } from "../shared/constants.js";

/**
 * Unit tests for the CSRF plugin.
 * Tests double-submit cookie pattern validation.
 * Uses app.inject() to test the CSRF hook in the request lifecycle.
 */
describe("CSRF Plugin", () => {
  let app: FastifyInstance;
  const csrfToken = "test-csrf-token-abc123";

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  // Helper: build cookie string for injection
  function cookieString(cookies: Record<string, string>): string {
    return Object.entries(cookies)
      .map(([k, v]) => `${k}=${v}`)
      .join("; ");
  }

  describe("GET requests (non-mutation)", () => {
    it("passes GET requests without CSRF validation", async () => {
      const token = generateTestToken();
      const res = await app.inject({
        method: "GET",
        url: "/api/workspaces",
        headers: {
          authorization: `Bearer ${token}`,
        },
      });
      // Should not be 403 CSRF error
      expect(res.statusCode).not.toBe(403);
    });
  });

  describe("Mutation requests with cookies", () => {
    it("passes when X-CSRF-Token header matches kanon_csrf cookie", async () => {
      const token = generateTestToken();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: {
          cookie: cookieString({
            [COOKIE_NAMES.ACCESS]: token,
            [COOKIE_NAMES.CSRF]: csrfToken,
          }),
          "x-csrf-token": csrfToken,
          "content-type": "application/json",
        },
        payload: { name: "Test", slug: "test-ws" },
      });
      // Should not be 403 (may be other errors like validation, but not CSRF)
      expect(res.statusCode).not.toBe(403);
    });

    it("rejects when X-CSRF-Token header is missing but csrf cookie exists", async () => {
      const token = generateTestToken();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: {
          cookie: cookieString({
            [COOKIE_NAMES.ACCESS]: token,
            [COOKIE_NAMES.CSRF]: csrfToken,
          }),
          "content-type": "application/json",
        },
        payload: { name: "Test", slug: "test-ws" },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe("CSRF_INVALID");
    });

    it("rejects when X-CSRF-Token header does not match cookie", async () => {
      const token = generateTestToken();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: {
          cookie: cookieString({
            [COOKIE_NAMES.ACCESS]: token,
            [COOKIE_NAMES.CSRF]: csrfToken,
          }),
          "x-csrf-token": "wrong-token",
          "content-type": "application/json",
        },
        payload: { name: "Test", slug: "test-ws" },
      });
      expect(res.statusCode).toBe(403);
      const body = res.json();
      expect(body.code).toBe("CSRF_INVALID");
    });
  });

  describe("API-key bypass", () => {
    it("bypasses CSRF validation when X-API-Key header is present", async () => {
      // API-key auth will fail at auth level (no real key in DB),
      // but CSRF should NOT be the failure point.
      // We use a Bearer token for auth and X-API-Key to trigger bypass
      const token = generateTestToken();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: {
          cookie: cookieString({
            [COOKIE_NAMES.ACCESS]: token,
            [COOKIE_NAMES.CSRF]: csrfToken,
          }),
          "x-api-key": "some-api-key",
          "content-type": "application/json",
        },
        payload: { name: "Test", slug: "test-ws" },
      });
      // Should not be 403 CSRF error — may fail with 401 (invalid API key)
      // but the CSRF check is skipped
      expect(res.json().code).not.toBe("CSRF_INVALID");
    });
  });

  describe("Exempt routes", () => {
    it("skips CSRF for /api/auth/login", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        headers: {
          "content-type": "application/json",
        },
        payload: {
          email: "x@x.com",
          password: "pass",
          workspaceId: "00000000-0000-0000-0000-000000000000",
        },
      });
      // Should fail with auth error, not CSRF
      expect(res.json().code).not.toBe("CSRF_INVALID");
    });

    it("skips CSRF for /api/auth/register", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/register",
        headers: {
          "content-type": "application/json",
        },
        payload: {
          email: "x@x.com",
          username: "testuser",
          password: "Secret123!",
          workspaceId: "00000000-0000-0000-0000-000000000000",
        },
      });
      // Should not get CSRF error
      expect(res.json().code).not.toBe("CSRF_INVALID");
    });

    it("skips CSRF for /api/auth/refresh", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/refresh",
        headers: {
          "content-type": "application/json",
        },
        payload: { refreshToken: "invalid" },
      });
      expect(res.json().code).not.toBe("CSRF_INVALID");
    });
  });

  describe("No CSRF cookie present", () => {
    it("passes when no kanon_csrf cookie exists (non-cookie auth)", async () => {
      const token = generateTestToken();
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        payload: { name: "Test", slug: "test-ws" },
      });
      // Should not be CSRF error — bearer auth without csrf cookie is fine
      expect(res.json().code).not.toBe("CSRF_INVALID");
    });
  });
});
