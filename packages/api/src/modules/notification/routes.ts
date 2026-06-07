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
          limit: z.string().optional(),
        }),
      },
    },
    async (request, _reply) => {
      const workspaceId = request.params.id;
      const limit = Math.min(parseInt(request.query.limit ?? "20", 10), 50);
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
      schema: { params: WorkspaceIdParam },
    },
    async (request, _reply) => {
      const workspaceId = request.params.id;

      // Resolve member in workspace
      const member = await prisma.member.findFirst({
        where: { workspaceId, userId: request.user.userId },
        select: { id: true },
      });

      if (!member) return { updated: 0 };

      // Fetch all unread notifications to get mentionIds for dual-write
      const unreadNotifications = await prisma.notification.findMany({
        where: { recipientId: member.id, workspaceId, read: false },
        select: { id: true, kind: true, mentionId: true },
      });

      const mentionIds = unreadNotifications
        .filter((n) => n.kind === "mention" && n.mentionId)
        .map((n) => n.mentionId!);

      // Execute in a transaction: mark notifications + linked mentions read
      await prisma.$transaction([
        prisma.notification.updateMany({
          where: { recipientId: member.id, workspaceId, read: false },
          data: { read: true },
        }),
        ...(mentionIds.length > 0
          ? [
              prisma.mention.updateMany({
                where: { id: { in: mentionIds }, read: false },
                data: { read: true },
              }),
            ]
          : []),
      ]);

      return { updated: unreadNotifications.length };
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
      schema: { params: NotificationIdParam },
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
