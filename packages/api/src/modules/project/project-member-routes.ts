import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  AddProjectMemberBody,
  ChangeProjectMemberRoleBody,
  ProjectMemberParams,
  ProjectKeyParam,
} from "./project-member.schema.js";
import { requireProjectMember, requireProjectRole } from "../../middleware/require-role.js";
import {
  listEffectiveMembers,
  addProjectMember,
  changeProjectMemberRole,
  removeProjectMember,
} from "./project-member-service.js";

/**
 * Project member routes plugin.
 * Registered under /api/projects/:key/members (prefix supplied in app.ts).
 *
 * Gate contract (KAN-16):
 *   GET    → requireProjectMember("key")  — any project member (or ws owner/admin bypass)
 *   POST   → requireProjectRole("key","admin") — project admin or ws owner/admin bypass
 *   PATCH  → requireProjectRole("key","admin")
 *   DELETE → requireProjectRole("key","admin")
 *
 * actingRole = request.projectRole! (always populated by gate — ADR A2)
 * actorUserId = request.member!.userId
 * workspaceId = request.member!.workspaceId
 */
export default async function projectMemberRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/projects/:key/members
   * Returns explicit PM rows UNION ws owner/admin implicit rows.
   */
  app.get(
    "/",
    {
      preHandler: [requireProjectMember("key")],
      schema: {
        params: ProjectKeyParam,
      },
    },
    async (request, reply) => {
      const members = await listEffectiveMembers(
        request.projectId!,
        request.member!.workspaceId,
      );
      return reply.status(200).send({ members });
    },
  );

  /**
   * POST /api/projects/:key/members
   * Add a workspace member to the project.
   */
  app.post(
    "/",
    {
      preHandler: [requireProjectRole("key", "admin")],
      schema: {
        params: ProjectKeyParam,
        body: AddProjectMemberBody,
      },
    },
    async (request, reply) => {
      const result = await addProjectMember(
        request.projectId!,
        request.member!.workspaceId,
        request.body.email,
        request.body.role,
        request.projectRole!,
      );
      return reply.status(201).send(result);
    },
  );

  /**
   * PATCH /api/projects/:key/members/:pmId
   * Change a project member's role.
   */
  app.patch(
    "/:pmId",
    {
      preHandler: [requireProjectRole("key", "admin")],
      schema: {
        params: ProjectMemberParams,
        body: ChangeProjectMemberRoleBody,
      },
    },
    async (request, reply) => {
      const result = await changeProjectMemberRole(
        request.projectId!,
        request.params.pmId,
        request.body.role,
        request.projectRole!,
      );
      return reply.status(200).send(result);
    },
  );

  /**
   * DELETE /api/projects/:key/members/:pmId
   * Remove a project member.
   */
  app.delete(
    "/:pmId",
    {
      preHandler: [requireProjectRole("key", "admin")],
      schema: {
        params: ProjectMemberParams,
      },
    },
    async (_request, reply) => {
      return reply.status(501).send({ message: "Not yet implemented" });
    },
  );
}
