import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireProjectRole, requireMilestoneRole } from "../../middleware/require-role.js";
import {
  ProjectKeyParam,
  MilestoneIdParam,
  MilestoneDeliverableParams,
  CreateMilestoneBody,
  UpdateMilestoneBody,
  AttachDeliverableBody,
} from "./schema.js";
import * as milestoneService from "./service.js";

export default async function milestoneRoutes(fastify: FastifyInstance): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/projects/:key/milestones
   * Create a new milestone for a project.
   * Requires pm role minimum (write gate).
   */
  app.post(
    "/projects/:key/milestones",
    {
      preHandler: [requireProjectRole("key", "pm")],
      schema: {
        params: ProjectKeyParam,
        body: CreateMilestoneBody,
      },
    },
    async (request, reply) => {
      const milestone = await milestoneService.createMilestone(
        request.projectId!,
        request.body,
        request.member!.id,
        request.member!.workspaceId,
      );
      return reply.status(201).send(milestone);
    },
  );

  /**
   * GET /api/projects/:key/milestones
   * List all milestones for a project, with deliverables.
   * Requires viewer role minimum (any member).
   */
  app.get(
    "/projects/:key/milestones",
    {
      preHandler: [requireProjectRole("key", "viewer")],
      schema: {
        params: ProjectKeyParam,
      },
    },
    async (request, _reply) => {
      return milestoneService.listMilestones(request.projectId!);
    },
  );

  /**
   * PATCH /api/milestones/:id
   * Update a milestone (name, target, status, metOn, ownerId).
   * metOn is settable manually (v1 — no auto-stamp).
   * Requires pm role minimum (write gate via requireMilestoneRole).
   */
  app.patch(
    "/milestones/:id",
    {
      preHandler: [requireMilestoneRole("id", "pm")],
      schema: {
        params: MilestoneIdParam,
        body: UpdateMilestoneBody,
      },
    },
    async (request, _reply) => {
      return milestoneService.updateMilestone(
        request.params.id,
        request.body,
        request.member!.workspaceId,
      );
    },
  );

  /**
   * POST /api/milestones/:id/deliverables
   * Attach an issue to a milestone.
   * Guards: issue must belong to the milestone's project (service: 422).
   * Duplicate prevented by @@unique (service: 409).
   * Requires pm role minimum.
   */
  app.post(
    "/milestones/:id/deliverables",
    {
      preHandler: [requireMilestoneRole("id", "pm")],
      schema: {
        params: MilestoneIdParam,
        body: AttachDeliverableBody,
      },
    },
    async (request, reply) => {
      const deliverable = await milestoneService.attachDeliverable(
        request.params.id,
        request.body.issueKey,
        request.member!.id,
        request.projectId,
      );
      return reply.status(201).send(deliverable);
    },
  );

  /**
   * DELETE /api/milestones/:id/deliverables/:issueId
   * Detach an issue from a milestone (remove the deliverable row).
   * Guards: deliverable row must exist (service: 404).
   * Requires pm role minimum.
   */
  app.delete(
    "/milestones/:id/deliverables/:issueId",
    {
      preHandler: [requireMilestoneRole("id", "pm")],
      schema: {
        params: MilestoneDeliverableParams,
      },
    },
    async (request, _reply) => {
      return milestoneService.detachDeliverable(request.params.id, request.params.issueId);
    },
  );
}
