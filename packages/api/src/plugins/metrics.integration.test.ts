// Integration guard: verifies GET /metrics is reachable through the full
// Fastify app (buildApp). This test catches registration failures early
// without requiring a DB connection (the metrics route is DB-free).
//
// Design note: each test builds its own app instance so that METRICS_TOKEN
// is set/cleared BEFORE buildApp() runs. A shared app instance built in
// beforeAll cannot react to per-test env mutations at request time when the
// plugin reads process.env directly — the ordering of singleFork test files
// means a stale token from another file can be present at beforeAll time.

import { describe, it, expect } from "vitest";
import { buildApp } from "../app.js";

describe("metrics plugin — integration (full app)", () => {
  it("GET /metrics returns 200 through the full app when no token is set", async () => {
    // Clean env before building — no token → open access
    delete process.env["METRICS_TOKEN"];

    const app = await buildApp();
    await app.ready();

    try {
      const res = await app.inject({
        method: "GET",
        url: "/metrics",
      });

      expect(res.statusCode).toBe(200);
      expect(res.headers["content-type"]).toMatch(/text\/plain/);
      expect(res.body).toContain("process_cpu_seconds_total");
    } finally {
      await app.close();
    }
  });

  // CSRF exemption: GET /metrics must not be blocked by CSRF middleware.
  // CSRF protection in csrf.ts returns early for GET requests, so no csrf token is needed.
  // ponytail: rate-limit exemption asserted via config{rateLimit:false} in code, not a 1000-req runtime test
  it("GET /metrics returns 200 with no CSRF token (CSRF does not block GET)", async () => {
    delete process.env["METRICS_TOKEN"];

    const app = await buildApp();
    await app.ready();

    try {
      // No x-csrf-token header — if CSRF were enforced this would return 403
      const res = await app.inject({
        method: "GET",
        url: "/metrics",
      });

      expect(res.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });

  it("GET /metrics returns 401 when METRICS_TOKEN is set and no auth is provided", async () => {
    process.env["METRICS_TOKEN"] = "integration-secret";

    const app = await buildApp();
    await app.ready();

    try {
      const res = await app.inject({
        method: "GET",
        url: "/metrics",
      });

      expect(res.statusCode).toBe(401);
    } finally {
      delete process.env["METRICS_TOKEN"];
      await app.close();
    }
  });

  // Security guard: the /metrics public exemption must be exact-or-subpath, not
  // a startsWith prefix. /metricsfoo must NOT bypass the JWT authHook — with no
  // credentials it is rejected (401) rather than treated as public.
  it("GET /metricsfoo does NOT inherit the /metrics public exemption", async () => {
    delete process.env["METRICS_TOKEN"];

    const app = await buildApp();
    await app.ready();

    try {
      const res = await app.inject({
        method: "GET",
        url: "/metricsfoo",
      });

      expect(res.statusCode).toBe(401);
    } finally {
      await app.close();
    }
  });
});
