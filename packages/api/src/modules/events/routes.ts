import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";
import type { TokenPayload, AuthUser } from "../../shared/types.js";
import type { SyncEvent } from "../../services/bridge-sync-service.js";
import type { ForcePollResult } from "../../services/bridge-sync-service.js";
import { COOKIE_NAMES } from "../../shared/constants.js";

/**
 * Events routes plugin.
 * Registered under /api/events prefix.
 *
 * Provides an SSE endpoint for streaming real-time sync events
 * from the BridgeSyncService to authenticated clients.
 */
export default async function eventsRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/events/sync
   *
   * Server-Sent Events endpoint that streams BridgeSyncService events.
   * Authenticates via Authorization header (Bearer JWT) or ?token= query param.
   * Returns 503 when ENGRAM_SYNC_ENABLED is false.
   * Returns 401 when JWT is invalid or missing.
   */
  fastify.get("/sync", async (request, reply) => {
    // ─── Check service availability ──────────────────────────────────────
    const bridgeSyncService = fastify.bridgeSyncService;
    if (!bridgeSyncService) {
      return reply.status(503).send({
        statusCode: 503,
        code: "SYNC_DISABLED",
        message: "Real-time sync is not enabled. Set ENGRAM_SYNC_ENABLED=true.",
      });
    }

    // ─── Authenticate ────────────────────────────────────────────────────
    // Try Authorization header first, fallback to ?token= query param
    let token: string | undefined;

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    } else {
      const query = request.query as Record<string, string>;
      if (query['token']) {
        token = query['token'];
      }
    }

    // Fallback to cookie-based auth (matches auth plugin waterfall)
    if (!token) {
      const cookieToken = request.cookies?.[COOKIE_NAMES.ACCESS];
      if (cookieToken) {
        token = cookieToken;
      }
    }

    if (!token) {
      return reply.status(401).send({
        statusCode: 401,
        code: "UNAUTHORIZED",
        message:
          "Authentication required. Provide a Bearer token, ?token= query param, or cookie.",
      });
    }

    let user: AuthUser;
    try {
      const payload = jwt.verify(token, env.JWT_SECRET) as TokenPayload;
      user = {
        userId: payload.sub,
        email: payload.email,
      };
    } catch {
      return reply.status(401).send({
        statusCode: 401,
        code: "INVALID_TOKEN",
        message: "Invalid or expired access token.",
      });
    }

    // ─── SSE streaming ──────────────────────────────────────────────────
    const raw = reply.raw;

    raw.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Flush headers immediately
    raw.flushHeaders();

    request.log.info(
      { userId: user.userId },
      "SSE client connected to /api/events/sync",
    );

    // ─── Event forwarding ────────────────────────────────────────────────
    const onSyncComplete = (event: SyncEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const onSyncError = (event: SyncEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    const onServiceHeartbeat = (event: SyncEvent): void => {
      raw.write(`data: ${JSON.stringify(event)}\n\n`);
    };

    bridgeSyncService.on("sync_complete", onSyncComplete);
    bridgeSyncService.on("sync_error", onSyncError);
    bridgeSyncService.on("heartbeat", onServiceHeartbeat);

    // ─── Heartbeat timer (30s) ───────────────────────────────────────────
    const heartbeatInterval = setInterval(() => {
      const heartbeat: SyncEvent = {
        type: "heartbeat",
        timestamp: new Date().toISOString(),
      };
      raw.write(`data: ${JSON.stringify(heartbeat)}\n\n`);
    }, 30_000);

    // ─── Cleanup on client disconnect ────────────────────────────────────
    request.raw.on("close", () => {
      clearInterval(heartbeatInterval);
      bridgeSyncService.off("sync_complete", onSyncComplete);
      bridgeSyncService.off("sync_error", onSyncError);
      bridgeSyncService.off("heartbeat", onServiceHeartbeat);

      request.log.info(
        { userId: user.userId },
        "SSE client disconnected from /api/events/sync",
      );
    });

    // Do not call reply.send() — the response is managed via raw streaming
  });

  /**
   * POST /api/events/sync/trigger
   *
   * Triggers an immediate sync poll. Authenticated via Bearer JWT.
   * Returns 200 on success, 429 if cooldown active, 503 if sync disabled, 401 if unauth.
   */
  fastify.post("/sync/trigger", async (request, reply) => {
    // ─── Check service availability ──────────────────────────────────────
    const bridgeSyncService = fastify.bridgeSyncService;
    if (!bridgeSyncService) {
      return reply.status(503).send({
        statusCode: 503,
        code: "SYNC_DISABLED",
        message: "Real-time sync is not enabled. Set ENGRAM_SYNC_ENABLED=true.",
      });
    }

    // ─── Authenticate ────────────────────────────────────────────────────
    let token: string | undefined;

    const authHeader = request.headers.authorization;
    if (authHeader?.startsWith("Bearer ")) {
      token = authHeader.slice(7);
    }

    // Fallback to cookie-based auth (matches auth plugin waterfall)
    if (!token) {
      const cookieToken = request.cookies?.[COOKIE_NAMES.ACCESS];
      if (cookieToken) {
        token = cookieToken;
      }
    }

    if (!token) {
      return reply.status(401).send({
        statusCode: 401,
        code: "UNAUTHORIZED",
        message: "Authentication required. Provide a Bearer token or cookie.",
      });
    }

    try {
      jwt.verify(token, env.JWT_SECRET) as TokenPayload;
    } catch {
      return reply.status(401).send({
        statusCode: 401,
        code: "INVALID_TOKEN",
        message: "Invalid or expired access token.",
      });
    }

    // ─── Trigger force poll ──────────────────────────────────────────────
    const result: ForcePollResult = await bridgeSyncService.forcePoll();

    if (result.triggered) {
      return reply.status(200).send({
        triggered: true,
        timestamp: new Date().toISOString(),
      });
    }

    return reply.status(429).send({
      triggered: false,
      retryAfterMs: result.retryAfterMs,
    });
  });
}
