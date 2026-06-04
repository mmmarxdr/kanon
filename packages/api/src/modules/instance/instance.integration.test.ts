/**
 * Instance Layer — Integration tests (real DB, real HTTP)
 *
 * Tests for:
 * - 1.1: Singleton exists after migration/cleanDatabase
 * - 2.6: POST /api/instance/setup/claim (6 scenarios)
 * - 2.8: GET/PATCH /api/instance/settings (5 scenarios)
 * - 2.10: GET /api/instance/setup/status (2 scenarios)
 *
 * TDD note: routes.ts did not exist when these tests were first written →
 * genuine RED (404) → GREEN after routes.ts + app.ts wiring.
 *
 * No vi.mock — all real Prisma + real HTTP via app.inject().
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../../config/prisma.js";
import { sha256Hex } from "../auth/service.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import {
  createTestApp,
  cleanDatabase,
  disconnectTestDb,
  generateTestToken,
  seedTestWorkspace,
  seedTestMember,
} from "../../test/helpers.js";

// ─── 1.1: Singleton existence ────────────────────────────────────────────────

describe("InstanceSettings singleton (migration check)", () => {
  it("exactly one InstanceSettings row exists with ownerUserId=null after cleanDatabase", async () => {
    await cleanDatabase();
    const rows = await prisma.instanceSettings.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0]!.id).toBe(INSTANCE_SETTINGS_ID);
    expect(rows[0]!.ownerUserId).toBeNull();
    expect(rows[0]!.signupMode).toBe("open");
  });
});

// ─── Shared setup ────────────────────────────────────────────────────────────

describe("Instance routes", () => {
  let app: FastifyInstance;

  /**
   * Seed a live (unexpired, unclaimed) SetupToken and return the raw token.
   */
  async function seedLiveToken(ttlDays = 7): Promise<string> {
    const { generateOpaqueToken } = await import("../auth/service.js");
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

  /**
   * Seed an expired SetupToken and return the raw token.
   */
  async function seedExpiredToken(): Promise<string> {
    const { generateOpaqueToken } = await import("../auth/service.js");
    const raw = generateOpaqueToken();
    const hash = sha256Hex(raw);
    await prisma.setupToken.create({
      data: {
        tokenHash: hash,
        expiresAt: new Date(Date.now() - 86_400_000), // 1 day in the past
      },
    });
    return raw;
  }

  /**
   * Seed a used SetupToken and return the raw token.
   */
  async function seedUsedToken(): Promise<string> {
    const { generateOpaqueToken } = await import("../auth/service.js");
    const raw = generateOpaqueToken();
    const hash = sha256Hex(raw);
    await prisma.setupToken.create({
      data: {
        tokenHash: hash,
        expiresAt: new Date(Date.now() + 86_400_000),
        usedAt: new Date(),
      },
    });
    return raw;
  }

  /**
   * Set ownerUserId on singleton and return the user.
   */
  async function seedOwner(email = "owner@kanon.io"): Promise<{ userId: string; token: string }> {
    const user = await prisma.user.create({
      data: {
        email,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.instanceSettings.update({
      where: { id: INSTANCE_SETTINGS_ID },
      data: { ownerUserId: user.id },
    });
    const token = generateTestToken({ userId: user.id, email });
    return { userId: user.id, token };
  }

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

  // ─── 2.10: GET /api/instance/setup/status ─────────────────────────────────

  describe("GET /api/instance/setup/status", () => {
    it("unclaimed → { claimed: false }", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/instance/setup/status",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ claimed: false });
    });

    it("after claim → { claimed: true }", async () => {
      await seedOwner();
      const res = await app.inject({
        method: "GET",
        url: "/api/instance/setup/status",
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({ claimed: true });
    });
  });

  // ─── 2.6: POST /api/instance/setup/claim ──────────────────────────────────

  describe("POST /api/instance/setup/claim", () => {
    it("(a) happy path → 200, ownerUserId set, token usedAt set, session cookies present", async () => {
      const rawToken = await seedLiveToken();

      const res = await app.inject({
        method: "POST",
        url: "/api/instance/setup/claim",
        payload: {
          token: rawToken,
          email: "admin@kanon.io",
          password: "password123",
        },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("accessToken");
      expect(body).toHaveProperty("refreshToken");

      // Verify DB state
      const settings = await prisma.instanceSettings.findUnique({
        where: { id: INSTANCE_SETTINGS_ID },
      });
      expect(settings?.ownerUserId).not.toBeNull();

      // Verify token consumed
      const tokenHash = sha256Hex(rawToken);
      const tok = await prisma.setupToken.findUnique({ where: { tokenHash } });
      expect(tok?.usedAt).not.toBeNull();

      // Verify user created
      const user = await prisma.user.findUnique({ where: { email: "admin@kanon.io" } });
      expect(user).not.toBeNull();
      expect(user?.emailVerifiedAt).not.toBeNull();

      // Verify cookies set
      const setCookie = res.headers["set-cookie"];
      const cookieStr = Array.isArray(setCookie) ? setCookie.join("; ") : setCookie ?? "";
      expect(cookieStr).toContain("kanon_at=");
      expect(cookieStr).toContain("kanon_rt=");
    });

    it("(b) expired token → 410 TOKEN_EXPIRED", async () => {
      const rawToken = await seedExpiredToken();

      const res = await app.inject({
        method: "POST",
        url: "/api/instance/setup/claim",
        payload: { token: rawToken, email: "admin@kanon.io", password: "password123" },
      });

      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe("TOKEN_EXPIRED");

      // No user created, ownerUserId still null
      const user = await prisma.user.findUnique({ where: { email: "admin@kanon.io" } });
      expect(user).toBeNull();
      const settings = await prisma.instanceSettings.findUnique({ where: { id: INSTANCE_SETTINGS_ID } });
      expect(settings?.ownerUserId).toBeNull();
    });

    it("(c) used token → 410 TOKEN_USED", async () => {
      const rawToken = await seedUsedToken();

      const res = await app.inject({
        method: "POST",
        url: "/api/instance/setup/claim",
        payload: { token: rawToken, email: "admin@kanon.io", password: "password123" },
      });

      expect(res.statusCode).toBe(410);
      expect(res.json().code).toBe("TOKEN_USED");
    });

    it("(d) invalid token hash → 400 INVALID_TOKEN", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/instance/setup/claim",
        payload: { token: "a".repeat(20), email: "admin@kanon.io", password: "password123" },
      });

      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("INVALID_TOKEN");
    });

    it("(e) email exists → 409 EMAIL_EXISTS, token NOT consumed, existing user untouched", async () => {
      const rawToken = await seedLiveToken();

      // Create a pre-existing user
      const existingHash = "existing-hash";
      const existingUser = await prisma.user.create({
        data: {
          email: "existing@kanon.io",
          passwordHash: existingHash,
        },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/instance/setup/claim",
        payload: { token: rawToken, email: "existing@kanon.io", password: "password123" },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("EMAIL_EXISTS");

      // Token must NOT be consumed
      const tokenHash = sha256Hex(rawToken);
      const tok = await prisma.setupToken.findUnique({ where: { tokenHash } });
      expect(tok?.usedAt).toBeNull();

      // ownerUserId must remain null
      const settings = await prisma.instanceSettings.findUnique({ where: { id: INSTANCE_SETTINGS_ID } });
      expect(settings?.ownerUserId).toBeNull();

      // Existing user's passwordHash must be UNCHANGED (security-critical Option C invariant)
      const afterUser = await prisma.user.findUnique({ where: { id: existingUser.id } });
      expect(afterUser?.passwordHash).toBe(existingHash);
    });

    it("(f) concurrent double-claim race → exactly one 200, one 410, single ownerUserId", async () => {
      const rawToken = await seedLiveToken();

      // Two concurrent requests with different emails against the same token
      const [res1, res2] = await Promise.all([
        app.inject({
          method: "POST",
          url: "/api/instance/setup/claim",
          payload: { token: rawToken, email: "racer1@kanon.io", password: "password123" },
        }),
        app.inject({
          method: "POST",
          url: "/api/instance/setup/claim",
          payload: { token: rawToken, email: "racer2@kanon.io", password: "password123" },
        }),
      ]);

      const statuses = [res1.statusCode, res2.statusCode].sort();
      expect(statuses).toEqual([200, 410]);

      // Exactly one winner
      const settings = await prisma.instanceSettings.findUnique({ where: { id: INSTANCE_SETTINGS_ID } });
      expect(settings?.ownerUserId).not.toBeNull();

      // ownerUserId references exactly one of the two racers
      const owner = await prisma.user.findUnique({ where: { id: settings!.ownerUserId! } });
      expect(["racer1@kanon.io", "racer2@kanon.io"]).toContain(owner?.email);

      // Loser's 410 is TOKEN_USED
      const loser = res1.statusCode === 410 ? res1 : res2;
      expect(loser.json().code).toBe("TOKEN_USED");
    });
  });

  // ─── 2.8: GET/PATCH /api/instance/settings ────────────────────────────────

  describe("GET /api/instance/settings", () => {
    it("super-admin → 200 with settings record", async () => {
      const { token } = await seedOwner();

      const res = await app.inject({
        method: "GET",
        url: "/api/instance/settings",
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("id", INSTANCE_SETTINGS_ID);
      expect(body).toHaveProperty("signupMode", "open");
    });

    it("non-super-admin authenticated → 403", async () => {
      await seedOwner(); // sets an owner, this person is NOT it
      const ws = await seedTestWorkspace();
      const other = await seedTestMember(ws.id);

      const res = await app.inject({
        method: "GET",
        url: "/api/instance/settings",
        headers: { authorization: `Bearer ${other.token}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it("unauthenticated → 401", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/instance/settings",
      });

      expect(res.statusCode).toBe(401);
    });
  });

  describe("PATCH /api/instance/settings", () => {
    it("super-admin → 200, updates instanceName, returns updated record", async () => {
      const { token } = await seedOwner();

      const res = await app.inject({
        method: "PATCH",
        url: "/api/instance/settings",
        headers: { authorization: `Bearer ${token}` },
        payload: { instanceName: "My Kanon" },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.instanceName).toBe("My Kanon");
    });

    it("PATCH stores signupMode/allowedSignupDomains without enforcement (no side-effects)", async () => {
      const { token } = await seedOwner();

      const res = await app.inject({
        method: "PATCH",
        url: "/api/instance/settings",
        headers: { authorization: `Bearer ${token}` },
        payload: { signupMode: "invite", allowedSignupDomains: ["kanon.io"] },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.signupMode).toBe("invite");
      expect(body.allowedSignupDomains).toContain("kanon.io");
    });

    it("non-super-admin → 403", async () => {
      await seedOwner();
      const ws = await seedTestWorkspace();
      const other = await seedTestMember(ws.id);

      const res = await app.inject({
        method: "PATCH",
        url: "/api/instance/settings",
        headers: { authorization: `Bearer ${other.token}` },
        payload: { instanceName: "Hacked" },
      });

      expect(res.statusCode).toBe(403);
    });
  });
});
