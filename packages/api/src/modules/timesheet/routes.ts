import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  requireEntryRole,
  requireWorkLogRole,
} from "../../middleware/require-role.js";
import {
  TimeEntryIdParam,
  WorkLogIdParam,
  PromoteWorkLogBody,
  UpdateEntryBody,
  RejectEntryBody,
  CreateAdjustmentBody,
} from "./schema.js";
import * as timesheetService from "./service.js";

/**
 * Timesheet routes plugin — PPM KAN-100.
 * Registered under /api prefix.
 *
 * Role guard strategy:
 *   promote / update / submit / adjust-create:
 *     requireWorkLogRole / requireEntryRole with no minRole (any project member).
 *     Ownership is enforced in the service layer (owner-only invariant).
 *
 *   approve / reject:
 *     requireEntryRole("id", "pm") — PM gate.
 *     ROLE_HIERARCHY: viewer < member < pm < admin < owner.
 *     owner/admin/pm pass; member/viewer get 403.
 *
 * Decimal serialization: call .toFixed(2) DIRECTLY on Prisma.Decimal — never
 * through Number() to avoid floating-point loss.
 */
export default async function timesheetRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/worklogs/:id/promote
   * Promote a WorkLog to a draft TimeEntry (idempotent).
   * Any project member may call this, but only the WorkLog owner succeeds.
   */
  app.post(
    "/worklogs/:id/promote",
    {
      preHandler: [requireWorkLogRole("id")],
      schema: {
        params: WorkLogIdParam,
        body: PromoteWorkLogBody,
      },
    },
    async (request, reply) => {
      const entry = await timesheetService.promoteWorkLog(
        request.params.id,
        request.body,
        request.member!.id,
        request.via,
      );

      return reply.status(201).send(serializeEntry(entry));
    },
  );

  /**
   * PATCH /api/time-entries/:id
   * Update a draft or submitted TimeEntry (owner-only, service guard).
   */
  app.patch(
    "/time-entries/:id",
    {
      preHandler: [requireEntryRole("id")],
      schema: {
        params: TimeEntryIdParam,
        body: UpdateEntryBody,
      },
    },
    async (request, reply) => {
      const entry = await timesheetService.updateEntry(
        request.params.id,
        request.body,
        request.member!.id,
        request.via,
      );

      return reply.status(200).send(serializeEntry(entry));
    },
  );

  /**
   * POST /api/time-entries/:id/submit
   * Transition draft → submitted (owner-only, service guard).
   */
  app.post(
    "/time-entries/:id/submit",
    {
      preHandler: [requireEntryRole("id")],
      schema: {
        params: TimeEntryIdParam,
      },
    },
    async (request, reply) => {
      const entry = await timesheetService.submitEntry(
        request.params.id,
        request.member!.id,
        request.via,
      );

      return reply.status(200).send(serializeEntry(entry));
    },
  );

  /**
   * POST /api/time-entries/:id/approve
   * Approve a submitted TimeEntry — PM gate.
   * Route guard: requireEntryRole("id", "pm") — viewer/member get 403 here.
   * Service also re-checks status (defense-in-depth).
   */
  app.post(
    "/time-entries/:id/approve",
    {
      preHandler: [requireEntryRole("id", "pm")],
      schema: {
        params: TimeEntryIdParam,
      },
    },
    async (request, reply) => {
      const entry = await timesheetService.approveEntry(
        request.params.id,
        request.member!.id,
        request.via,
      );

      return reply.status(200).send(serializeEntry(entry));
    },
  );

  /**
   * POST /api/time-entries/:id/reject
   * Reject a submitted TimeEntry — PM gate.
   */
  app.post(
    "/time-entries/:id/reject",
    {
      preHandler: [requireEntryRole("id", "pm")],
      schema: {
        params: TimeEntryIdParam,
        body: RejectEntryBody,
      },
    },
    async (request, reply) => {
      const entry = await timesheetService.rejectEntry(
        request.params.id,
        request.member!.id,
        request.body,
        request.via,
      );

      return reply.status(200).send(serializeEntry(entry));
    },
  );

  /**
   * POST /api/time-entries/:id/adjust
   * Create an adjustment TimeEntry for an approved entry.
   * Original must be approved; negative hours allowed.
   * Owner-or-any-member may create adjustments (service checks ownership separately).
   */
  app.post(
    "/time-entries/:id/adjust",
    {
      preHandler: [requireEntryRole("id")],
      schema: {
        params: TimeEntryIdParam,
        body: CreateAdjustmentBody,
      },
    },
    async (request, reply) => {
      const entry = await timesheetService.createAdjustment(
        request.params.id,
        request.body,
        request.member!.id,
        request.via,
      );

      return reply.status(201).send(serializeEntry(entry));
    },
  );
}

// ── Serialization helpers ──────────────────────────────────────────────────

/**
 * Serialize a TimeEntry from Prisma (with Decimal objects) to a plain
 * JSON-safe object. Decimal fields become strings (Decimal convention).
 *
 * Decimal convention: call .toFixed(2) DIRECTLY on Prisma.Decimal —
 * NEVER through Number() to avoid floating-point round-trip loss.
 */
function serializeEntry(e: {
  id: string;
  memberId: string;
  issueId: string | null;
  hours: { toFixed(dp: number): string };
  workedOn: Date;
  status: string;
  sourceWorkLogId: string | null;
  adjustsId: string | null;
  costRateSnapshot: { toFixed(dp: number): string } | null;
  billRateSnapshot: { toFixed(dp: number): string } | null;
  via: string | null;
  approvedById: string | null;
  approvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: e.id,
    memberId: e.memberId,
    issueId: e.issueId,
    // Decimal convention: call toFixed(2) directly on Prisma.Decimal (extends decimal.js)
    // — avoids float round-trip via Number() which defeats the purpose of arbitrary precision.
    hours: e.hours.toFixed(2),
    workedOn: e.workedOn.toISOString(),
    status: e.status,
    sourceWorkLogId: e.sourceWorkLogId,
    adjustsId: e.adjustsId,
    costRateSnapshot: e.costRateSnapshot != null ? e.costRateSnapshot.toFixed(2) : null,
    billRateSnapshot: e.billRateSnapshot != null ? e.billRateSnapshot.toFixed(2) : null,
    via: e.via,
    approvedById: e.approvedById,
    approvedAt: e.approvedAt?.toISOString() ?? null,
    createdAt: e.createdAt.toISOString(),
    updatedAt: e.updatedAt.toISOString(),
  };
}
