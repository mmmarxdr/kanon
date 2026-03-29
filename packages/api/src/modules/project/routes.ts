import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateProjectBody,
  UpdateProjectBody,
  WorkspaceIdParam,
  ProjectKeyParam,
} from "./schema.js";
import * as projectService from "./service.js";
import { requireProjectRole } from "../../middleware/require-role.js";

/**
 * Project routes plugin.
 * Workspace-scoped routes registered under /api/workspaces/:wid/projects
 * Project-keyed routes registered under /api/projects/:key
 */
export default async function projectRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/workspaces/:wid/projects
   */
  app.post(
    "/workspaces/:wid/projects",
    {
      schema: {
        params: WorkspaceIdParam,
        body: CreateProjectBody,
      },
    },
    async (request, reply) => {
      const project = await projectService.createProject(
        request.params.wid,
        request.body,
      );
      return reply.status(201).send(project);
    },
  );

  /**
   * GET /api/workspaces/:wid/projects
   */
  app.get(
    "/workspaces/:wid/projects",
    {
      schema: {
        params: WorkspaceIdParam,
      },
    },
    async (request, _reply) => {
      return projectService.listProjects(request.params.wid);
    },
  );

  /**
   * GET /api/projects/:key
   */
  app.get(
    "/projects/:key",
    {
      schema: {
        params: ProjectKeyParam,
      },
    },
    async (request, _reply) => {
      return projectService.getProject(request.params.key);
    },
  );

  /**
   * PATCH /api/projects/:key
   */
  app.patch(
    "/projects/:key",
    {
      schema: {
        params: ProjectKeyParam,
        body: UpdateProjectBody,
      },
    },
    async (request, _reply) => {
      return projectService.updateProject(request.params.key, request.body);
    },
  );

  /**
   * DELETE /api/projects/:key (soft delete)
   */
  app.delete(
    "/projects/:key",
    {
      preHandler: [requireProjectRole("key", "owner")],
      schema: {
        params: ProjectKeyParam,
      },
    },
    async (request, _reply) => {
      return projectService.archiveProject(request.params.key);
    },
  );
}
