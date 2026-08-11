import { Prisma, type MemberRole } from "@prisma/client";
import { FastifyInstance, type preHandlerHookHandler } from "fastify";
import { z } from "zod";
import { ZodTypeProvider } from "fastify-type-provider-zod";
import { getIssueTriageHistory } from "./issue-history.js";
import {
  requireIssueMember,
  requireProjectMember,
} from "../../middleware/require-role.js";
import { prisma } from "../../config/prisma.js";
import { getTriageProposal } from "./proposal-read.js";
import { listTriageProposals } from "./proposal-list.js";
import { AppError } from "../../shared/types.js";
import { env } from "../../config/env.js";
import { executePreview, PreviewRequestSchema } from "./preview.js";
import {
  PersistTriageProposalBodySchema,
  persistTriageProposal,
} from "./proposal-write.js";
import { observePreview, observeProposalOp, triageOutcome } from "./observability.js";

const PREVIEW_API_DEADLINE_MS = 2500;
const PERSIST_API_DEADLINE_MS = 2500;
const DISMISS_API_DEADLINE_MS = 1500;
const triageRequestStartedAt = new WeakMap<object, number>();

function requireCapability(enabled: boolean, message: string): preHandlerHookHandler {
  return async () => {
    if (!enabled) throw new AppError(503, "CAPABILITY_DISABLED", message);
  };
}

const roleLevel: Record<MemberRole, number> = { viewer: 0, member: 1, pm: 2, admin: 3, owner: 4 };

async function resolveVisibleProjectAccess(
  tx: Prisma.TransactionClient,
  userId: string,
  allowedProjectIds: string[] | undefined,
  projectId: string,
  workspaceId: string,
  minimumRole?: MemberRole,
) {
  if (allowedProjectIds?.length && !allowedProjectIds.includes(projectId)) {
    throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Resource not found");
  }
  const [member, projectMember] = await Promise.all([
    tx.member.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { id: true, role: true, projectAccess: true },
    }),
    tx.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId } },
      select: { role: true },
    }),
  ]);
  const visible = member && (
    member.role === "owner" ||
    member.role === "admin" ||
    member.projectAccess === "workspace" ||
    projectMember
  );
  if (!visible) throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Resource not found");
  const projectRole = member.role === "owner" || member.role === "admin" || member.projectAccess === "workspace"
    ? member.role
    : projectMember!.role;
  if (minimumRole && roleLevel[projectRole] < roleLevel[minimumRole]) {
    throw new AppError(403, "FORBIDDEN", `This action requires at least the "${minimumRole}" role`);
  }
  return {
    member: { id: member.id, role: member.role, workspaceId, userId, projectAccess: member.projectAccess },
    projectRole,
  };
}

async function boundedAuthorization<T>(deadlineAt: number, run: (tx: Prisma.TransactionClient) => Promise<T>) {
  const remaining = Math.floor(deadlineAt - performance.now());
  if (remaining < 2) throw new AppError(503, "AUTHORIZATION_TIMED_OUT", "Triage authorization timed out");
  const maxWait = Math.max(1, Math.min(250, Math.floor(remaining / 4)));
  try {
    return await prisma.$transaction(run, {
      isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
      maxWait,
      timeout: Math.max(1, remaining - maxWait),
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
      (error.code === "P2024" || error.code === "P2028")) {
      throw new AppError(503, "AUTHORIZATION_TIMED_OUT", "Triage authorization timed out");
    }
    throw error;
  }
}

function requireVisibleTriageIssue(
  appRaw: FastifyInstance,
  operation: "preview" | "persist",
  deadlineMs: number,
  minimumRole?: MemberRole,
): preHandlerHookHandler {
  return async (request) => {
    const started = performance.now();
    triageRequestStartedAt.set(request, started);
    const user = request.user;
    if (!user) throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    const issueKey = (request.params as { key?: string }).key;
    if (!issueKey) throw new AppError(400, "ISSUE_KEY_REQUIRED", "Issue key is required");

    try {
      const result = await boundedAuthorization(started + deadlineMs, async (tx) => {
        const issue = await tx.issue.findUnique({
          where: { key: issueKey },
          select: { id: true, project: { select: { id: true, workspaceId: true, archived: true } } },
        });
        if (!issue || issue.project.archived) {
          throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Issue not found");
        }
        const access = await resolveVisibleProjectAccess(
          tx, user.userId, user.allowedProjectIds, issue.project.id, issue.project.workspaceId, minimumRole,
        );
        return { issueId: issue.id, access };
      });
      request.issueId = result.issueId;
      request.member = result.access.member;
      request.projectRole = result.access.projectRole;
    } catch (error) {
      const duration = (performance.now() - started) / 1000;
      if (operation === "preview") {
        const phase = (request.body as { phase?: unknown } | undefined)?.phase === "validate" ? "validate" : "prepare";
        observePreview(appRaw.triageMetrics, {
          phase, outcome: triageOutcome(error), ai_contributed: "false",
        }, duration, []);
      } else {
        observeProposalOp(appRaw.triageMetrics, {
          operation: "persist", outcome: triageOutcome(error),
        }, duration);
      }
      throw error;
    }
  };
}

export async function triageProposalReadRoutes(appRaw: FastifyInstance) {
  const app = appRaw.withTypeProvider<ZodTypeProvider>();

  async function observedProposal<T>(
    operation: "persist" | "get" | "list" | "dismiss",
    run: () => Promise<T>,
    listRows?: (result: T) => { state_filter: "current" | "superseded" | "dismissed" | "expired" | "disposed" | "all"; count: number },
    started = performance.now(),
  ): Promise<T> {
    try {
      const result = await run();
      observeProposalOp(
        appRaw.triageMetrics,
        { operation, outcome: "success" },
        (performance.now() - started) / 1000,
        listRows?.(result),
      );
      return result;
    } catch (error) {
      observeProposalOp(
        appRaw.triageMetrics,
        { operation, outcome: triageOutcome(error) },
        (performance.now() - started) / 1000,
      );
      throw error;
    }
  }

  app.post(
    "/api/issues/:key/triage/preview",
    {
      preHandler: [
        requireCapability(env.TRIAGE_PREVIEW_ENABLED, "Triage preview is disabled"),
        requireVisibleTriageIssue(appRaw, "preview", PREVIEW_API_DEADLINE_MS),
      ],
      schema: {
        params: z.object({ key: z.string().min(1) }),
        body: PreviewRequestSchema,
      },
    },
    async (request, reply) => {
      const started = triageRequestStartedAt.get(request) ?? performance.now();
      try {
        const preview = await executePreview({
          issueKey: request.params.key,
          userId: request.member!.userId,
          allowedProjectIds: request.user?.allowedProjectIds,
          correlationId: request.id,
          request: request.body,
          deadlineAt: started + PREVIEW_API_DEADLINE_MS,
        });
        observePreview(
          appRaw.triageMetrics,
          {
            phase: request.body.phase,
            outcome: preview.degradation.length > 0 ? "degraded_success" : "success",
            ai_contributed: preview.recommendations.some((item) => item.source === "host_ai")
              ? "true"
              : "false",
          },
          (performance.now() - started) / 1000,
          preview.degradation,
        );
        return reply.send(preview);
      } catch (error) {
        observePreview(
          appRaw.triageMetrics,
          { phase: request.body.phase, outcome: triageOutcome(error), ai_contributed: "false" },
          (performance.now() - started) / 1000,
        );
        throw error;
      }
    },
  );

  app.post(
    "/api/issues/:key/triage-proposals",
    {
      preHandler: [
        requireCapability(env.TRIAGE_PROPOSALS_ENABLED, "Triage proposal writes are disabled"),
        requireVisibleTriageIssue(appRaw, "persist", PERSIST_API_DEADLINE_MS, "member"),
      ],
      schema: {
        params: z.object({ key: z.string().min(1) }),
        body: PersistTriageProposalBodySchema,
      },
    },
    async (request, reply) => {
      const started = triageRequestStartedAt.get(request) ?? performance.now();
      const proposal = await observedProposal("persist", () => persistTriageProposal({
        issueKey: request.params.key,
        issueId: request.issueId!,
        memberId: request.member!.id,
        userId: request.member!.userId,
        allowedProjectIds: request.user?.allowedProjectIds,
        client: request.via ?? null,
        correlationId: request.id,
        body: request.body,
      }, started + PERSIST_API_DEADLINE_MS), undefined, started);
      return reply.status(proposal.outcome === "created" ? 201 : 200).send(proposal);
    },
  );

  app.get(
    "/api/issues/:key/triage-history",
    {
      preHandler: [
        requireCapability(env.TRIAGE_PROPOSAL_READS_ENABLED, "Triage proposal reads are disabled"),
        requireIssueMember("key"),
      ],
      schema: {
        params: z.object({ key: z.string() }),
        querystring: z.object({
          limit: z.coerce.number().int().min(1).max(20).default(10),
          cursor: z.string().optional(),
        }),
      },
    },
    async (request, reply) => {
      return getIssueTriageHistory(request, reply);
    },
  );

  app.get(
    "/api/triage-proposals/:id",
    {
      preHandler: [requireCapability(env.TRIAGE_PROPOSAL_READS_ENABLED, "Triage proposal reads are disabled")],
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
        const result = await observedProposal("get", () => getTriageProposal(
          user.userId,
          request.params.id,
          user.allowedProjectIds,
          request.query.format,
        ));
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
      preHandler: [
        requireCapability(env.TRIAGE_PROPOSAL_READS_ENABLED, "Triage proposal reads are disabled"),
        requireProjectMember("key"),
      ],
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
        const state = request.query.state ?? "current";
        const result = await observedProposal(
          "list",
          () => listTriageProposals(
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
          ),
          (page) => ({ state_filter: state, count: page.returnedCount }),
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
      preHandler: [requireCapability(env.TRIAGE_PROPOSALS_ENABLED, "Triage proposals are disabled")],
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: z.object({ reason: z.string().trim().min(1).max(1000) }).strict(),
      },
    },
    async (request, reply) => {
      const started = performance.now();
      const deadlineAt = started + DISMISS_API_DEADLINE_MS;
      const user = request.user;
      if (!user) {
        return reply.status(401).send({ error: "Unauthorized" });
      }

      try {
        const result = await observedProposal("dismiss", async () => {
          const { member } = await boundedAuthorization(deadlineAt, async (tx) => {
            const proposal = await tx.triageProposal.findUnique({
              where: { id: request.params.id },
              select: { projectId: true, workspaceId: true, targetIssueId: true },
            });
            if (!proposal) {
              throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Proposal not found");
            }
            const target = await tx.issue.findFirst({
              where: { id: proposal.targetIssueId, projectId: proposal.projectId },
              select: { id: true },
            });
            if (!target) throw new AppError(404, "NOT_FOUND_OR_NOT_VISIBLE", "Proposal not found");
            return resolveVisibleProjectAccess(
              tx, user.userId, user.allowedProjectIds, proposal.projectId, proposal.workspaceId, "member",
            );
          });
          const { dismissTriageProposal } = await import("./lifecycle.js");
          return dismissTriageProposal(
            request.params.id,
            member.id,
            request.body.reason,
            { correlationId: request.id, client: request.via ?? null },
            deadlineAt,
          );
        }, undefined, started);
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
