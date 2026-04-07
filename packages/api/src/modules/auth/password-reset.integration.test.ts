import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { createHash } from "node:crypto";
import {
  createTestApp,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";

/**
 * Captured emails from the mocked email provider.
 * Each call to emailProvider.send() pushes the message here.
 */
const sentEmails: Array<{
  to: string;
  subject: string;
  html: string;
  text?: string;
}> = [];

/**
 * Mock the email module so we can capture sent emails and extract reset tokens.
 */
vi.mock("../../services/email/index.js", () => ({
  createEmailProvider: () => ({
    send: async (message: {
      to: string;
      subject: string;
      html: string;
      text?: string;
    }) => {
      sentEmails.push(message);
    },
  }),
}));

/**
 * Extract the raw reset token from a captured email's HTML content.
 */
function extractTokenFromEmail(html: string): string | null {
  const match = html.match(/token=([^"&\s]+)/);
  return match ? match[1]! : null;
}

describe("Password Reset", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    sentEmails.length = 0;
  });

  // ── Helper: register a user via the API ─────────────────────────────
  async function registerUser(
    email = `user-${Date.now()}@kanon.test`,
    password = "password123",
  ) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password },
    });
    expect(res.statusCode).toBe(201);
    return { email, password, userId: res.json().id };
  }

  // ── Helper: call forgot-password and extract the raw token ──────────
  async function requestResetToken(email: string): Promise<string> {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      payload: { email },
    });
    expect(res.statusCode).toBe(200);

    const lastEmail = sentEmails[sentEmails.length - 1];
    expect(lastEmail).toBeDefined();
    const token = extractTokenFromEmail(lastEmail!.html);
    expect(token).not.toBeNull();
    return token!;
  }

  // ── 5.1: Forgot password — existing email ───────────────────────────

  describe("POST /api/auth/forgot-password", () => {
    it("existing email — 200, token created in DB", async () => {
      const { email, userId } = await registerUser();

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/forgot-password",
        payload: { email },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain("reset link");

      // Verify token was created in DB
      const tokens = await prisma.passwordResetToken.findMany({
        where: { userId },
      });
      expect(tokens).toHaveLength(1);
      expect(tokens[0]!.usedAt).toBeNull();
      expect(tokens[0]!.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // Verify email was sent
      expect(sentEmails).toHaveLength(1);
      expect(sentEmails[0]!.to).toBe(email);
      expect(sentEmails[0]!.subject).toContain("Reset");
    });

    it("non-existing email — 200, same response (no enumeration)", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/forgot-password",
        payload: { email: "nonexistent@kanon.test" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain("reset link");

      // No email should have been sent
      expect(sentEmails).toHaveLength(0);

      // No token in DB
      const tokens = await prisma.passwordResetToken.findMany();
      expect(tokens).toHaveLength(0);
    });

    // Rate limiting is disabled in test mode (see app.ts).
    // This test documents the expected behavior but cannot be verified
    // via app.inject() in the test environment.
    it.skip("rate limiting — multiple rapid requests eventually get 429", async () => {
      const { email } = await registerUser();

      // Rate limit is 3 per minute per IP
      const results = [];
      for (let i = 0; i < 5; i++) {
        const res = await app.inject({
          method: "POST",
          url: "/api/auth/forgot-password",
          payload: { email },
        });
        results.push(res.statusCode);
      }

      // First 3 should succeed, remaining should be 429
      expect(results.filter((s) => s === 200).length).toBeGreaterThanOrEqual(1);
      expect(results).toContain(429);
    });

    it("second request invalidates first token", async () => {
      const { email, userId } = await registerUser();

      // First request
      await app.inject({
        method: "POST",
        url: "/api/auth/forgot-password",
        payload: { email },
      });

      const tokensBefore = await prisma.passwordResetToken.findMany({
        where: { userId },
      });
      expect(tokensBefore).toHaveLength(1);
      const firstTokenHash = tokensBefore[0]!.tokenHash;

      // Second request
      await app.inject({
        method: "POST",
        url: "/api/auth/forgot-password",
        payload: { email },
      });

      // Only one token should exist (old one deleted)
      const tokensAfter = await prisma.passwordResetToken.findMany({
        where: { userId },
      });
      expect(tokensAfter).toHaveLength(1);
      expect(tokensAfter[0]!.tokenHash).not.toBe(firstTokenHash);
    });
  });

  // ── 5.1: Reset password ─────────────────────────────────────────────

  describe("POST /api/auth/reset-password", () => {
    it("valid token — 200, password changed", async () => {
      const { email } = await registerUser();
      const token = await requestResetToken(email);

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, newPassword: "newSecurePass123" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().message).toContain("reset successfully");
    });

    it("can login with new password after reset", async () => {
      const { email } = await registerUser();
      const token = await requestResetToken(email);

      await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, newPassword: "brandNewPass456" },
      });

      // Login with new password should succeed
      const loginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "brandNewPass456" },
      });
      expect(loginRes.statusCode).toBe(200);
      expect(loginRes.json()).toHaveProperty("accessToken");

      // Login with old password should fail
      const oldLoginRes = await app.inject({
        method: "POST",
        url: "/api/auth/login",
        payload: { email, password: "password123" },
      });
      expect(oldLoginRes.statusCode).toBe(401);
    });

    it("expired token — 400", async () => {
      const { email, userId } = await registerUser();
      const token = await requestResetToken(email);

      // Manually expire the token in DB
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await prisma.passwordResetToken.updateMany({
        where: { userId, tokenHash },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, newPassword: "newPassword123" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("already used token — 400", async () => {
      const { email, userId } = await registerUser();
      const token = await requestResetToken(email);

      // Manually mark token as used in DB
      const tokenHash = createHash("sha256").update(token).digest("hex");
      await prisma.passwordResetToken.updateMany({
        where: { userId, tokenHash },
        data: { usedAt: new Date() },
      });

      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, newPassword: "newPassword123" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("invalid token — 400", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token: "completely-invalid-token", newPassword: "newPassword123" },
      });

      expect(res.statusCode).toBe(400);
    });

    it("marks token as used after reset", async () => {
      const { email, userId } = await registerUser();
      const token = await requestResetToken(email);

      await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, newPassword: "newPassword123" },
      });

      const tokenHash = createHash("sha256").update(token).digest("hex");
      const dbToken = await prisma.passwordResetToken.findFirst({
        where: { userId, tokenHash },
      });
      expect(dbToken).not.toBeNull();
      expect(dbToken!.usedAt).not.toBeNull();
    });

    it("cleans up other tokens for the same user after reset", async () => {
      const { email, userId } = await registerUser();

      // Create multiple tokens by inserting directly (service deletes old ones,
      // so we insert an extra one manually after the forgot-password call)
      const token = await requestResetToken(email);

      // Insert an extra token directly in the DB
      const extraTokenHash = createHash("sha256").update("extra-token").digest("hex");
      await prisma.passwordResetToken.create({
        data: {
          tokenHash: extraTokenHash,
          userId,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        },
      });

      // Verify we have 2 tokens now
      const tokensBefore = await prisma.passwordResetToken.findMany({
        where: { userId },
      });
      expect(tokensBefore).toHaveLength(2);

      // Reset using the real token
      await app.inject({
        method: "POST",
        url: "/api/auth/reset-password",
        payload: { token, newPassword: "newPassword123" },
      });

      // After reset: the used token remains (marked used), the extra one is deleted
      const tokensAfter = await prisma.passwordResetToken.findMany({
        where: { userId },
      });
      expect(tokensAfter).toHaveLength(1);
      expect(tokensAfter[0]!.usedAt).not.toBeNull();
    });
  });
});
