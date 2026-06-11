import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import { createTestApp, disconnectTestDb } from "../../test/helpers.js";

/**
 * Integration tests for KAN-77: per-route auth rate limits + trustProxy.
 *
 * Rate limiting is normally disabled under NODE_ENV=test, so these build the
 * app with `enableRateLimit: true`. The limiter keys on `request.ip`, which —
 * thanks to trustProxy — resolves from the `X-Forwarded-For` header rather than
 * the (shared) socket IP. That is the whole point of the ticket: behind nginx
 * every request would otherwise share one bucket and throttle all users at once.
 *
 * Rate-limit counting happens in an onRequest hook, before schema validation,
 * so requests with an empty body still count toward the limit (they 400, but
 * the 11th from the same IP is rejected with 429 first).
 */
describe("KAN-77 — auth rate limits + trustProxy", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp({ enableRateLimit: true });
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  async function hit(url: string, ip: string) {
    return app.inject({
      method: "POST",
      url,
      headers: { "x-forwarded-for": ip },
      payload: {},
    });
  }

  it("tight endpoints (/onboard) reject the 11th request/min from one IP with 429", async () => {
    const ip = "10.0.0.1";
    for (let i = 0; i < 10; i++) {
      const res = await hit("/api/auth/onboard", ip);
      expect(res.statusCode).not.toBe(429);
    }
    const blocked = await hit("/api/auth/onboard", ip);
    expect(blocked.statusCode).toBe(429);
    // The custom error handler must surface a clean 429, not mask it as 500.
    expect(blocked.json()).toMatchObject({ error: "RATE_LIMIT_EXCEEDED" });
  });

  it("buckets are per real client IP — a different X-Forwarded-For is unaffected", async () => {
    const noisyIp = "10.0.0.2";
    // Exhaust the limit for the noisy IP.
    for (let i = 0; i < 11; i++) {
      await hit("/api/auth/onboard", noisyIp);
    }
    const noisy = await hit("/api/auth/onboard", noisyIp);
    expect(noisy.statusCode).toBe(429);

    // A different client IP must still be served — proves trustProxy resolves
    // request.ip from X-Forwarded-For instead of the shared socket IP.
    const fresh = await hit("/api/auth/onboard", "10.0.0.3");
    expect(fresh.statusCode).not.toBe(429);
  });

  it("resolves the real client through a 2-hop chain and ignores a spoofed XFF prefix", async () => {
    // Simulates the prod chain `client → caddy → nginx → api`: the trusted
    // proxies (private/loopback) are stripped and the first public IP is the
    // real client. A client-injected leftmost XFF entry is pushed left of the
    // real client (which the proxies append) and must be ignored.
    const realClient = "203.0.113.7"; // public
    const caddyHop = "172.18.0.5"; // private docker IP (uniquelocal)

    const inject = (xff: string) =>
      app.inject({
        method: "POST",
        url: "/api/auth/onboard",
        headers: { "x-forwarded-for": xff },
        payload: {},
      });

    // Exhaust the limit for the real client, with a spoofed prefix on every hit.
    for (let i = 0; i < 11; i++) {
      await inject(`1.2.3.4, ${realClient}, ${caddyHop}`);
    }
    const blocked = await inject(`9.9.9.9, ${realClient}, ${caddyHop}`);
    expect(blocked.statusCode).toBe(429); // keyed on realClient despite varying spoof

    // A genuinely different public client (same proxy chain) is unaffected.
    const other = await inject(`203.0.113.99, ${caddyHop}`);
    expect(other.statusCode).not.toBe(429);
  });

  it("rotation endpoints (/exchange) allow more than the tight limit (30/min)", async () => {
    const ip = "10.0.0.4";
    // 11 requests — would 429 on a 10/min endpoint, must NOT on the 30/min one.
    let blocked = false;
    for (let i = 0; i < 11; i++) {
      const res = await hit("/api/auth/exchange", ip);
      if (res.statusCode === 429) blocked = true;
    }
    expect(blocked).toBe(false);
  });
});
