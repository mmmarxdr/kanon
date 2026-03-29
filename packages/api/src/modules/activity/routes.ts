import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { ACTIVITY_ACTIONS } from "../../shared/constants.js";
import { resolveMemberIdFromIssue } from "../../shared/resolve-member.js";
import * as activityService from "./service.js";

/**
 * Activity routes plugin.
 * GET  /api/issues/:key/activity
 * POST /api/issues/:key/activity
 */
export default async function activityRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/issues/:key/activity
   */
  app.get(
    "/issues/:key/activity",
    {
      schema: {
        params: z.object({
          key: z.string(),
        }),
      },
    },
    async (request, _reply) => {
      const { key } = request.params;

      const issue = await prisma.issue.findUnique({
        where: { key },
        select: { id: true },
      });
      if (!issue) {
        throw new AppError(404, "ISSUE_NOT_FOUND", `Issue ${key} not found`);
      }

      const logs = await activityService.getActivityByIssue(issue.id);

      // Transform DB shape → frontend ActivityLog shape:
      // - member → actor (id + username)
      // - details JSON → top-level field, oldValue, newValue
      return logs.map((log) => {
        const details =
          log.details && typeof log.details === "object" && !Array.isArray(log.details)
            ? (log.details as Record<string, unknown>)
            : {};

        return {
          id: log.id,
          action: log.action,
          field: typeof details["field"] === "string" ? details["field"] : undefined,
          oldValue: typeof details["oldValue"] === "string" ? details["oldValue"] : undefined,
          newValue: typeof details["newValue"] === "string" ? details["newValue"] : undefined,
          actor: {
            id: log.member.id,
            username: log.member.username,
          },
          createdAt: log.createdAt,
        };
      });
    },
  );

  /**
   * POST /api/issues/:key/activity
   *
   * Create an activity log entry for an issue.
   * Used by the CLI to record sync operations (engram_synced, etc.).
   */
  app.post(
    "/issues/:key/activity",
    {
      schema: {
        params: z.object({
          key: z.string(),
        }),
        body: z.object({
          action: z.enum(ACTIVITY_ACTIONS),
          details: z.record(z.unknown()).optional(),
        }),
      },
    },
    async (request, reply) => {
      const { key } = request.params;

      const issue = await prisma.issue.findUnique({
        where: { key },
        select: { id: true },
      });
      if (!issue) {
        throw new AppError(404, "ISSUE_NOT_FOUND", `Issue ${key} not found`);
      }

      const memberId = await resolveMemberIdFromIssue(
        request.user.userId,
        key,
      );

      const entry = await activityService.createActivityLog({
        issueId: issue.id,
        memberId,
        action: request.body.action,
        details: request.body.details as Prisma.InputJsonValue | undefined,
      });

      return reply.status(201).send(entry);
    },
  );
}
