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
});

const AttachIssuesBody = z.object({
  add: z.array(z.string()).optional(),
  remove: z.array(z.string()).optional(),
  reason: z.string().max(500).optional(),
});

export default async function cycleRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/projects/:key/cycles",
    {
      preHandler: [requireProjectMember("key")],
      schema: { params: ProjectKeyParam },
    },
    async (request, _reply) => cycleService.listCycles(request.params.key),
  );

  app.post(
    "/projects/:key/cycles",
    {
      preHandler: [requireProjectRole("key", "member")],
      schema: { params: ProjectKeyParam, body: CreateCycleBody },
    },
    async (request, reply) => {
      const created = await cycleService.createCycle(request.params.key, {
        name: request.body.name,
        goal: request.body.goal,
        startDate: new Date(request.body.startDate),
        endDate: new Date(request.body.endDate),
        state: request.body.state,
      });
      return reply.status(201).send(created);
    },
  );

  app.get(
    "/cycles/:id",
    {
      preHandler: [requireCycleMember("id")],
      schema: { params: CycleIdParam },
    },
    async (request, _reply) => cycleService.getCycle(request.params.id),
  );

  app.post(
    "/cycles/:id/close",
    {
      preHandler: [requireCycleRole("id", "member")],
      schema: { params: CycleIdParam },
    },
    async (request, _reply) => cycleService.closeCycle(request.params.id),
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
}
