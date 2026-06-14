import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireIssueRole } from "../../middleware/require-role.js";
import { AppError } from "../../shared/types.js";
import { prisma } from "../../config/prisma.js";
import { IssueKeyParam, UpsertPlanBody, ReviseEstimateBody } from "./schema.js";
import * as scheduleService from "./service.js";

/**
 * Schedule routes plugin — PPM KAN-99.
 * Registered under /api prefix.
 *
 * Role guard decision:
 *   GET  — requireIssueRole("key"): any project member may read the schedule.
 *   PUT  — requireIssueRole("key", "member"): member+ may update plan fields.
 *          Rationale: scheduling is a planning activity; all project members
 *          above viewer can manage their own work plan. Matches the pattern
 *          used for issue transitions (member minimum).
 *   POST — requireIssueRole("key", "member"): member+ may revise estimates.
 *          Same rationale — estimation during analysis is a member activity.
 *          PMs/admins/owners implicitly satisfy the member gate via hierarchy.
 */
export default async function scheduleRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/issues/:key/schedule
   * Returns the IssueSchedule for the issue, or 404 if not yet created.
   * Any project member may view the schedule.
   */
  app.get(
    "/issues/:key/schedule",
    {
      preHandler: [requireIssueRole("key")],
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, reply) => {
      const issueId = request.issueId!;

      const schedule = await scheduleService.getSchedule(issueId);

      if (!schedule) {
        return reply.status(200).send(null);
      }

      return reply.status(200).send(serializeSchedule(schedule));
    },
  );

  /**
   * PUT /api/issues/:key/schedule
   * Upsert plan fields (startDate, dueDate, progress).
   * Member+ required.
   */
  app.put(
    "/issues/:key/schedule",
    {
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        body: UpsertPlanBody,
      },
    },
    async (request, reply) => {
      const schedule = await scheduleService.upsertPlan(
        request.params.key,
        request.body,
        request.member!.id,
        request.via,
      );

      return reply.status(200).send(serializeSchedule(schedule));
    },
  );

  /**
   * POST /api/issues/:key/estimate
   * Revise estimate — atomically appends EstimateRevision and updates
   * IssueSchedule.estimateHours inside a $transaction.
   * Member+ required.
   */
  app.post(
    "/issues/:key/estimate",
    {
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        body: ReviseEstimateBody,
      },
    },
    async (request, reply) => {
      const revision = await scheduleService.reviseEstimate(
        request.params.key,
        request.body,
        request.member!.id,
        request.via,
      );

      return reply.status(201).send(serializeRevision(revision));
    },
  );
}

// ── Serialization helpers ──────────────────────────────────────────────────

/**
 * Serialize an IssueSchedule from Prisma (with Decimal objects) to a plain
 * JSON-safe object. Decimal fields become strings (Decimal convention).
 */
function serializeSchedule(s: {
  issueId: string;
  startDate: Date | null;
  dueDate: Date | null;
  progress: number;
  estimateHours: { toString(): string } | null;
  baselineStart: Date | null;
  baselineEnd: Date | null;
  baselineSetAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    issueId: s.issueId,
    startDate: s.startDate?.toISOString() ?? null,
    dueDate: s.dueDate?.toISOString() ?? null,
    progress: s.progress,
    estimateHours: s.estimateHours?.toString() ?? null,
    baselineStart: s.baselineStart?.toISOString() ?? null,
    baselineEnd: s.baselineEnd?.toISOString() ?? null,
    baselineSetAt: s.baselineSetAt?.toISOString() ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
  };
}

/**
 * Serialize an EstimateRevision from Prisma to a JSON-safe object.
 * hours (Decimal) becomes a string (Decimal convention).
 */
function serializeRevision(r: {
  id: string;
  issueId: string;
  hours: { toString(): string };
  reason: string | null;
  authorId: string;
  via: string | null;
  createdAt: Date;
}) {
  return {
    id: r.id,
    issueId: r.issueId,
    hours: r.hours.toString(),
    reason: r.reason,
    authorId: r.authorId,
    via: r.via,
    createdAt: r.createdAt.toISOString(),
  };
}
