import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  AddMemberBody,
  ChangeMemberRoleBody,
  WorkspaceIdParam,
  WorkspaceMemberParams,
} from "./schema.js";
import * as memberService from "./service.js";
import { requireMember, requireRole } from "../../middleware/require-role.js";

/**
 * Workspace-scoped member management routes plugin.
 * Registered under /api/workspaces/:wid/members
 */
export default async function workspaceMemberRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/workspaces/:wid/members
   * List all members of a workspace. Requires any workspace membership.
   */
  app.get(
    "/",
    {
      preHandler: [requireMember("wid")],
      schema: {
        params: WorkspaceIdParam,
      },
    },
    async (request, _reply) => {
      return memberService.listMembers(request.params.wid);
    },
  );

  /**
   * POST /api/workspaces/:wid/members
   * Add a new member to a workspace. Requires admin+ role.
   */
  app.post(
    "/",
    {
      preHandler: [requireRole("wid", "admin")],
      schema: {
        params: WorkspaceIdParam,
        body: AddMemberBody,
      },
    },
    async (request, reply) => {
      const member = await memberService.addMember(
        request.params.wid,
        request.body.email,
        request.body.role,
        request.member!.role,
      );
      return reply.status(201).send(member);
    },
  );

  /**
   * PATCH /api/workspaces/:wid/members/:mid
   * Change a member's role. Requires admin+ role.
   */
  app.patch(
    "/:mid",
    {
      preHandler: [requireRole("wid", "admin")],
      schema: {
        params: WorkspaceMemberParams,
        body: ChangeMemberRoleBody,
      },
    },
    async (request, _reply) => {
      return memberService.changeMemberRole(
        request.params.wid,
        request.params.mid,
        request.body.role,
        request.member!.role,
      );
    },
  );

  /**
   * DELETE /api/workspaces/:wid/members/:mid
   * Remove a member from a workspace. Requires admin+ role.
   */
  app.delete(
    "/:mid",
    {
      preHandler: [requireRole("wid", "admin")],
      schema: {
        params: WorkspaceMemberParams,
      },
    },
    async (request, reply) => {
      await memberService.removeMember(
        request.params.wid,
        request.params.mid,
        request.member!.userId,
        request.member!.role,
      );
      return reply.status(204).send();
    },
  );
}
