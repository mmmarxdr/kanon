import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { IssueKeyParam, StartWorkSessionBody, MeWorkLogsQuery, WorkLogListResponse } from "./schema.js";
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
        request.via,
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
        request.via,
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

  /**
   * GET /api/issues/:key/worklogs — list WorkLogs for an issue (S2 / KAN-26)
   * Returns all WorkLog rows for the issue, newest first (by startedAt DESC).
   * Accessible to any workspace member.
   */
  app.get(
    "/issues/:key/worklogs",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
        response: { 200: WorkLogListResponse },
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

      const logs = await prisma.workLog.findMany({
        where: { issueId: issue.id },
        include: {
          member: { select: { id: true, username: true, isAgent: true } },
        },
        orderBy: { startedAt: "desc" },
        take: 50,
      });

      const worklogs = logs.map((l) => ({
        id: l.id,
        startedAt: l.startedAt.toISOString(),
        endedAt: l.endedAt.toISOString(),
        durationS: l.durationS,
        reason: l.reason as "stopped" | "expired",
        via: l.via,
        issueId: l.issueId,
        member: {
          id: l.member.id,
          username: l.member.username,
          isAgent: l.member.isAgent,
        },
      }));

      const totalDurationS = worklogs.reduce((sum, l) => sum + l.durationS, 0);

      return { worklogs, totalDurationS };
    },
  );

  /**
   * GET /api/me/worklogs — list own WorkLogs (S2 / KAN-26)
   * Returns all WorkLog rows for the authenticated user (newest first).
   * Looks up all member records for this userId, then queries worklogs.
   * Optional filters: workspaceId, from, to, limit.
   */
  app.get(
    "/me/worklogs",
    {
      schema: {
        querystring: MeWorkLogsQuery,
        response: { 200: WorkLogListResponse },
      },
    },
    async (request, _reply) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }

      const { workspaceId, from, to, limit } = request.query as {
        workspaceId?: string;
        from?: string;
        to?: string;
        limit: number;
      };

      // Resolve member records for this userId (may span multiple workspaces)
      const memberWhere: Record<string, unknown> = { userId };
      if (workspaceId) {
        memberWhere["workspaceId"] = workspaceId;
      }
      const members = await prisma.member.findMany({
        where: memberWhere,
        select: { id: true },
      });
      const memberIds = members.map((m) => m.id);

      if (memberIds.length === 0) {
        return { worklogs: [], totalDurationS: 0 };
      }

      // Build worklog where clause
      const logWhere: Record<string, unknown> = {
        memberId: { in: memberIds },
      };
      if (from || to) {
        const startedAtFilter: Record<string, Date> = {};
        if (from) startedAtFilter["gte"] = new Date(from);
        if (to) startedAtFilter["lte"] = new Date(to);
        logWhere["startedAt"] = startedAtFilter;
      }

      const logs = await prisma.workLog.findMany({
        where: logWhere,
        include: {
          member: { select: { id: true, username: true, isAgent: true } },
        },
        orderBy: { startedAt: "desc" },
        take: limit,
      });

      const worklogs = logs.map((l) => ({
        id: l.id,
        startedAt: l.startedAt.toISOString(),
        endedAt: l.endedAt.toISOString(),
        durationS: l.durationS,
        reason: l.reason as "stopped" | "expired",
        via: l.via,
        issueId: l.issueId,
        member: {
          id: l.member.id,
          username: l.member.username,
          isAgent: l.member.isAgent,
        },
      }));

      const totalDurationS = worklogs.reduce((sum, l) => sum + l.durationS, 0);

      return { worklogs, totalDurationS };
    },
  );
}
