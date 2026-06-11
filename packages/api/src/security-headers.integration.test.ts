/**
 * KAN-78: @fastify/helmet security headers are applied to API responses.
 * Hits /health (public, no auth) and asserts the hardening headers are present.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, disconnectTestDb } from "./test/helpers.js";

describe("KAN-78 — security headers (helmet)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  it("sets the core security headers on responses", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const h = res.headers;

    expect(h["x-content-type-options"]).toBe("nosniff");
    expect(h["x-frame-options"]).toBeDefined(); // clickjacking
    expect(h["referrer-policy"]).toBeDefined();
    expect(h["strict-transport-security"]).toBeDefined(); // HSTS (honored over TLS)
  });

  it("sets a locked-down CSP suitable for a JSON API", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    const csp = res.headers["content-security-policy"];

    expect(csp).toBeDefined();
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    // useDefaults:false → helmet's permissive defaults must NOT leak in.
    expect(csp).not.toContain("script-src");
    expect(csp).not.toContain("'unsafe-inline'");
    expect(csp).not.toContain("'self'");
  });

  it("allows cross-origin reads of API responses (CORP cross-origin)", async () => {
    const res = await app.inject({ method: "GET", url: "/health" });
    expect(res.headers["cross-origin-resource-policy"]).toBe("cross-origin");
  });
});
