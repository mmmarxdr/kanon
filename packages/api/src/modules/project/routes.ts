import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateProjectBody,
  UpdateProjectBody,
  WorkspaceIdParam,
  ProjectKeyParam,
} from "./schema.js";
import * as projectService from "./service.js";
import { requireMember, requireProjectMember, requireProjectRole, requireRole } from "../../middleware/require-role.js";
import { scopedProjectIds } from "../../shared/token-scope.js";

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
      preHandler: [requireRole("wid", "member")],
      schema: {
        params: WorkspaceIdParam,
        body: CreateProjectBody,
      },
    },
    async (request, reply) => {
      const project = await projectService.createProject(
        request.params.wid,
        request.body,
        request.member?.id,
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
      preHandler: [requireMember("wid")],
      schema: {
        params: WorkspaceIdParam,
      },
    },
    async (request, _reply) => {
      // KAN-222: list equals openable set; KAN-79: token scope still intersects.
      const member = request.member!;
      return projectService.listProjects(request.params.wid, {
        role: member.role,
        projectAccess: member.projectAccess,
        userId: request.user.userId,
        allowedProjectIds: scopedProjectIds(request.user.allowedProjectIds),
      });
    },
  );

  /**
   * GET /api/projects/:key
   */
  app.get(
    "/projects/:key",
    {
      preHandler: [requireProjectMember("key")],
      schema: {
        params: ProjectKeyParam,
      },
    },
    async (request, _reply) => {
      return projectService.getProject(request.projectId!);
    },
  );

  /**
   * PATCH /api/projects/:key
   */
  app.patch(
    "/projects/:key",
    {
      preHandler: [requireProjectRole("key", "admin")],
      schema: {
        params: ProjectKeyParam,
        body: UpdateProjectBody,
      },
    },
    async (request, _reply) => {
      return projectService.updateProject(request.projectId!, request.body, request.member?.id);
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
      return projectService.archiveProject(request.projectId!, request.member?.id);
    },
  );
}
