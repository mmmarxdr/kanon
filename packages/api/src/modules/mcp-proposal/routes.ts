import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { requireMember } from "../../middleware/require-role.js";

const WorkspaceIdParam = z.object({ id: z.string().uuid() });
const ProposalIdParam = z.object({ id: z.string().uuid() });

const ProposalKindEnum = z.enum([
  "promote_roadmap_item",
  "add_dependency",
  "split_issue",
  "reassign",
  "generic",
]);

const CreateProposalBody = z.object({
  kind: ProposalKindEnum,
  title: z.string().min(1).max(200),
  reason: z.string().max(1000).optional(),
  targetRef: z.string().max(120).optional(),
  payload: z.unknown().optional(),
  generatedBy: z.string().max(80).optional(),
  projectId: z.string().uuid().optional(),
});

const ListProposalsQuery = z.object({
  status: z.enum(["pending", "applied", "dismissed"]).optional(),
  projectId: z.string().uuid().optional(),
});

/**
 * Workspace-scoped: list + create proposals.
 * Mount under prefix "/api/workspaces".
 */
export async function workspaceProposalRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/:id/proposals",
    {
      preHandler: [requireMember("id")],
      schema: { params: WorkspaceIdParam, querystring: ListProposalsQuery },
    },
    async (request, _reply) => {
      const { id } = request.params;
      const { status, projectId } = request.query;
      return prisma.mcpProposal.findMany({
        where: {
          workspaceId: id,
          ...(status ? { status } : {}),
          ...(projectId ? { projectId } : {}),
        },
        orderBy: { proposedAt: "desc" },
        take: 50,
      });
    },
  );

  app.post(
    "/:id/proposals",
    {
      preHandler: [requireMember("id")],
      schema: { params: WorkspaceIdParam, body: CreateProposalBody },
    },
    async (request, reply) => {
      const proposal = await prisma.mcpProposal.create({
        data: {
          workspaceId: request.params.id,
          kind: request.body.kind,
          title: request.body.title,
          reason: request.body.reason,
          targetRef: request.body.targetRef,
          payload: (request.body.payload ?? null) as never,
          generatedBy: request.body.generatedBy ?? "claude-mcp",
          projectId: request.body.projectId,
        },
      });
      return reply.status(201).send(proposal);
    },
  );
}

/**
 * Global proposal actions: apply / dismiss.
 * Mount under prefix "/api".
 */
export async function proposalActionRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.post(
    "/proposals/:id/apply",
    { schema: { params: ProposalIdParam } },
    async (request, _reply) => {
      const p = await prisma.mcpProposal.findUnique({
        where: { id: request.params.id },
      });
      if (!p) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
      if (p.status !== "pending")
        throw new AppError(
          409,
          "PROPOSAL_NOT_PENDING",
          `Proposal already ${p.status}`,
        );
      return prisma.mcpProposal.update({
        where: { id: p.id },
        data: { status: "applied", appliedAt: new Date() },
      });
    },
  );

  app.post(
    "/proposals/:id/dismiss",
    { schema: { params: ProposalIdParam } },
    async (request, _reply) => {
      const p = await prisma.mcpProposal.findUnique({
        where: { id: request.params.id },
      });
      if (!p) throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
      if (p.status !== "pending")
        throw new AppError(
          409,
          "PROPOSAL_NOT_PENDING",
          `Proposal already ${p.status}`,
        );
      return prisma.mcpProposal.update({
        where: { id: p.id },
        data: { status: "dismissed", dismissedAt: new Date() },
      });
    },
  );
}
