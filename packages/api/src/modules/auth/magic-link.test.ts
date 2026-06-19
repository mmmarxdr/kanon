/**
 * Unit tests for magic-link service functions (KAN-9).
 *
 * Strict TDD — written BEFORE the implementation.
 * Prisma and env are mocked; no DB required.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "node:crypto";

// ── Prisma mock ───────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    magicLinkToken: {
      deleteMany: vi.fn(),
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// ── env mock ──────────────────────────────────────────────────────────────────
vi.mock("../../config/env.js", () => ({
  env: {
    JWT_SECRET: "test-jwt-secret-32-chars-minimum!",
    JWT_REFRESH_SECRET: "test-refresh-secret-32-chars-min!",
    APP_URL: "http://localhost:5173",
    NODE_ENV: "test",
  },
}));

import { prisma } from "../../config/prisma.js";
import { requestMagicLink, verifyMagicLink } from "./service.js";
import type { EmailProvider } from "../../services/email/types.js";

// ── Email provider mock ───────────────────────────────────────────────────────
const mockEmailProvider: EmailProvider = {
  send: vi.fn().mockResolvedValue(undefined),
};

// ── Helpers ───────────────────────────────────────────────────────────────────
function sha256(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

describe("requestMagicLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns silently when email is not found (no enumeration)", async () => {
    vi.mocked(prisma.user.findUnique).mockResolvedValue(null);

    await expect(
      requestMagicLink("unknown@example.com", mockEmailProvider),
    ).resolves.toBeUndefined();

    expect(mockEmailProvider.send).not.toHaveBeenCalled();
    expect(prisma.magicLinkToken.create).not.toHaveBeenCalled();
  });

  it("deletes prior tokens, creates a new one, and sends email when user exists", async () => {
    const user = { id: "user-uuid-1", email: "alice@example.com" };
    vi.mocked(prisma.user.findUnique).mockResolvedValue(user as any);
    vi.mocked(prisma.magicLinkToken.deleteMany).mockResolvedValue({ count: 0 });
    vi.mocked(prisma.magicLinkToken.create).mockResolvedValue({} as any);

    await requestMagicLink("alice@example.com", mockEmailProvider);

    expect(prisma.magicLinkToken.deleteMany).toHaveBeenCalledWith({
      where: { userId: user.id },
    });
    expect(prisma.magicLinkToken.create).toHaveBeenCalledOnce();

    const createCall = vi.mocked(prisma.magicLinkToken.create).mock.calls[0]![0];
    expect(createCall.data.userId).toBe(user.id);
    expect(createCall.data.tokenHash).toBeDefined();
    // TTL must be ~15 min (allow ±5 seconds)
    const expiresAt: Date = createCall.data.expiresAt;
    const ttlMs = expiresAt.getTime() - Date.now();
    expect(ttlMs).toBeGreaterThan(14 * 60 * 1000);
    expect(ttlMs).toBeLessThan(16 * 60 * 1000);

    expect(mockEmailProvider.send).toHaveBeenCalledOnce();
    const emailCall = vi.mocked(mockEmailProvider.send).mock.calls[0]![0];
    expect(emailCall.html).toContain("/magic-link?token=");
  });
});

describe("verifyMagicLink", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("throws 400 when token is not found (bad token)", async () => {
    vi.mocked(prisma.magicLinkToken.findFirst).mockResolvedValue(null);

    await expect(verifyMagicLink("bad-token")).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_MAGIC_LINK",
    });
  });

  it("throws 400 when token is expired (findFirst returns null for expired)", async () => {
    // findFirst with expiresAt: { gt: now } returns null for expired tokens
    vi.mocked(prisma.magicLinkToken.findFirst).mockResolvedValue(null);

    await expect(verifyMagicLink("expired-token")).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_MAGIC_LINK",
    });
  });

  it("throws 400 when token is already used (usedAt not null — filtered by findFirst)", async () => {
    vi.mocked(prisma.magicLinkToken.findFirst).mockResolvedValue(null);

    await expect(verifyMagicLink("used-token")).rejects.toMatchObject({
      statusCode: 400,
      code: "INVALID_MAGIC_LINK",
    });
  });

  it("returns signTokens pair, marks usedAt, and sets emailVerifiedAt when null", async () => {
    const tokenRow = {
      id: "tok-uuid-1",
      userId: "user-uuid-1",
      tokenHash: sha256("valid-token"),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      usedAt: null,
      user: { id: "user-uuid-1", email: "alice@example.com", emailVerifiedAt: null },
    };
    vi.mocked(prisma.magicLinkToken.findFirst).mockResolvedValue(
      tokenRow as any,
    );

    // $transaction with an array of promises — resolve each promise in place
    vi.mocked(prisma.$transaction).mockImplementation(async (ops: any) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops(prisma);
    });
    vi.mocked(prisma.magicLinkToken.update).mockResolvedValue({} as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    const result = await verifyMagicLink("valid-token");

    // Must return JWT pair
    expect(result).toHaveProperty("accessToken");
    expect(result).toHaveProperty("refreshToken");
    expect(typeof result.accessToken).toBe("string");
    expect(typeof result.refreshToken).toBe("string");

    // Must mark token used in a transaction
    expect(prisma.$transaction).toHaveBeenCalled();
  });

  it("returns signTokens pair WITHOUT setting emailVerifiedAt when already verified", async () => {
    const tokenRow = {
      id: "tok-uuid-2",
      userId: "user-uuid-2",
      tokenHash: sha256("valid-token-2"),
      expiresAt: new Date(Date.now() + 10 * 60 * 1000),
      usedAt: null,
      user: { id: "user-uuid-2", email: "bob@example.com", emailVerifiedAt: new Date() },
    };
    vi.mocked(prisma.magicLinkToken.findFirst).mockResolvedValue(
      tokenRow as any,
    );

    vi.mocked(prisma.$transaction).mockImplementation(async (ops: any) => {
      if (Array.isArray(ops)) return Promise.all(ops);
      return ops(prisma);
    });
    vi.mocked(prisma.magicLinkToken.update).mockResolvedValue({} as any);
    vi.mocked(prisma.user.update).mockResolvedValue({} as any);

    const result = await verifyMagicLink("valid-token-2");

    expect(result).toHaveProperty("accessToken");
    expect(result).toHaveProperty("refreshToken");
  });
});
