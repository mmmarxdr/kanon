import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { getIssueTriageHistory } from "./issue-history.js";
import { requireIssueMember } from "../../middleware/require-role.js";
import { prisma } from "../../config/prisma.js";
import { getTriageProposal } from "./proposal-read.js";
import { listTriageProposals } from "./proposal-list.js";
import { AppError } from "../../shared/types.js";

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
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      try {
        const result = await getTriageProposal(user.userId, request.params.id);
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
      schema: {
        params: z.object({ key: z.string() }),
        querystring: z.object({
          state: z
            .enum(["current", "expired", "dismissed", "disposed", "all"])
            .optional(),
          limit: z.coerce.number().int().min(1).max(50).optional(),
          targetIssueId: z.string().uuid().optional(),
        }),
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }
      try {
        const result = await listTriageProposals(user.userId, request.params.key, {
          state: request.query.state,
          limit: request.query.limit,
          targetIssueId: request.query.targetIssueId,
        });
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
        body: z.object({ reason: z.string().optional() }),
      },
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const proposal = await prisma.triageProposal.findUnique({
        where: { id: request.params.id },
        select: { projectId: true, workspaceId: true },
      });

      if (!proposal) {
        return reply.status(404).send({ error: "Proposal not found" });
      }

      const member = await prisma.member.findUnique({
        where: {
          userId_workspaceId: {
            userId: user.userId,
            workspaceId: proposal.workspaceId,
          },
        },
      });

      if (!member) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const projectMember = await prisma.projectMember.findUnique({
        where: {
          userId_projectId: { userId: user.userId, projectId: proposal.projectId },
        },
      });

      if (!projectMember) {
        return reply.status(403).send({ error: "Forbidden: Not a project member" });
      }

      const { dismissTriageProposal } = await import("./lifecycle.js");
      try {
        const result = await dismissTriageProposal(
          request.params.id,
          member.id,
          request.body?.reason,
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
