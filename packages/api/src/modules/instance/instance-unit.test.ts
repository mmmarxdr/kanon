/**
 * Instance Layer — Unit tests (mocked prisma)
 *
 * Tests for:
 * - 2.1: bootstrapSetupToken idempotency (service-level unit tests)
 * - 2.3: requireSuperAdmin (unit tests via mock)
 * - 2.5: claim Zod schema validation
 *
 * NOTE: All real-DB tests (singleton check, claim, settings, status)
 * live in instance.integration.test.ts — vi.mock is file-scoped and
 * cannot coexist with real-DB tests in the same file.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";

// ─── Prisma mock (must be before any imports that use prisma) ────────────────

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    instanceSettings: {
      findUnique: vi.fn(),
    },
    setupToken: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma as mockPrisma } from "../../config/prisma.js";
import { bootstrapSetupToken } from "./service.js";

// ─── 2.1: onReady idempotency (unit) ─────────────────────────────────────────

describe("bootstrapSetupToken idempotency", () => {
  const mockSettings = vi.mocked(mockPrisma.instanceSettings.findUnique);
  const mockTokenFirst = vi.mocked(mockPrisma.setupToken.findFirst);
  const mockTokenCreate = vi.mocked(mockPrisma.setupToken.create);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("(a) no owner + no live token → mints and returns raw token", async () => {
    mockSettings.mockResolvedValueOnce({ id: INSTANCE_SETTINGS_ID, ownerUserId: null } as any);
    mockTokenFirst.mockResolvedValueOnce(null);
    mockTokenCreate.mockResolvedValueOnce({ id: "tok-1", tokenHash: "hash", expiresAt: new Date(), createdAt: new Date(), usedAt: null } as any);

    const result = await bootstrapSetupToken(7);
    expect(result).not.toBeNull();
    expect(typeof result).toBe("string");
    expect(result!.length).toBeGreaterThan(0);
    expect(mockTokenCreate).toHaveBeenCalledOnce();
  });

  it("(b) no owner + live token exists → no re-mint, returns null", async () => {
    mockSettings.mockResolvedValueOnce({ id: INSTANCE_SETTINGS_ID, ownerUserId: null } as any);
    mockTokenFirst.mockResolvedValueOnce({
      id: "tok-existing",
      tokenHash: "hash",
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
      usedAt: null,
    } as any);

    const result = await bootstrapSetupToken(7);
    expect(result).toBeNull();
    expect(mockTokenCreate).not.toHaveBeenCalled();
  });

  it("(c) owner is set → noop, returns null", async () => {
    mockSettings.mockResolvedValueOnce({ id: INSTANCE_SETTINGS_ID, ownerUserId: "some-user-id" } as any);

    const result = await bootstrapSetupToken(7);
    expect(result).toBeNull();
    expect(mockTokenFirst).not.toHaveBeenCalled();
    expect(mockTokenCreate).not.toHaveBeenCalled();
  });
});

// ─── 2.3: requireSuperAdmin (unit) ───────────────────────────────────────────

import { requireSuperAdmin } from "../../middleware/require-role.js";
import type { FastifyRequest, FastifyReply } from "fastify";

describe("requireSuperAdmin", () => {
  const mockSettings = vi.mocked(mockPrisma.instanceSettings.findUnique);
  const makeReq = (user: any): FastifyRequest =>
    ({ user } as unknown as FastifyRequest);
  const dummyReply = {} as FastifyReply;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("owner match → does not throw", async () => {
    mockSettings.mockResolvedValueOnce({ ownerUserId: "user-abc" } as any);
    const handler = requireSuperAdmin();
    await expect(handler(makeReq({ userId: "user-abc" }), dummyReply)).resolves.not.toThrow();
  });

  it("mismatch → throws 403", async () => {
    mockSettings.mockResolvedValueOnce({ ownerUserId: "user-abc" } as any);
    const handler = requireSuperAdmin();
    await expect(handler(makeReq({ userId: "user-xyz" }), dummyReply)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("no owner set → throws 403", async () => {
    mockSettings.mockResolvedValueOnce({ ownerUserId: null } as any);
    const handler = requireSuperAdmin();
    await expect(handler(makeReq({ userId: "user-abc" }), dummyReply)).rejects.toMatchObject({ statusCode: 403 });
  });

  it("unauthenticated (no user) → throws 401", async () => {
    const handler = requireSuperAdmin();
    await expect(handler(makeReq(undefined), dummyReply)).rejects.toMatchObject({ statusCode: 401 });
  });
});

// ─── 2.5: Claim Zod schema ───────────────────────────────────────────────────

import { ClaimBody } from "./schema.js";

describe("ClaimBody schema", () => {
  // Valid password: 12+ chars with upper, lower, digit, and symbol (KAN-49)
  const validPassword = "AdminPass1!x";

  it("accepts valid input (>=12 chars, upper+lower+digit+symbol)", () => {
    expect(() =>
      ClaimBody.parse({ token: "a".repeat(20), email: "admin@kanon.io", password: validPassword })
    ).not.toThrow();
  });

  it("rejects password < 12 chars (10-char with all complexity)", () => {
    // 10 chars — fails min(12)
    expect(() =>
      ClaimBody.parse({ token: "a".repeat(20), email: "admin@kanon.io", password: "AdminPas1!" })
    ).toThrow();
  });

  it("rejects password 11 chars even with full complexity (< 12 min)", () => {
    // 11 chars — fails min(12)
    expect(() =>
      ClaimBody.parse({ token: "a".repeat(20), email: "admin@kanon.io", password: "AdminPass1!" })
    ).toThrow();
  });

  it("rejects password >=12 chars but no uppercase", () => {
    expect(() =>
      ClaimBody.parse({ token: "a".repeat(20), email: "admin@kanon.io", password: "adminpass1!x" })
    ).toThrow();
  });

  it("rejects password >=12 chars but no lowercase", () => {
    expect(() =>
      ClaimBody.parse({ token: "a".repeat(20), email: "admin@kanon.io", password: "ADMINPASS1!X" })
    ).toThrow();
  });

  it("rejects password >=12 chars but no digit", () => {
    expect(() =>
      ClaimBody.parse({ token: "a".repeat(20), email: "admin@kanon.io", password: "AdminPass!!x" })
    ).toThrow();
  });

  it("rejects password >=12 chars but no symbol", () => {
    expect(() =>
      ClaimBody.parse({ token: "a".repeat(20), email: "admin@kanon.io", password: "AdminPass12x" })
    ).toThrow();
  });

  it("rejects weak password (< 8 chars)", () => {
    expect(() =>
      ClaimBody.parse({ token: "a".repeat(20), email: "admin@kanon.io", password: "short" })
    ).toThrow();
  });

  it("rejects bad email", () => {
    expect(() =>
      ClaimBody.parse({ token: "a".repeat(20), email: "not-an-email", password: validPassword })
    ).toThrow();
  });

  it("rejects short token (< 20 chars)", () => {
    expect(() =>
      ClaimBody.parse({ token: "short", email: "admin@kanon.io", password: validPassword })
    ).toThrow();
  });
});
