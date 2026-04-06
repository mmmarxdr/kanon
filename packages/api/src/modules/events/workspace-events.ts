import type { FastifyInstance } from "fastify";
import { requireMember } from "../../middleware/require-role.js";
import { eventBus } from "../../services/event-bus/index.js";
import type { DomainEvent } from "../../services/event-bus/index.js";

/**
 * Workspace-scoped SSE endpoint for domain events.
 * Registered under /api/events/workspace prefix.
 *
 * Streams real-time domain events (issue mutations, member changes, work sessions)
 * scoped to a single workspace. Requires workspace membership.
 *
 * Supports:
 * - `Last-Event-ID` header for reconnection replay
 * - 30-second heartbeat to keep connection alive
 * - Automatic cleanup on client disconnect
 */
export default async function workspaceEventsRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  /**
   * GET /api/events/workspace/:wid
   *
   * Server-Sent Events endpoint streaming domain events for a workspace.
   * Requires authenticated user to be a member of the workspace.
   * Returns 403 if user is not a member.
   *
   * SSE format per event:
   *   id: {event.id}
   *   event: {event.type}
   *   data: {JSON.stringify(event)}
   *
   * Heartbeat every 30s:
   *   :heartbeat
   */
  fastify.get(
    "/:wid",
    { preHandler: [requireMember("wid")] },
    async (request, reply) => {
      const raw = reply.raw;

      // ─── SSE headers ──────────────────────────────────────────────────
      raw.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
      });
      raw.flushHeaders();

      const { wid } = request.params as { wid: string };

      request.log.info(
        { userId: request.user.userId, workspaceId: wid },
        "SSE client connected to workspace event stream",
      );

      // ─── Last-Event-ID reconnection replay ────────────────────────────
      const lastEventIdHeader = request.headers["last-event-id"];
      if (lastEventIdHeader) {
        const lastEventId = parseInt(lastEventIdHeader as string, 10);
        if (!isNaN(lastEventId)) {
          const missedEvents = eventBus.getEventsSince(lastEventId);
          for (const event of missedEvents) {
            if (event.workspaceId === wid) {
              writeSSEEvent(raw, event);
            }
          }
        }
      }

      // ─── Subscribe to live events ─────────────────────────────────────
      const unsubscribe = eventBus.subscribeToWorkspace(
        wid,
        (event: DomainEvent) => {
          writeSSEEvent(raw, event);
        },
      );

      // ─── Heartbeat (30s) ──────────────────────────────────────────────
      const heartbeatInterval = setInterval(() => {
        raw.write(":heartbeat\n\n");
      }, 30_000);

      // ─── Cleanup on client disconnect ─────────────────────────────────
      request.raw.on("close", () => {
        clearInterval(heartbeatInterval);
        unsubscribe();

        request.log.info(
          { userId: request.user.userId, workspaceId: wid },
          "SSE client disconnected from workspace event stream",
        );
      });

      // Do not call reply.send() — response is managed via raw streaming
    },
  );
}

/**
 * Write a single SSE event frame to the response stream.
 *
 * Format:
 *   id: {event.id}
 *   event: {event.type}
 *   data: {JSON.stringify(event)}
 *   \n
 */
function writeSSEEvent(
  raw: import("http").ServerResponse,
  event: DomainEvent,
): void {
  raw.write(`id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`);
}
