import type { FastifyInstance } from "fastify";
import type { ServerResponse } from "http";
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

// ─── Exported testable seams ──────────────────────────────────────────────────

/** Heartbeat interval in milliseconds. */
export const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Parse the `Last-Event-ID` header value into a numeric event ID.
 *
 * Returns null when:
 *  - the header is absent (undefined)
 *  - the value is empty or non-numeric
 *
 * Handles array headers (takes the first element).
 * Uses Number.isNaN for strict numeric validation.
 */
export function parseLastEventId(
  header: string | string[] | undefined,
): number | null {
  if (header === undefined) return null;
  const raw = Array.isArray(header) ? header[0] : header;
  if (!raw) return null;
  const parsed = parseInt(raw, 10);
  if (Number.isNaN(parsed)) return null;
  return parsed;
}

/**
 * Filter a list of domain events to only those belonging to a specific workspace.
 */
export function selectWorkspaceEvents(
  events: DomainEvent[],
  workspaceId: string,
): DomainEvent[] {
  return events.filter((e) => e.workspaceId === workspaceId);
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
export function writeSSEEvent(raw: ServerResponse, event: DomainEvent): void {
  raw.write(
    `id: ${event.id}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
  );
}

/**
 * Write a heartbeat SSE comment to keep the connection alive.
 */
export function writeHeartbeat(raw: ServerResponse): void {
  raw.write(":heartbeat\n\n");
}

/**
 * Start a periodic heartbeat on the given response stream.
 * Returns the interval handle so the caller can clearInterval on disconnect.
 */
export function startHeartbeat(raw: ServerResponse): NodeJS.Timeout {
  return setInterval(() => writeHeartbeat(raw), HEARTBEAT_INTERVAL_MS);
}

// ─── Route handler ─────────────────────────────────────────────────────────────

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
      const lastEventId = parseLastEventId(request.headers["last-event-id"]);
      if (lastEventId !== null) {
        const missedEvents = selectWorkspaceEvents(
          eventBus.getEventsSince(lastEventId),
          wid,
        );
        for (const event of missedEvents) {
          writeSSEEvent(raw, event);
        }
      }

      // ─── Subscribe to live events ─────────────────────────────────────
      const unsubscribe = eventBus.subscribeToWorkspace(
        wid,
        (event: DomainEvent) => {
          writeSSEEvent(raw, event);
        },
        "sse:workspace-events",
      );

      // ─── Heartbeat (30s) ──────────────────────────────────────────────
      const hb = startHeartbeat(raw);

      // ─── Cleanup on client disconnect ─────────────────────────────────
      request.raw.on("close", () => {
        clearInterval(hb);
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
