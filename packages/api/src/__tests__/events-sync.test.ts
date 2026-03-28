import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import Fastify, { type FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { EventEmitter } from "events";
import http from "http";
import eventsRoutes from "../modules/events/routes.js";

/**
 * Integration tests for GET /api/events/sync (SSE endpoint).
 *
 * Uses a lightweight Fastify instance with only the events routes plugin,
 * avoiding the full app build (no DB dependency).
 */

// Stub env before importing routes — factory is hoisted, use literal strings
vi.mock("../config/env.js", () => ({
  env: {
    JWT_SECRET: "test-jwt-secret-at-least-16-chars",
    ENGRAM_SYNC_ENABLED: true,
    ENGRAM_POLL_INTERVAL_MS: 15000,
  },
}));

function makeToken(overrides?: Record<string, unknown>): string {
  return jwt.sign(
    {
      sub: "member-1",
      workspaceId: "ws-1",
      role: "member",
      ...overrides,
    },
    "test-jwt-secret-at-least-16-chars",
    { expiresIn: "15m" },
  );
}

describe("GET /api/events/sync — SSE endpoint", () => {
  // ── 503 when sync is disabled ─────────────────────────────────────────

  describe("when ENGRAM_SYNC_ENABLED is false (bridgeSyncService is null)", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify({ logger: false });
      app.decorate("bridgeSyncService", null);
      await app.register(eventsRoutes, { prefix: "/api/events" });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 503 with SYNC_DISABLED code", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/events/sync",
        headers: {
          authorization: `Bearer ${makeToken()}`,
        },
      });

      expect(res.statusCode).toBe(503);
      const body = res.json();
      expect(body.code).toBe("SYNC_DISABLED");
    });
  });

  // ── Auth tests (non-streaming responses — use inject) ─────────────────

  describe("when sync is enabled — auth checks", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      const mockBridgeSyncService = new EventEmitter();
      app = Fastify({ logger: false });
      app.decorate("bridgeSyncService", mockBridgeSyncService);
      await app.register(eventsRoutes, { prefix: "/api/events" });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 401 when no JWT provided", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/events/sync",
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe("UNAUTHORIZED");
    });

    it("returns 401 when invalid JWT provided", async () => {
      const res = await app.inject({
        method: "GET",
        url: "/api/events/sync",
        headers: {
          authorization: "Bearer invalid-token-garbage",
        },
      });

      expect(res.statusCode).toBe(401);
      const body = res.json();
      expect(body.code).toBe("INVALID_TOKEN");
    });
  });

  // ── SSE streaming tests (use real HTTP to avoid inject hanging) ────────

  describe("when sync is enabled — SSE streaming", () => {
    let app: FastifyInstance;
    let mockBridgeSyncService: EventEmitter;
    let baseUrl: string;

    beforeAll(async () => {
      mockBridgeSyncService = new EventEmitter();
      app = Fastify({ logger: false });
      app.decorate("bridgeSyncService", mockBridgeSyncService);
      await app.register(eventsRoutes, { prefix: "/api/events" });
      // Listen on random port for real HTTP
      await app.listen({ port: 0, host: "127.0.0.1" });
      const addr = app.server.address();
      if (typeof addr === "string" || !addr) throw new Error("No address");
      baseUrl = `http://127.0.0.1:${addr.port}`;
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 200 with text/event-stream content type for valid auth", async () => {
      const data = await new Promise<{
        statusCode: number;
        contentType: string;
      }>((resolve, reject) => {
        const req = http.get(
          `${baseUrl}/api/events/sync`,
          {
            headers: {
              Authorization: `Bearer ${makeToken()}`,
            },
          },
          (res) => {
            resolve({
              statusCode: res.statusCode ?? 0,
              contentType: res.headers["content-type"] ?? "",
            });
            // Destroy the socket to close the SSE connection
            res.destroy();
          },
        );
        req.on("error", reject);
        req.setTimeout(5000, () => {
          req.destroy(new Error("Timeout"));
        });
      });

      expect(data.statusCode).toBe(200);
      expect(data.contentType).toBe("text/event-stream");
    });

    it("streams events when BridgeSyncService emits sync_complete", async () => {
      const receivedData = await new Promise<string>((resolve, reject) => {
        const req = http.get(
          `${baseUrl}/api/events/sync`,
          {
            headers: {
              Authorization: `Bearer ${makeToken()}`,
            },
          },
          (res) => {
            let body = "";
            res.on("data", (chunk: Buffer) => {
              body += chunk.toString();
              // Once we get data, resolve and close
              res.destroy();
              resolve(body);
            });

            // Emit an event once the connection is established
            setTimeout(() => {
              mockBridgeSyncService.emit("sync_complete", {
                type: "sync_complete",
                projectKey: "kanon",
                changedCount: 2,
                timestamp: "2026-03-22T12:00:00.000Z",
              });
            }, 50);

            // Safety timeout
            setTimeout(() => {
              res.destroy();
              reject(new Error("No data received within timeout"));
            }, 3000);
          },
        );
        req.on("error", reject);
      });

      // The SSE data should contain our event
      expect(receivedData).toContain("data:");
      expect(receivedData).toContain("sync_complete");
    });
  });
});

// ─── POST /api/events/sync/trigger tests ──────────────────────────────────

describe("POST /api/events/sync/trigger", () => {
  // ── 503 when sync is disabled ───────────────────────────────────────────

  describe("when sync is disabled", () => {
    let app: FastifyInstance;

    beforeAll(async () => {
      app = Fastify({ logger: false });
      app.decorate("bridgeSyncService", null);
      await app.register(eventsRoutes, { prefix: "/api/events" });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 503 with SYNC_DISABLED code", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/events/sync/trigger",
        headers: { authorization: `Bearer ${makeToken()}` },
      });
      expect(res.statusCode).toBe(503);
      expect(res.json().code).toBe("SYNC_DISABLED");
    });
  });

  // ── Auth tests ──────────────────────────────────────────────────────────

  describe("when sync is enabled — auth checks", () => {
    let app: FastifyInstance;
    const mockForcePoll = vi.fn();

    beforeAll(async () => {
      const mockService = Object.assign(new EventEmitter(), {
        forcePoll: mockForcePoll,
      });
      app = Fastify({ logger: false });
      app.decorate("bridgeSyncService", mockService);
      await app.register(eventsRoutes, { prefix: "/api/events" });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    it("returns 401 when no JWT provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/events/sync/trigger",
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("UNAUTHORIZED");
    });

    it("returns 401 when invalid JWT provided", async () => {
      const res = await app.inject({
        method: "POST",
        url: "/api/events/sync/trigger",
        headers: { authorization: "Bearer invalid-garbage" },
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("INVALID_TOKEN");
    });
  });

  // ── Trigger behavior ───────────────────────────────────────────────────

  describe("when sync is enabled — trigger behavior", () => {
    let app: FastifyInstance;
    const mockForcePoll = vi.fn();

    beforeAll(async () => {
      const mockService = Object.assign(new EventEmitter(), {
        forcePoll: mockForcePoll,
      });
      app = Fastify({ logger: false });
      app.decorate("bridgeSyncService", mockService);
      await app.register(eventsRoutes, { prefix: "/api/events" });
      await app.ready();
    });

    afterAll(async () => {
      await app.close();
    });

    beforeEach(() => {
      mockForcePoll.mockReset();
    });

    it("returns 200 with triggered: true on successful force poll", async () => {
      mockForcePoll.mockResolvedValue({ triggered: true });

      const res = await app.inject({
        method: "POST",
        url: "/api/events/sync/trigger",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.triggered).toBe(true);
      expect(body.timestamp).toBeDefined();
    });

    it("returns 429 with retryAfterMs on cooldown", async () => {
      mockForcePoll.mockResolvedValue({ triggered: false, retryAfterMs: 7500 });

      const res = await app.inject({
        method: "POST",
        url: "/api/events/sync/trigger",
        headers: { authorization: `Bearer ${makeToken()}` },
      });

      expect(res.statusCode).toBe(429);
      const body = res.json();
      expect(body.triggered).toBe(false);
      expect(body.retryAfterMs).toBe(7500);
    });
  });
});
