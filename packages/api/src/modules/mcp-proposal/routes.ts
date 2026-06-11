import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { requireMember, requireProposalRole } from "../../middleware/require-role.js";
import { scopedProjectIds } from "../../shared/token-scope.js";

// KAN-80: proposals are small JSON action-descriptor objects. Bound the shape
// (object, not arbitrary JSON) and the serialized size to prevent DB bloat / DoS
// from oversized payloads. 8 KiB is generous for an action descriptor.
const MAX_PROPOSAL_PAYLOAD_BYTES = 8 * 1024;
const ProposalPayload = z
  .record(z.string(), z.unknown())
  .refine(
    (val) => Buffer.byteLength(JSON.stringify(val), "utf8") <= MAX_PROPOSAL_PAYLOAD_BYTES,
    { message: `payload must be at most ${MAX_PROPOSAL_PAYLOAD_BYTES} bytes when serialized` },
  );

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
  payload: ProposalPayload.optional(),
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
      // KAN-67 / KAN-79: a scoped token only sees proposals for its allowed
      // projects plus workspace-level (null-project) ones — consistent with
      // requireProposalRole. Unscoped tokens are unaffected.
      const allowed = scopedProjectIds(request.user.allowedProjectIds);
      return prisma.mcpProposal.findMany({
        where: {
          workspaceId: id,
          ...(status ? { status } : {}),
          ...(projectId ? { projectId } : {}),
          ...(allowed ? { OR: [{ projectId: { in: allowed } }, { projectId: null }] } : {}),
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
          // KAN-80: typed Json instead of the old `as never`. Absent → SQL NULL.
          payload:
            request.body.payload === undefined
              ? Prisma.DbNull
              : (request.body.payload as Prisma.InputJsonValue),
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
    { preHandler: [requireProposalRole("id", "member")], schema: { params: ProposalIdParam } },
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
    { preHandler: [requireProposalRole("id", "member")], schema: { params: ProposalIdParam } },
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
