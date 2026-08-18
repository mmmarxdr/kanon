import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import {
  enforceProjectAccess,
  requireMember,
  requireProposalRole,
} from "../../middleware/require-role.js";
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
      try {
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
      } catch (err) {
        // KAN-116: the partial unique index mcp_proposals_pending_generic_target_ref_key
        // forbids a second PENDING GENERIC proposal for the same targetRef (the
        // multi-instance dedup backstop). Surface the duplicate as 409, not a raw 500.
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
          throw new AppError(
            409,
            "PROPOSAL_DUPLICATE",
            "A pending generic proposal already exists for this targetRef",
          );
        }
        throw err;
      }
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
    {
      preHandler: [
        // Triage-first UUID resolution: never treat a triage proposal id as legacy apply.
        async (request, _reply) => {
          const load = async <T>(query: () => Promise<T>): Promise<T> => {
            try {
              return await query();
            } catch {
              throw new AppError(503, "TRIAGE_GUARD_UNAVAILABLE", "Triage apply guard is unavailable");
            }
          };
          const id = (request.params as Record<string, string>)["id"];
          if (!id) throw new AppError(400, "PROPOSAL_ID_REQUIRED", "Proposal ID is required");

          const tp = await load(() => prisma.triageProposal.findUnique({
            where: { id },
            select: { id: true, targetIssueId: true, projectId: true, workspaceId: true },
          }));
          if (!tp) return;
          const user = request.user;
          if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
          const target = await load(() => prisma.issue.findFirst({
            where: { id: tp.targetIssueId, projectId: tp.projectId },
            select: { id: true },
          }));
          if (!target) {
            throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
          }
          let memberId: string;
          try {
            const access = await enforceProjectAccess(
              user.userId,
              tp.projectId,
              tp.workspaceId,
              "member",
              user.allowedProjectIds,
            );
            memberId = access.member.id;
          } catch (error) {
            if (error instanceof AppError && (error.statusCode === 403 || error.statusCode === 404)) {
              throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
            }
            throw new AppError(503, "TRIAGE_GUARD_UNAVAILABLE", "Triage apply guard is unavailable");
          }
          try {
            await prisma.adminAuditLog.create({
              data: {
                entityType: "triage_proposal",
                entityId: tp.id,
                action: "apply_rejected",
                payload: {
                  correlationId: request.id,
                  client: request.via ?? null,
                  nonExecutable: true,
                },
                authorId: memberId,
                reason: "Triage proposals are non-executable",
              },
            });
          } catch {
            throw new AppError(503, "AUDIT_UNAVAILABLE", "Rejected apply could not be audited");
          }
          throw new AppError(
            422,
            "TRIAGE_PROPOSAL_NON_EXECUTABLE",
            "Cannot execute triage proposal here",
          );
        },
        requireProposalRole("id", "member"),
      ],
      schema: { params: ProposalIdParam },
    },
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
