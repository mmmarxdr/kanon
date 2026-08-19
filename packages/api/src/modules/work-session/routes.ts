import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  IssueKeyParam,
  StartWorkSessionBody,
  VersionedWorkCaptureCommandBody,
  WorkCaptureEffectResponse,
  WorkSessionHeartbeatBody,
  type VersionedWorkCaptureCommandBody as VersionedWorkCaptureCommand,
  type WorkCaptureIntentSnapshot as CaptureIntentSnapshot,
  RecordInterruptionBody,
  MeWorkLogsQuery,
  WorkLogListResponse,
  WorkCaptureHydrationPage,
  WorkCaptureHydrationQuery,
} from "./schema.js";
import { requireIssueMember } from "../../middleware/require-role.js";
import * as workSessionService from "./service.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { scopedProjectIds } from "../../shared/token-scope.js";
import { requestWorkCaptureIntentEffect } from "./capture-intent-effect.js";
import { publishDomainEventByDeliveryKey } from "../../services/event-bus/outbox.js";
import { listPrincipalCaptureIntents } from "./capture-intent.js";

type WorkCaptureOperation = "start" | "heartbeat" | "release" | "close";
type WorkCaptureEffectKind = "activity" | "release" | "close";
type WorkCaptureRouteLogger = {
  error(obj: unknown, message?: string): void;
};

async function findPrincipalCaptureIntent(userId: string, issueId: string) {
  return prisma.workCaptureIntent.findUnique({
    where: { userId_issueId: { userId, issueId } },
    select: {
      id: true,
      epoch: true,
      leaseGeneration: true,
      state: true,
      memberId: true,
    },
  });
}

function captureIntentSnapshot(
  intent: Awaited<ReturnType<typeof findPrincipalCaptureIntent>>
): CaptureIntentSnapshot | null {
  if (!intent) return null;
  return {
    epoch: intent.epoch,
    leaseGeneration: intent.leaseGeneration,
    state: intent.state,
  };
}

async function readCaptureIntentAfterCommit(input: {
  userId: string;
  issueId: string;
  operation: WorkCaptureOperation;
  commandId?: string;
  log: WorkCaptureRouteLogger;
}): Promise<CaptureIntentSnapshot | null> {
  try {
    return captureIntentSnapshot(await findPrincipalCaptureIntent(input.userId, input.issueId));
  } catch (error) {
    input.log.error(
      {
        err: error,
        operation: input.operation,
        ...(input.commandId ? { commandId: input.commandId } : {}),
      },
      "work-capture snapshot read failed after commit"
    );
    return null;
  }
}

async function beforeDurableAcceptance<T>(input: {
  operation: WorkCaptureOperation;
  commandId?: string;
  log: WorkCaptureRouteLogger;
  run: () => Promise<T>;
}): Promise<T> {
  try {
    return await input.run();
  } catch (error) {
    if (error instanceof AppError) throw error;
    input.log.error(
      {
        err: error,
        operation: input.operation,
        ...(input.commandId ? { commandId: input.commandId } : {}),
      },
      "work-capture request failed before durable acceptance"
    );
    throw new AppError(503, "WORK_CAPTURE_RETRYABLE", "Work capture is temporarily unavailable", {
      retryable: true,
      operation: input.operation,
      ...(input.commandId ? { commandId: input.commandId } : {}),
    });
  }
}

function invalidWorkCaptureCommand(): AppError {
  return new AppError(400, "VALIDATION_ERROR", "Invalid work-capture command");
}

function parseWorkCaptureCommand(body: unknown): VersionedWorkCaptureCommand {
  const parsed = VersionedWorkCaptureCommandBody.safeParse(body);
  if (!parsed.success) throw invalidWorkCaptureCommand();
  return parsed.data;
}

async function deliveryStatusAfterAcceptance(input: {
  deliveryKey: string;
  operation: WorkCaptureOperation;
  commandId: string;
  log: WorkCaptureRouteLogger;
}): Promise<"acknowledged" | "pending"> {
  try {
    if (await publishDomainEventByDeliveryKey(input.deliveryKey)) {
      return "acknowledged";
    }
    const row = await prisma.domainEventOutbox.findUnique({
      where: { deliveryKey: input.deliveryKey },
      select: { acknowledgedAt: true },
    });
    return row?.acknowledgedAt ? "acknowledged" : "pending";
  } catch (error) {
    input.log.error(
      { err: error, operation: input.operation, commandId: input.commandId },
      "work-capture delivery status unavailable after acceptance"
    );
    return "pending";
  }
}

async function requestDurableCaptureEffect(input: {
  command: VersionedWorkCaptureCommand;
  kind: WorkCaptureEffectKind;
  operation: WorkCaptureOperation;
  userId: string;
  memberId: string;
  issueId: string;
  ownerKind: "web" | "mcp" | "implicit";
  log: WorkCaptureRouteLogger;
}) {
  const accepted = await beforeDurableAcceptance({
    operation: input.operation,
    commandId: input.command.commandId,
    log: input.log,
    run: async () => {
      const intent = await findPrincipalCaptureIntent(input.userId, input.issueId);
      if (!intent || intent.memberId !== input.memberId) {
        throw new AppError(404, "CAPTURE_INTENT_NOT_FOUND", "Capture intent not found");
      }
      return requestWorkCaptureIntentEffect({
        commandId: input.command.commandId,
        intentId: intent.id,
        epoch: input.command.epoch,
        leaseGeneration: input.command.leaseGeneration,
        kind: input.kind,
        ...(input.ownerKind === "implicit"
          ? { ownerKind: "implicit" as const }
          : {
              ownerId: (input.command as VersionedWorkCaptureCommand & { ownerId: string }).ownerId,
              ownerKind: input.ownerKind,
            }),
      });
    },
  });
  const deliveryStatus = await deliveryStatusAfterAcceptance({
    deliveryKey: accepted.deliveryKey,
    operation: input.operation,
    commandId: input.command.commandId,
    log: input.log,
  });
  const captureIntent = await readCaptureIntentAfterCommit({
    userId: input.userId,
    issueId: input.issueId,
    operation: input.operation,
    commandId: input.command.commandId,
    log: input.log,
  });
  const statusCode: 200 | 202 = deliveryStatus === "acknowledged" ? 200 : 202;
  return {
    statusCode,
    response: {
      ok: true as const,
      commandId: input.command.commandId,
      deliveryStatus,
      captureIntent,
    },
  };
}

/**
 * Work session routes plugin.
 * Registered under /api prefix.
 */
export default async function workSessionRoutes(fastify: FastifyInstance): Promise<void> {
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
        request.log
      );
      const captureIntent = await readCaptureIntentAfterCommit({
        userId: request.user.userId,
        issueId: request.issueId!,
        operation: "start",
        log: request.log,
      });
      return reply.status(201).send({ ...result, captureIntent });
    }
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
    async (request, reply) => {
      const parsed = WorkSessionHeartbeatBody.safeParse(request.body ?? {});
      if (!parsed.success) throw invalidWorkCaptureCommand();

      if ("commandId" in parsed.data) {
        const ownerScoped = "ownerId" in parsed.data;
        if (request.via === "web" && !ownerScoped) throw invalidWorkCaptureCommand();
        const result = await requestDurableCaptureEffect({
          command: parsed.data,
          kind: "activity",
          operation: "heartbeat",
          userId: request.user.userId,
          memberId: request.member!.id,
          issueId: request.issueId!,
          ownerKind: ownerScoped ? (request.via === "web" ? "web" : "mcp") : "implicit",
          log: request.log,
        });
        return reply.status(result.statusCode).send(result.response);
      }

      const session = await workSessionService.heartbeat(
        request.params.key,
        request.member!.id,
        request.user.userId,
        request.via
      );
      if (!session) {
        throw new AppError(404, "SESSION_NOT_FOUND", "No active work session found for this issue");
      }
      return {
        ok: true,
        captureIntent: await readCaptureIntentAfterCommit({
          userId: request.user.userId,
          issueId: request.issueId!,
          operation: "heartbeat",
          log: request.log,
        }),
      };
    }
  );

  for (const kind of ["release", "close"] as const) {
    app.post(
      `/issues/:key/work-captures/${kind}`,
      {
        preHandler: [requireIssueMember("key")],
        schema: {
          params: IssueKeyParam,
          body: VersionedWorkCaptureCommandBody,
          response: {
            200: WorkCaptureEffectResponse,
            202: WorkCaptureEffectResponse,
          },
        },
      },
      async (request, reply) => {
        const command = parseWorkCaptureCommand(request.body);
        const ownerScoped = "ownerId" in command;
        if (request.via === "web" && !ownerScoped) throw invalidWorkCaptureCommand();
        const result = await requestDurableCaptureEffect({
          command,
          kind,
          operation: kind,
          userId: request.user.userId,
          memberId: request.member!.id,
          issueId: request.issueId!,
          ownerKind: ownerScoped ? (request.via === "web" ? "web" : "mcp") : "implicit",
          log: request.log,
        });
        return reply.status(result.statusCode).send(result.response);
      }
    );
  }

  app.get(
    "/me/work-captures",
    {
      schema: {
        querystring: WorkCaptureHydrationQuery,
        response: { 200: WorkCaptureHydrationPage },
      },
    },
    async (request) => {
      const userId = request.user?.userId;
      if (!userId) {
        throw new AppError(401, "UNAUTHENTICATED", "Authentication required");
      }
      const { workspaceId, cursor, limit } = request.query as {
        workspaceId: string;
        cursor?: string;
        limit: number;
      };
      const page = await listPrincipalCaptureIntents({
        userId,
        workspaceId,
        allowedProjectIds: scopedProjectIds(request.user.allowedProjectIds),
        ...(cursor ? { cursor } : {}),
        limit,
      });
      return { principalId: userId, workspaceId, ...page };
    }
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
        request.via
      );
    }
  );

  /**
   * POST /api/issues/:key/interruptions — manually record an Interruption (KAN-103).
   * :key is the incident issue; body.interruptedIssueKey is the displaced issue.
   */
  app.post(
    "/issues/:key/interruptions",
    {
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
        body: RecordInterruptionBody,
      },
    },
    async (request, reply) => {
      const row = await workSessionService.recordInterruption(
        request.params.key,
        request.body.interruptedIssueKey,
        request.member!.id,
        request.body.via
      );
      return reply.status(201).send(row);
    }
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
        throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${request.params.key}" not found`);
      }
      return workSessionService.getActiveWorkers(issue.id);
    }
  );

  /**
   * GET /api/issues/:key/worklogs — list WorkLogs for an issue (S2 / KAN-26)
   * Returns all WorkLog rows for the issue, newest first (by startedAt DESC).
   * Accessible to any workspace member.
   *
   * KAN-86: no explicit allowedProjectIds filter is needed here. The
   * `requireIssueMember` guard resolves the issue's project and runs the KAN-19
   * FIRST-GUARD in `enforceProjectAccess`, which returns 403 when a project-scoped
   * token does not include this issue's project. A single issue belongs to exactly
   * one project, so token scope is fully enforced before the handler runs.
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
        throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${request.params.key}" not found`);
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
    }
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
        workspaceId: string;
        from?: string;
        to?: string;
        limit: number;
      };

      // KAN-82: scope to the caller's own membership IN THIS workspace, so the
      // result never spans other workspaces the user belongs to.
      const members = await prisma.member.findMany({
        where: { userId, workspaceId },
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
      // KAN-86: apply token project-scope (KAN-79 pattern). A project-scoped token
      // must not read worklogs for issues in projects outside its scope, even for
      // the caller's own activity. Unscoped tokens (null) impose no restriction.
      const allowed = scopedProjectIds(request.user.allowedProjectIds);
      if (allowed) {
        logWhere["issue"] = { projectId: { in: allowed } };
      }
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
    }
  );
}
