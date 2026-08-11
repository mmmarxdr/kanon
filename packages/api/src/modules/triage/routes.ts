import { FastifyInstance } from "fastify";
import type { MemberRole } from "@prisma/client";
import { z } from "zod";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { getIssueTriageHistory } from "./issue-history.js";
import {
  enforceProjectAccess,
  requireIssueMember,
  requireProjectMember,
} from "../../middleware/require-role.js";
import { prisma } from "../../config/prisma.js";
import { getTriageProposal } from "./proposal-read.js";
import { listTriageProposals } from "./proposal-list.js";
import { AppError } from "../../shared/types.js";

async function requireVisibleProjectAccess(
  userId: string,
  allowedProjectIds: string[] | undefined,
  projectId: string,
  workspaceId: string,
  minimumRole?: MemberRole,
) {
  if (allowedProjectIds && !allowedProjectIds.includes(projectId)) {
    throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Resource not found");
  }
  const [member, projectMember] = await Promise.all([
    prisma.member.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { role: true, projectAccess: true },
    }),
    prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { id: true },
    }),
  ]);
  const visible = member && (
    member.role === "owner" || member.role === "admin" ||
    member.projectAccess === "workspace" || projectMember
  );
  if (!visible) throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Resource not found");
  return enforceProjectAccess(userId, projectId, workspaceId, minimumRole, allowedProjectIds);
}

export async function triageProposalReadRoutes(appRaw: FastifyInstance) {
  const app = appRaw.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/api/issues/:key/triage-history",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: z.object({ key: z.string() }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(20).default(10),
          cursor: z.string().optional(),
        }),
      },
    },
    async (request, reply) => getIssueTriageHistory(request, reply),
  );

  app.get(
    "/api/triage-proposals/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        querystring: z.object({ format: z.enum(["compact", "full"]).default("full") }).strict(),
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      try {
        const result = await getTriageProposal(
          user.userId,
          request.params.id,
          user.allowedProjectIds,
          request.query.format,
        );
        return reply.status(result.statusCode).send(result.body);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  app.get(
    "/api/projects/:key/triage-proposals",
    {
      preHandler: [requireProjectMember("key")],
      schema: {
        params: z.object({ key: z.string() }),
        querystring: z.object({
          state: z
            .enum(["current", "superseded", "expired", "dismissed", "disposed", "all"])
            .optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
          targetIssueKey: z.string().min(1).max(120).optional(),
          targetIssueId: z.string().uuid().optional(),
          generatorSource: z
            .enum(["deterministic_policy", "host_ai", "mixed"])
            .optional(),
          degraded: z.enum(["true", "false"]).transform((value) => value === "true").optional(),
          cursor: z.string().min(1).max(2048).optional(),
        }).strict(),
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      try {
        const result = await listTriageProposals(
          user.userId,
          request.projectId!,
          {
            state: request.query.state,
            limit: request.query.limit,
            targetIssueKey: request.query.targetIssueKey,
            targetIssueId: request.query.targetIssueId,
            generatorSource: request.query.generatorSource,
            degraded: request.query.degraded,
            cursor: request.query.cursor,
          },
          user.allowedProjectIds,
          request.id,
        );
        return reply.send(result);
      } catch (err) {
        if (err instanceof AppError) {
          return reply.status(err.statusCode).send({ error: err.message, code: err.code });
        }
        throw err;
      }
    },
  );

  app.post(
    "/api/triage-proposals/:id/dismiss",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ reason: z.string().trim().min(1).max(1000) }).strict(),
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const proposal = await prisma.triageProposal.findUnique({
        where: { id: request.params.id },
        select: { projectId: true, workspaceId: true, targetIssueId: true },
      });

      if (!proposal) {
        throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Proposal not found");
      }
      const target = await prisma.issue.findFirst({
        where: { id: proposal.targetIssueId, projectId: proposal.projectId },
        select: { id: true },
      });
      if (!target) throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Proposal not found");
      const { member } = await requireVisibleProjectAccess(
        user.userId,
        user.allowedProjectIds,
        proposal.projectId,
        proposal.workspaceId,
        "member",
      );

      const { dismissTriageProposal } = await import("./lifecycle.js");
      try {
        const result = await dismissTriageProposal(
          request.params.id,
          member.id,
          request.body.reason,
          { correlationId: request.id, client: request.via ?? null },
        );
        return reply.send({
          ok: true,
          status: result.proposal.lifecycle,
          event: result.event,
        });
      } catch (err: any) {
        if (err.statusCode) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        if (err.code === "INVALID_STATE") {
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
    },
  );
}
