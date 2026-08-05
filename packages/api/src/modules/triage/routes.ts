import { FastifyInstance } from "fastify";
import { z } from "zod";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { getIssueTriageHistory } from "./issue-history.js";
import { requireIssueMember } from "../../middleware/require-role.js";
import { prisma } from "../../config/prisma.js";

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
          cursor: z.string().optional()
        })
      }
    },
    getIssueTriageHistory
  );

  app.get("/api/triage-proposals/:id", async (request, reply) => {
    return { ok: true };
  });

  app.get("/api/projects/:key/triage-proposals", async (request, reply) => {
    return { rows: [] };
  });

  app.post(
    "/api/triage-proposals/:id/dismiss",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ reason: z.string().optional() })
      }
    },
    async (request, reply) => {
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      const proposal = await prisma.triageProposal.findUnique({
        where: { id: request.params.id },
        select: { projectId: true, workspaceId: true }
      });

      if (!proposal) {
        return reply.status(404).send({ error: "Proposal not found" });
      }

      const member = await prisma.member.findUnique({
        where: { userId_workspaceId: { userId: user.userId, workspaceId: proposal.workspaceId } }
      });

      if (!member) {
        return reply.status(403).send({ error: "Forbidden" });
      }

      const projectMember = await prisma.projectMember.findUnique({
        where: { userId_projectId: { userId: user.userId, projectId: proposal.projectId } }
      });

      if (!projectMember) {
        return reply.status(403).send({ error: "Forbidden: Not a project member" });
      }

      const { dismissTriageProposal } = await import("./lifecycle.js");
      try {
        const result = await dismissTriageProposal(request.params.id, member.id, request.body?.reason);
        return reply.send({ ok: true, status: result.proposal.lifecycle, event: result.event });
      } catch (err: any) {
        if (err.statusCode) {
          return reply.status(err.statusCode).send({ error: err.message });
        }
        if (err.code === "INVALID_STATE") {
          return reply.status(409).send({ error: err.message });
        }
        throw err;
      }
    }
  );
}
