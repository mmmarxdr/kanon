// ─── via plugin integration tests (S1 / task 1.3) ───────────────────────────
//
// Tests that the viaPlugin decorates request.via correctly based on the
// X-Kanon-Client header value.

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  generateTestToken,
  cleanDatabase,
  disconnectTestDb,
} from "../test/helpers.js";

describe("viaPlugin — request.via decoration", () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    await cleanDatabase();
    // Build app without calling ready() so we can register our probe route first
    const { buildApp } = await import("../app.js");
    app = await buildApp();
    token = generateTestToken();

    // Register a lightweight probe route that exposes request.via for assertions.
    // Must be registered BEFORE app.ready() — Fastify freezes routes on listen/ready.
    app.get(
      "/__test_via_probe",
      {},
      async (request) => {
        return { via: request.via };
      },
    );

    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  it("sets request.via to 'claude-code' when X-Kanon-Client: claude-code", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__test_via_probe",
      headers: {
        authorization: `Bearer ${token}`,
        "x-kanon-client": "claude-code",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ via: string | null }>();
    expect(body.via).toBe("claude-code");
  });

  it("sets request.via to 'cursor' when X-Kanon-Client: cursor", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__test_via_probe",
      headers: {
        authorization: `Bearer ${token}`,
        "x-kanon-client": "cursor",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ via: string | null }>();
    expect(body.via).toBe("cursor");
  });

  it("sets request.via to null when X-Kanon-Client is unknown", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__test_via_probe",
      headers: {
        authorization: `Bearer ${token}`,
        "x-kanon-client": "unknown-bot",
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ via: string | null }>();
    expect(body.via).toBeNull();
  });

  it("sets request.via to null when X-Kanon-Client header is absent", async () => {
    const res = await app.inject({
      method: "GET",
      url: "/__test_via_probe",
      headers: {
        authorization: `Bearer ${token}`,
      },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<{ via: string | null }>();
    expect(body.via).toBeNull();
  });
});
