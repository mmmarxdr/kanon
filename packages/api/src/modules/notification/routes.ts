/**
 * Notification module routes — S3 / KAN-27, updated S5 / KAN-29
 *
 * Endpoints:
 *  GET  /api/workspaces/:wid/notifications              — list own notifications (paginated)
 *  PATCH /api/notifications/:id/read                   — mark single notification read (dual-write)
 *  POST /api/workspaces/:wid/notifications/read-all    — mark all read + dual-write Mentions
 *  GET  /api/workspaces/:wid/notification-preferences  — row or synthesized defaults
 *  PUT  /api/workspaces/:wid/notification-preferences  — upsert 3 booleans
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireMember } from "../../middleware/require-role.js";
import { AppError } from "../../shared/types.js";
// Bridge is the single source of truth for the preference schema (fix R4)
import { notificationPreferenceItemSchema } from "@kanon/shared";
// KAN-40: emit notification lifecycle events for live inbox SSE propagation.
import { eventBus } from "../../services/event-bus/index.js";

const WorkspaceIdParam = z.object({ id: z.string().uuid() });
const NotificationIdParam = z.object({ id: z.string().uuid() });

/**
 * Response schema for a single notification list item.
 * Mirrors the Prisma select + ISO createdAt serialisation used by the list route.
 */
const NotificationItemSchema = z.object({
  id: z.string().uuid(),
  kind: z.enum(["mention", "assignment", "subscribed_activity", "cycle_closed"]),
  recipientId: z.string().uuid(),
  actorId: z.string().uuid().nullable(),
  issueId: z.string().uuid().nullable(),
  mentionId: z.string().uuid().nullable(),
  payload: z.record(z.unknown()).nullable(),
  read: z.boolean(),
  via: z.string().nullable(),
  createdAt: z.string(),
});

const NotificationListResponseSchema = z.object({
  notifications: z.array(NotificationItemSchema),
});

const ReadAllResponseSchema = z.object({ updated: z.number().int().min(0) });

const MarkReadResponseSchema = z.object({
  id: z.string().uuid(),
  read: z.literal(true),
});

// notificationPreferenceItemSchema from @kanon/shared serves as both the PUT
// body and the GET/PUT response[200] schema — no local duplicate needed (R4).

export default async function notificationRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/workspaces/:id/notifications
   * List notifications for the authenticated member in the workspace.
   * Scoped to recipient only. Ordered by createdAt DESC.
   * Optional query: unreadOnly=true, limit=20 (default).
   */
  app.get(
    "/:id/notifications",
    {
      preHandler: [requireMember("id")],
      schema: {
        params: WorkspaceIdParam,
        querystring: z.object({
          unreadOnly: z.string().optional(),
          limit: z.coerce.number().int().min(1).max(50).default(20),
        }),
        response: { 200: NotificationListResponseSchema },
      },
    },
    async (request, _reply) => {
      const workspaceId = request.params.id;
      const limit = request.query.limit;
      const unreadOnly = request.query.unreadOnly === "true";
      // requireMember("id") guarantees request.member is set (R5)
      const memberId = request.member!.id;

      const notifications = await prisma.notification.findMany({
        where: {
          recipientId: memberId,
          workspaceId,
          ...(unreadOnly ? { read: false } : {}),
        },
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          kind: true,
          recipientId: true,
          actorId: true,
          issueId: true,
          mentionId: true,
          payload: true,
          read: true,
          via: true,
          createdAt: true,
        },
      });

      return {
        notifications: notifications.map((n) => ({
          ...n,
          // Prisma returns JsonValue for Json columns; cast to schema-expected type.
          payload: (n.payload ?? null) as Record<string, unknown> | null,
          createdAt: n.createdAt.toISOString(),
        })),
      };
    },
  );

  /**
   * POST /api/workspaces/:id/notifications/read-all
   * Mark all unread notifications for the authenticated member as read.
   * Also sets Mention.read=true for linked mention notifications (dual-write).
   */
  app.post(
    "/:id/notifications/read-all",
    {
      preHandler: [requireMember("id")],
      schema: {
        params: WorkspaceIdParam,
        response: { 200: ReadAllResponseSchema },
      },
    },
    async (request, _reply) => {
      const workspaceId = request.params.id;
      // requireMember("id") guarantees request.member is set (R5)
      const memberId = request.member!.id;

      // Interactive transaction: capture the unread set and update it atomically.
      // This prevents a race where a notification arriving between findMany and
      // updateMany gets its Notification.read flipped but its linked Mention left
      // unread (permanent divergence).
      const updatedCount = await prisma.$transaction(async (tx) => {
        const unreadNotifications = await tx.notification.findMany({
          where: { recipientId: memberId, workspaceId, read: false },
          select: { id: true, kind: true, mentionId: true },
        });

        if (unreadNotifications.length === 0) return 0;

        const capturedIds = unreadNotifications.map((n) => n.id);
        const mentionIds = unreadNotifications
          .filter((n) => n.kind === "mention" && n.mentionId)
          .map((n) => n.mentionId!);

        // Update only the captured set (not a broad updateMany by memberId)
        await tx.notification.updateMany({
          where: { id: { in: capturedIds }, read: false },
          data: { read: true },
        });

        if (mentionIds.length > 0) {
          await tx.mention.updateMany({
            where: { id: { in: mentionIds }, read: false },
            data: { read: true },
          });
        }

        return unreadNotifications.length;
      });

      // KAN-40: emit ONE notification.marked_read after the transaction, only if rows were updated.
      // actorId = memberId (the recipient marks their own read). Bare payload (privacy).
      if (updatedCount > 0) {
        try {
          eventBus.emit({ type: "notification.marked_read", workspaceId, actorId: memberId, payload: {} });
        } catch { /* D3 */ }
      }

      return { updated: updatedCount };
    },
  );

  /**
   * GET /api/workspaces/:id/notification-preferences
   * Return the authenticated member's notification preferences (row or synthesized defaults).
   */
  app.get(
    "/:id/notification-preferences",
    {
      preHandler: [requireMember("id")],
      schema: {
        params: WorkspaceIdParam,
        // Bridge schema is single source of truth (R4)
        response: { 200: notificationPreferenceItemSchema },
      },
    },
    async (request, _reply) => {
      // requireMember("id") guarantees request.member is set (R5)
      const memberId = request.member!.id;

      const pref = await prisma.notificationPreference.findUnique({
        where: { memberId },
        select: { emailMention: true, emailAssignment: true, emailCycleClosed: true },
      });

      // No row = synthesized defaults (all true)
      return {
        emailMention: pref?.emailMention ?? true,
        emailAssignment: pref?.emailAssignment ?? true,
        emailCycleClosed: pref?.emailCycleClosed ?? true,
      };
    },
  );

  /**
   * PUT /api/workspaces/:id/notification-preferences
   * Upsert the authenticated member's notification preferences.
   */
  app.put(
    "/:id/notification-preferences",
    {
      preHandler: [requireMember("id")],
      schema: {
        params: WorkspaceIdParam,
        // Bridge schema is single source of truth for body + response (R4)
        body: notificationPreferenceItemSchema,
        response: { 200: notificationPreferenceItemSchema },
      },
    },
    async (request, _reply) => {
      // requireMember("id") guarantees request.member is set (R5)
      const memberId = request.member!.id;
      const { emailMention, emailAssignment, emailCycleClosed } = request.body;

      const upserted = await prisma.notificationPreference.upsert({
        where: { memberId },
        create: {
          memberId,
          emailMention,
          emailAssignment,
          emailCycleClosed,
        },
        update: {
          emailMention,
          emailAssignment,
          emailCycleClosed,
        },
        select: { emailMention: true, emailAssignment: true, emailCycleClosed: true },
      });

      return upserted;
    },
  );
}

/**
 * Routes that do NOT have a workspace prefix — registered at /api prefix.
 */
export async function notificationActionRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * PATCH /api/notifications/:id/read
   * Mark a single notification as read.
   * Authorization: only the notification recipient may mark it read.
   * Dual-write: if kind=mention and mentionId is set, also marks Mention.read=true.
   */
  app.patch(
    "/notifications/:id/read",
    {
      schema: {
        params: NotificationIdParam,
        response: { 200: MarkReadResponseSchema },
      },
    },
    async (request, reply) => {
      const { id: notificationId } = request.params;

      // Resolve the requesting user's member context
      // We need to find the member across all workspaces (notification has workspaceId)
      const notification = await prisma.notification.findUnique({
        where: { id: notificationId },
        select: {
          id: true,
          kind: true,
          recipientId: true,
          workspaceId: true,
          mentionId: true,
          read: true,
          recipient: { select: { userId: true } },
        },
      });

      if (!notification) {
        throw new AppError(404, "NOTIFICATION_NOT_FOUND", "Notification not found");
      }

      // Authorization: only the recipient may mark-read
      if (notification.recipient.userId !== request.user.userId) {
        throw new AppError(403, "FORBIDDEN", "You cannot mark another member's notification as read");
      }

      // Idempotency guard: if already read, skip the DB write and the SSE emit entirely.
      // Returning the current (read) state preserves the success response shape.
      if (notification.read) {
        return reply.status(200).send({ id: notificationId, read: true });
      }

      // Dual-write in a transaction when kind=mention
      if (notification.kind === "mention" && notification.mentionId) {
        await prisma.$transaction([
          prisma.notification.update({
            where: { id: notificationId },
            data: { read: true },
          }),
          prisma.mention.update({
            where: { id: notification.mentionId },
            data: { read: true },
          }),
        ]);
      } else {
        await prisma.notification.update({
          where: { id: notificationId },
          data: { read: true },
        });
      }

      // KAN-40: emit notification.marked_read after successful DB write — fire-and-forget (D3).
      // workspaceId from the FETCHED notification (no workspaceId route param exists).
      // actorId = notification.recipientId (the recipient marks their own read); this carries
      // the recipient's memberId in the event envelope — deliberate: no consumer renders actorId
      // and it is an activity signal only; payload remains bare (privacy contract).
      try {
        eventBus.emit({ type: "notification.marked_read", workspaceId: notification.workspaceId, actorId: notification.recipientId, payload: {} });
      } catch { /* D3 */ }

      return reply.status(200).send({ id: notificationId, read: true });
    },
  );
}
