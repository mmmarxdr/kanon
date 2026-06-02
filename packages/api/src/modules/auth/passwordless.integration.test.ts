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
 */
const sentEmails: Array<{
  to: string;
  subject: string;
  html: string;
  text?: string;
}> = [];

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

function extractTokenFromEmail(html: string): string | null {
  const match = html.match(/token=([^"&\s]+)/);
  return match ? match[1]! : null;
}

/**
 * Tests for R-NUI-passwordless:
 *  - login with null passwordHash → 401 INVALID_CREDENTIALS (no crash)
 *  - changePassword with null prior hash → 400 (no crash)
 *  - forgot-password → reset-password → login works for a user who started passwordless
 */
describe("Passwordless safety (R-NUI-passwordless)", () => {
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
    sentEmails.length = 0;
  });

  // ── Task 1.1: login rejects passwordless user — no crash ────────────────

  it("login rejects user with null passwordHash with 401 (no crash, generic error)", async () => {
    // Create a passwordless user directly in DB (requires nullable passwordHash in schema)
    await prisma.user.create({
      data: {
        email: "passwordless@kanon.test",
        passwordHash: null,
        displayName: "Passwordless User",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "passwordless@kanon.test",
        password: "anything",
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    // Must use generic error — no user enumeration
    expect(body.code).toBe("INVALID_CREDENTIALS");
  });

  // Triangulation: login with wrong password (has hash) still works normally → same generic 401
  it("login with wrong password (user has hash) also returns 401 INVALID_CREDENTIALS", async () => {
    const bcrypt = await import("bcryptjs");
    const hash = await bcrypt.hash("correct-password", 4);
    await prisma.user.create({
      data: {
        email: "normal@kanon.test",
        passwordHash: hash,
        displayName: "Normal User",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "normal@kanon.test",
        password: "wrong-password",
      },
    });

    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBe("INVALID_CREDENTIALS");
  });

  // ── Task 1.1: changePassword rejects passwordless user gracefully ──────

  it("changePassword with null prior hash returns 400 (no crash)", async () => {
    const jwt = await import("jsonwebtoken");

    // Create passwordless user
    const user = await prisma.user.create({
      data: {
        email: "passwordless2@kanon.test",
        passwordHash: null,
        displayName: "Passwordless User 2",
      },
    });

    const token = jwt.sign(
      { sub: user.id, email: user.email },
      process.env["JWT_SECRET"]!,
      { expiresIn: "15m" },
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/change-password",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        currentPassword: "anything",
        newPassword: "NewPassword123!",
      },
    });

    // Should reject with 400 (invalid current password), not 500
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe("INVALID_PASSWORD");
  });

  // ── Task 1.1: reset round-trip — passwordless → set hash → login works ─

  it("passwordless user can reset password and then log in (reset is the escape hatch)", async () => {
    // Step 1: Create passwordless user
    const user = await prisma.user.create({
      data: {
        email: "resetter@kanon.test",
        passwordHash: null,
        displayName: "Reset Test User",
      },
    });

    // Step 2: Request password reset (forgot-password flow)
    const forgotRes = await app.inject({
      method: "POST",
      url: "/api/auth/forgot-password",
      payload: { email: "resetter@kanon.test" },
    });
    expect(forgotRes.statusCode).toBe(200);

    // Step 3: Extract token from captured email
    expect(sentEmails).toHaveLength(1);
    const emailHtml = sentEmails[0]!.html;
    const resetToken = extractTokenFromEmail(emailHtml);
    expect(resetToken).not.toBeNull();

    // Step 4: Reset password
    const resetRes = await app.inject({
      method: "POST",
      url: "/api/auth/reset-password",
      payload: {
        token: resetToken!,
        newPassword: "NewPassword123!",
      },
    });
    expect(resetRes.statusCode).toBe(200);

    // Step 5: Verify passwordHash is now set
    const updatedUser = await prisma.user.findUnique({
      where: { id: user.id },
      select: { passwordHash: true },
    });
    expect(updatedUser?.passwordHash).not.toBeNull();
    expect(typeof updatedUser?.passwordHash).toBe("string");

    // Step 6: Login now works
    const loginRes = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      payload: {
        email: "resetter@kanon.test",
        password: "NewPassword123!",
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const loginBody = loginRes.json();
    expect(loginBody).toHaveProperty("accessToken");
    expect(loginBody).toHaveProperty("refreshToken");
  });
});
