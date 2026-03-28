import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateWorkspaceBody,
  UpdateWorkspaceBody,
  WorkspaceIdParam,
} from "./schema.js";
import * as workspaceService from "./service.js";
import { requireRole } from "../../middleware/require-role.js";

/**
 * Workspace routes plugin.
 * Registered under /api/workspaces
 */
export default async function workspaceRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/workspaces
   */
  app.post(
    "/",
    {
      schema: {
        body: CreateWorkspaceBody,
      },
    },
    async (request, reply) => {
      const workspace = await workspaceService.createWorkspace(request.body);
      return reply.status(201).send(workspace);
    },
  );

  /**
   * GET /api/workspaces
   */
  app.get("/", async (request, _reply) => {
    return workspaceService.listWorkspaces(request.user.memberId);
  });

  /**
   * PATCH /api/workspaces/:id
   */
  app.patch(
    "/:id",
    {
      preHandler: [requireRole("owner", "admin")],
      schema: {
        params: WorkspaceIdParam,
        body: UpdateWorkspaceBody,
      },
    },
    async (request, _reply) => {
      return workspaceService.updateWorkspace(request.params.id, request.body);
    },
  );
}
