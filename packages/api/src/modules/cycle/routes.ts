import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import * as cycleService from "./service.js";
import { requireProjectMember, requireProjectRole, requireCycleMember, requireCycleRole } from "../../middleware/require-role.js";

const ProjectKeyParam = z.object({ key: z.string() });
const CycleIdParam = z.object({ id: z.string().uuid() });

const CreateCycleBody = z.object({
  name: z.string().min(1).max(120),
  goal: z.string().max(500).optional(),
  startDate: z.string().datetime(),
  endDate: z.string().datetime(),
  state: z.enum(["upcoming", "active", "done"]).optional(),
  /**
   * Optional issue keys to attach atomically with cycle creation. Empty
   * array (or omitted) = no attach work, no transaction overhead.
   */
  attachIssueKeys: z.array(z.string()).max(100).optional(),
});

const GetCycleQuery = z.object({
  /** When `"true"`, returns the full scopeEvents array (default: last 20). */
  includeAllScopeEvents: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

const CloseCycleQuery = z.object({
  /** When `"true"`, returns the full updated cycle (legacy shape). */
  verbose: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

const AttachIssuesBody = z.object({
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
  reason: z.string().max(500).optional(),
});

const DeleteCycleBody = z.object({
  force: z.boolean().optional().default(false),
  reason: z.string().min(1).max(500).optional(),
});

// KAN-152 (ADR-0008 #3): explicit re-baseline body — target whole cycle and/or
// an explicit set of issue ids. At least one must be supplied (enforced in the
// service so the error shape is consistent with other validation).
const ReBaselineBody = z.object({
  issueIds: z.array(z.string().uuid()).max(250).optional(),
});

export default async function cycleRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/projects/:key/cycles",
    {
      preHandler: [requireProjectMember("key")],
      schema: { params: ProjectKeyParam },
    },
    async (request, _reply) => cycleService.listCycles(request.projectId!),
  );

  app.post(
    "/projects/:key/cycles",
    {
      preHandler: [requireProjectRole("key", "member")],
      schema: { params: ProjectKeyParam, body: CreateCycleBody },
    },
    async (request, reply) => {
      const created = await cycleService.createCycle(
        request.projectId!,
        {
          name: request.body.name,
          goal: request.body.goal,
          startDate: new Date(request.body.startDate),
          endDate: new Date(request.body.endDate),
          state: request.body.state,
          attachIssueKeys: request.body.attachIssueKeys,
        },
        request.member!.id,
      );
      return reply.status(201).send(created);
    },
  );

  app.get(
    "/cycles/:id",
    {
      preHandler: [requireCycleMember("id")],
      schema: { params: CycleIdParam, querystring: GetCycleQuery },
    },
    async (request, _reply) =>
      cycleService.getCycle(request.params.id, {
        includeAllScopeEvents: request.query.includeAllScopeEvents,
      }),
  );

  app.post(
    "/cycles/:id/close",
    {
      preHandler: [requireCycleRole("id", "member")],
      schema: { params: CycleIdParam, querystring: CloseCycleQuery },
    },
    async (request, _reply) =>
      cycleService.closeCycle(request.params.id, {
        verbose: request.query.verbose,
        actorMemberId: request.member?.id,
      }),
  );

  app.post(
    "/cycles/:id/issues",
    {
      preHandler: [requireCycleRole("id", "member")],
      schema: { params: CycleIdParam, body: AttachIssuesBody },
    },
    async (request, _reply) =>
      cycleService.attachIssues(request.params.id, {
        add: request.body.add,
        remove: request.body.remove,
        reason: request.body.reason,
        authorId: request.member!.id,
      }),
  );

  /**
   * POST /cycles/:id/activate — KAN-152 (ADR-0008 #1).
   * Transition an existing upcoming cycle to active AND snapshot baselines for
   * its issues, atomically. Member+ (lifecycle action, mirrors close/create).
   */
  app.post(
    "/cycles/:id/activate",
    {
      preHandler: [requireCycleRole("id", "member")],
      schema: { params: CycleIdParam },
    },
    async (request, _reply) =>
      cycleService.activateCycle(request.params.id, request.member!.id),
  );

  /**
   * POST /cycles/:id/baseline — KAN-152 (ADR-0008 #3).
   * Explicit, audited re-baseline. OVERWRITES the baseline (the only path that
   * does) and writes an ActivityLog `baseline_set` record per issue. Admin/PM
   * only — re-baselining destroys the original commitment, so it is gated above
   * the member tier used for normal planning.
   */
  app.post(
    "/cycles/:id/baseline",
    {
      preHandler: [requireCycleRole("id", "pm")],
      schema: { params: CycleIdParam, body: ReBaselineBody },
    },
    async (request, _reply) =>
      cycleService.setBaseline({
        cycleId: request.params.id,
        issueIds: request.body.issueIds,
        authorId: request.member!.id,
        via: request.via,
      }),
  );

  app.delete(
    "/cycles/:id",
    {
      preHandler: [requireCycleRole("id", "member")],
      schema: { params: CycleIdParam, body: DeleteCycleBody },
    },
    async (request, reply) => {
      const cycleId = request.params.id;
      const { force, reason } = request.body;
      const result = await cycleService.deleteCycle(cycleId, { force, reason }, request.member!.id);
      request.log.info(
        { cycleId, detachedCount: result.detachedIssueKeys.length, force },
        "cycle deleted",
      );
      return reply.send(result);
    },
  );
}
