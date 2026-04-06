import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { IssueKeyParam, StartWorkSessionBody } from "./schema.js";
import { requireIssueMember } from "../../middleware/require-role.js";
import * as workSessionService from "./service.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";

/**
 * Work session routes plugin.
 * Registered under /api prefix.
 */
export default async function workSessionRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/issues/:key/work-sessions — start work
   */
  app.post(
    "/issues/:key/work-sessions",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
        body: StartWorkSessionBody,
      },
    },
    async (request, reply) => {
      const result = await workSessionService.startWork(
        request.params.key,
        request.member!.id,
        request.user.userId,
        request.body.source,
      );
      return reply.status(201).send(result);
    },
  );

  /**
   * POST /api/issues/:key/work-sessions/heartbeat — heartbeat
   */
  app.post(
    "/issues/:key/work-sessions/heartbeat",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, _reply) => {
      const session = await workSessionService.heartbeat(
        request.params.key,
        request.user.userId,
      );
      if (!session) {
        throw new AppError(
          404,
          "SESSION_NOT_FOUND",
          "No active work session found for this issue",
        );
      }
      return { ok: true };
    },
  );

  /**
   * DELETE /api/issues/:key/work-sessions — stop work
   */
  app.delete(
    "/issues/:key/work-sessions",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, _reply) => {
      return workSessionService.stopWork(
        request.params.key,
        request.user.userId,
        request.member!.id,
      );
    },
  );

  /**
   * GET /api/issues/:key/work-sessions — list active workers
   */
  app.get(
    "/issues/:key/work-sessions",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, _reply) => {
      const issue = await prisma.issue.findUnique({
        where: { key: request.params.key },
        select: { id: true },
      });
      if (!issue) {
        throw new AppError(
          404,
          "ISSUE_NOT_FOUND",
          `Issue "${request.params.key}" not found`,
        );
      }
      return workSessionService.getActiveWorkers(issue.id);
    },
  );
}
