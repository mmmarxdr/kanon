import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateRoadmapItemBody,
  UpdateRoadmapItemBody,
  RoadmapFilterQuery,
  PromoteBody,
  ProjectKeyParam,
  RoadmapItemIdParam,
  AddDependencyBody,
  DependencyIdParam,
} from "./schema.js";
import * as roadmapService from "./service.js";

/**
 * Roadmap routes plugin.
 * Registered under /api prefix.
 */
export default async function roadmapRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/projects/:key/roadmap
   */
  app.get(
    "/projects/:key/roadmap",
    {
      schema: {
        params: ProjectKeyParam,
        querystring: RoadmapFilterQuery,
      },
    },
    async (request, _reply) => {
      return roadmapService.listRoadmapItems(
        request.params.key,
        request.query,
      );
    },
  );

  /**
   * POST /api/projects/:key/roadmap
   */
  app.post(
    "/projects/:key/roadmap",
    {
      schema: {
        params: ProjectKeyParam,
        body: CreateRoadmapItemBody,
      },
    },
    async (request, reply) => {
      const item = await roadmapService.createRoadmapItem(
        request.params.key,
        request.body,
      );
      return reply.status(201).send(item);
    },
  );

  /**
   * GET /api/projects/:key/roadmap/:id
   */
  app.get(
    "/projects/:key/roadmap/:id",
    {
      schema: {
        params: RoadmapItemIdParam,
      },
    },
    async (request, _reply) => {
      return roadmapService.getRoadmapItem(
        request.params.key,
        request.params.id,
      );
    },
  );

  /**
   * PATCH /api/projects/:key/roadmap/:id
   */
  app.patch(
    "/projects/:key/roadmap/:id",
    {
      schema: {
        params: RoadmapItemIdParam,
        body: UpdateRoadmapItemBody,
      },
    },
    async (request, _reply) => {
      return roadmapService.updateRoadmapItem(
        request.params.key,
        request.params.id,
        request.body,
        request.user.memberId,
      );
    },
  );

  /**
   * DELETE /api/projects/:key/roadmap/:id
   */
  app.delete(
    "/projects/:key/roadmap/:id",
    {
      schema: {
        params: RoadmapItemIdParam,
      },
    },
    async (request, reply) => {
      await roadmapService.deleteRoadmapItem(
        request.params.key,
        request.params.id,
      );
      return reply.status(204).send();
    },
  );

  /**
   * POST /api/projects/:key/roadmap/:id/promote
   */
  app.post(
    "/projects/:key/roadmap/:id/promote",
    {
      schema: {
        params: RoadmapItemIdParam,
        body: PromoteBody,
      },
    },
    async (request, reply) => {
      const issue = await roadmapService.promoteToIssue(
        request.params.key,
        request.params.id,
        request.body,
        request.user.memberId,
      );
      return reply.status(201).send(issue);
    },
  );

  // ─── Dependency routes ──────────────────────────────────────────────────

  /**
   * GET /api/projects/:key/roadmap/:id/dependencies
   */
  app.get(
    "/projects/:key/roadmap/:id/dependencies",
    {
      schema: {
        params: RoadmapItemIdParam,
      },
    },
    async (request, _reply) => {
      return roadmapService.getDependencies(
        request.params.key,
        request.params.id,
      );
    },
  );

  /**
   * POST /api/projects/:key/roadmap/:id/dependencies
   */
  app.post(
    "/projects/:key/roadmap/:id/dependencies",
    {
      schema: {
        params: RoadmapItemIdParam,
        body: AddDependencyBody,
      },
    },
    async (request, reply) => {
      const dep = await roadmapService.addDependency(
        request.params.key,
        request.params.id,
        request.body,
      );
      return reply.status(201).send(dep);
    },
  );

  /**
   * DELETE /api/projects/:key/roadmap/:id/dependencies/:depId
   */
  app.delete(
    "/projects/:key/roadmap/:id/dependencies/:depId",
    {
      schema: {
        params: DependencyIdParam,
      },
    },
    async (request, reply) => {
      await roadmapService.removeDependency(
        request.params.key,
        request.params.id,
        request.params.depId,
      );
      return reply.status(204).send();
    },
  );
}
