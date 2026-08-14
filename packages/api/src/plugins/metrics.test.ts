// Observability slice 1 — metrics plugin tests
// Each test creates a fresh prom-client Registry to avoid singleton pollution
// under singleFork: true. The plugin under test is NOT yet implemented — these
// tests are intentionally RED until metrics.ts is created (TDD RED phase).

import { describe, it, expect, afterEach } from "vitest";
import Fastify from "fastify";
import client from "prom-client";

// Not yet implemented — import will fail until Phase 3.2
import metricsPlugin from "./metrics.js";

function makeRegistry(): client.Registry {
  return new client.Registry();
}

afterEach(() => {
  // Always delete — tests always set METRICS_TOKEN explicitly when they need it,
  // so restoring a captured "undefined" is unnecessary and risks assigning the
  // string "undefined" (truthy) which breaks env-sensitive tests in other files.
  delete process.env["METRICS_TOKEN"];
});

describe("metricsPlugin", () => {
  it("Case 1: returns 200 with valid Bearer token when METRICS_TOKEN is set", async () => {
    process.env["METRICS_TOKEN"] = "secret";
    const registry = makeRegistry();
    const app = Fastify();
    await app.register(metricsPlugin, { registry });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer secret" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toMatch(/text\/plain/);
    expect(res.body).toContain("process_cpu_seconds_total");
    // Spec requires default process metrics including event loop lag
    expect(res.body).toContain("nodejs_eventloop_lag_seconds");
    expect(res.body).toContain("http_request_duration_seconds");

    await app.close();
  });

  it("Case 2: returns 401 when Authorization header is missing and token is set", async () => {
    process.env["METRICS_TOKEN"] = "secret";
    const registry = makeRegistry();
    const app = Fastify();
    await app.register(metricsPlugin, { registry });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("Case 3: returns 401 when Bearer token is wrong and token is set", async () => {
    process.env["METRICS_TOKEN"] = "secret";
    const registry = makeRegistry();
    const app = Fastify();
    await app.register(metricsPlugin, { registry });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
      headers: { authorization: "Bearer wrongtoken" },
    });

    expect(res.statusCode).toBe(401);

    await app.close();
  });

  it("Case 4: open access in dev when METRICS_TOKEN is unset", async () => {
    delete process.env["METRICS_TOKEN"];
    const registry = makeRegistry();
    const app = Fastify();
    await app.register(metricsPlugin, { registry });
    await app.ready();

    const res = await app.inject({
      method: "GET",
      url: "/metrics",
    });

    expect(res.statusCode).toBe(200);

    await app.close();
  });

  it("Case 5: label cardinality — parametrized route uses route label not raw URL", async () => {
    delete process.env["METRICS_TOKEN"];
    const registry = makeRegistry();
    const app = Fastify();
    await app.register(metricsPlugin, { registry });

    // Register a parametrized route so fastify-metrics can track it
    app.get("/api/issues/:id", async (_req, reply) => {
      return reply.send({ id: (_req.params as { id: string }).id });
    });

    await app.ready();

    // Make two requests with different concrete IDs
    await app.inject({ method: "GET", url: "/api/issues/42" });
    await app.inject({ method: "GET", url: "/api/issues/99" });

    // Scrape metrics
    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);

    // The histogram MUST use the parametrized path as label value, not concrete IDs
    expect(res.body).toContain('route="/api/issues/:id"');
    expect(res.body).not.toContain('"42"');
    expect(res.body).not.toContain('"99"');

    await app.close();
  });

  it("Case 6: exposes process metrics without legacy triage metrics", async () => {
    delete process.env["METRICS_TOKEN"];
    const registry = makeRegistry();
    const app = Fastify();
    await app.register(metricsPlugin, { registry });
    await app.ready();

    const res = await app.inject({ method: "GET", url: "/metrics" });
    expect(res.statusCode).toBe(200);
    expect(res.body).toContain("process_cpu_seconds_total");
    expect(res.body).not.toContain("kanon_triage_");
    expect(app).not.toHaveProperty("triageMetrics");

    await app.close();
  });
});
