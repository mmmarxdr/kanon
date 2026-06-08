/**
 * Notification module routes — S3 / KAN-27
 *
 * Endpoints:
 *  GET  /api/workspaces/:wid/notifications            — list own notifications (paginated)
 *  PATCH /api/notifications/:id/read                 — mark single notification read (dual-write)
 *  POST /api/workspaces/:wid/notifications/read-all  — mark all read + dual-write Mentions
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireMember } from "../../middleware/require-role.js";
import { AppError } from "../../shared/types.js";

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

      // Resolve member in workspace
      const member = await prisma.member.findFirst({
        where: { workspaceId, userId: request.user.userId },
        select: { id: true },
      });

      if (!member) return { notifications: [] };

      const notifications = await prisma.notification.findMany({
        where: {
          recipientId: member.id,
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

      // Resolve member in workspace
      const member = await prisma.member.findFirst({
        where: { workspaceId, userId: request.user.userId },
        select: { id: true },
      });

      if (!member) return { updated: 0 };

      // Interactive transaction: capture the unread set and update it atomically.
      // This prevents a race where a notification arriving between findMany and
      // updateMany gets its Notification.read flipped but its linked Mention left
      // unread (permanent divergence).
      const updatedCount = await prisma.$transaction(async (tx) => {
        const unreadNotifications = await tx.notification.findMany({
          where: { recipientId: member.id, workspaceId, read: false },
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

      return { updated: updatedCount };
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

      return reply.status(200).send({ id: notificationId, read: true });
    },
  );
}
