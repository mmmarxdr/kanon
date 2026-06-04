import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  generateTestToken,
  seedInstanceAdminUser,
  cleanDatabase,
  disconnectTestDb,
} from "../test/helpers.js";
import { COOKIE_NAMES } from "../shared/constants.js";

/**
 * Unit tests for the CSRF plugin.
 * Tests double-submit cookie pattern validation.
 * Uses app.inject() to test the CSRF hook in the request lifecycle.
 */
describe("CSRF Plugin", () => {
  let app: FastifyInstance;
  const csrfToken = "test-csrf-token-abc123";
  // Token for a real instance-admin user so CSRF tests can exercise POST /api/workspaces
  // past the requireInstanceAdmin guard without conflating CSRF and auth failures.
  let instanceAdminToken: string;

  beforeAll(async () => {
    await cleanDatabase();
    app = await createTestApp();
    const { token } = await seedInstanceAdminUser();
    instanceAdminToken = token;
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
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
      // Use a real instance-admin token in the cookie: POST /api/workspaces now requires
      // requireInstanceAdmin (KAN-49 PR1a). A fake-UUID token would 403 at the guard
      // before CSRF logic can be verified.
      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: {
          cookie: cookieString({
            [COOKIE_NAMES.ACCESS]: instanceAdminToken,
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

  // NOTE: "API-key bypass" test block removed in PR1 (KAN-35).
  // X-API-Key CSRF skip was dead code — auth plugin now rejects X-API-Key at 401 before CSRF runs.

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

    // Pre-auth bootstrap route: the setup token (high-entropy, from logs) is the
    // real authenticator. A claimant who already has a stale kanon_csrf cookie
    // (e.g. registered earlier) must not be blocked by double-submit. Repro of
    // the prod 403: cookie present, no X-CSRF-Token header.
    it("skips CSRF for /api/instance/setup/claim even with a stale csrf cookie", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/instance/setup/claim",
        headers: {
          cookie: cookieString({ [COOKIE_NAMES.CSRF]: csrfToken }),
          "content-type": "application/json",
        },
        payload: {
          token: "invalid-setup-token",
          email: "x@x.com",
          password: "Secret123!abc",
        },
      });
      // Should fail on the invalid setup token, not CSRF
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
