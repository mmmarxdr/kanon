/**
 * Integration tests for magic-link sign-in (KAN-9).
 *
 * Uses Fastify .inject() — no real HTTP, but real Prisma against the test DB.
 * Mirrors the password-reset.integration.test.ts pattern.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";

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

/**
 * Extract the raw magic-link token from a captured email's HTML.
 * The CTA href must contain /magic-link?token=...
 */
function extractMagicToken(html: string): string | null {
  const match = html.match(/href="[^"]*magic-link\?token=([^"&\s]+)"/);
  return match ? decodeURIComponent(match[1]!) : null;
}

describe("Magic Link", () => {
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
    password = "SecretPass1!xy",
  ) {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: { email, password },
    });
    expect(res.statusCode).toBe(201);
    sentEmails.length = 0; // clear verification email
    return { email, password };
  }

  // ── POST /api/auth/magic-link ────────────────────────────────────────

  it("returns 200 with standard message for a registered email", async () => {
    await registerUser("alice@kanon.test");

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "alice@kanon.test" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toContain("sign-in link");
    expect(sentEmails).toHaveLength(1);
    expect(sentEmails[0]!.to).toBe("alice@kanon.test");
  });

  it("returns 200 with the same message for an UNKNOWN email (no enumeration)", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "nobody@kanon.test" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().message).toContain("sign-in link");
    expect(sentEmails).toHaveLength(0);
  });

  it("returns 400 for a missing email field", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: {},
    });

    expect(res.statusCode).toBe(400);
  });

  // ── POST /api/auth/verify-magic-link ────────────────────────────────

  it("returns 400 for a bad/unknown token", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/verify-magic-link",
      payload: { token: "bad-token-that-does-not-exist" },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe("INVALID_MAGIC_LINK");
  });

  it("returns 200 with tokens and Set-Cookie on valid token", async () => {
    await registerUser("bob@kanon.test");

    // Request magic link
    const sendRes = await app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "bob@kanon.test" },
    });
    expect(sendRes.statusCode).toBe(200);
    expect(sentEmails).toHaveLength(1);

    const token = extractMagicToken(sentEmails[0]!.html);
    expect(token).toBeTruthy();

    // Verify the token
    const verifyRes = await app.inject({
      method: "POST",
      url: "/api/auth/verify-magic-link",
      payload: { token },
    });

    expect(verifyRes.statusCode).toBe(200);
    const body = verifyRes.json();
    expect(body).toHaveProperty("accessToken");
    expect(body).toHaveProperty("refreshToken");
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");

    // Auth cookies must be set
    const cookies = verifyRes.headers["set-cookie"];
    expect(cookies).toBeDefined();
    const cookieStr = Array.isArray(cookies) ? cookies.join("; ") : cookies;
    expect(cookieStr).toContain("access_token=");
    expect(cookieStr).toContain("refresh_token=");
  });

  it("returns 400 when the same token is used a second time (single-use)", async () => {
    await registerUser("carol@kanon.test");

    await app.inject({
      method: "POST",
      url: "/api/auth/magic-link",
      payload: { email: "carol@kanon.test" },
    });

    const token = extractMagicToken(sentEmails[0]!.html);
    expect(token).toBeTruthy();

    // First use — should succeed
    const first = await app.inject({
      method: "POST",
      url: "/api/auth/verify-magic-link",
      payload: { token },
    });
    expect(first.statusCode).toBe(200);

    // Second use — must be rejected
    const second = await app.inject({
      method: "POST",
      url: "/api/auth/verify-magic-link",
      payload: { token },
    });
    expect(second.statusCode).toBe(400);
    expect(second.json().code).toBe("INVALID_MAGIC_LINK");
  });
});
