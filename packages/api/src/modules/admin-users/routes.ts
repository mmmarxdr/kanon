/**
 * Instance-admin user directory (KAN-224).
 *
 * Prefix: /api/admin/users
 */
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { requireInstanceAdmin } from "../../middleware/require-role.js";
import {
  AddMembershipBody,
  AdminMembershipParam,
  AdminUserIdParam,
  AdminUserListQuery,
  AdminWorkspaceIdParam,
  BulkBody,
  PatchMembershipBody,
  ReplaceProjectsBody,
} from "./schema.js";
import * as adminUsersService from "./service.js";

export default async function adminUsersRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/",
    {
      preHandler: [requireInstanceAdmin()],
      schema: { querystring: AdminUserListQuery },
    },
    async (request, reply) => {
      const result = await adminUsersService.listUsers(request.query);
      return reply.status(200).send(result);
    },
  );

  app.get(
    "/workspaces",
    {
      preHandler: [requireInstanceAdmin()],
    },
    async (_request, reply) => {
      const result = await adminUsersService.listAllWorkspaces();
      return reply.status(200).send(result);
    },
  );

  app.get(
    "/workspaces/:workspaceId/projects",
    {
      preHandler: [requireInstanceAdmin()],
      schema: { params: AdminWorkspaceIdParam },
    },
    async (request, reply) => {
      const result = await adminUsersService.listWorkspaceProjects(
        request.params.workspaceId,
      );
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/bulk",
    {
      preHandler: [requireInstanceAdmin()],
      schema: { body: BulkBody },
    },
    async (request, reply) => {
      const result = await adminUsersService.bulkAction(
        request.body,
        request.user.userId,
      );
      return reply.status(200).send(result);
    },
  );

  app.get(
    "/:userId",
    {
      preHandler: [requireInstanceAdmin()],
      schema: { params: AdminUserIdParam },
    },
    async (request, reply) => {
      const result = await adminUsersService.getUserDetail(request.params.userId);
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/:userId/verify-email",
    {
      preHandler: [requireInstanceAdmin()],
      schema: { params: AdminUserIdParam },
    },
    async (request, reply) => {
      const result = await adminUsersService.verifyUserEmail(request.params.userId);
      return reply.status(200).send(result);
    },
  );

  app.post(
    "/:userId/memberships",
    {
      preHandler: [requireInstanceAdmin()],
      schema: {
        params: AdminUserIdParam,
        body: AddMembershipBody,
      },
    },
    async (request, reply) => {
      const result = await adminUsersService.addMembership(
        request.params.userId,
        request.body,
        request.user.userId,
      );
      return reply.status(201).send(result);
    },
  );

  app.patch(
    "/:userId/memberships/:memberId",
    {
      preHandler: [requireInstanceAdmin()],
      schema: {
        params: AdminMembershipParam,
        body: PatchMembershipBody,
      },
    },
    async (request, reply) => {
      const result = await adminUsersService.patchMembership(
        request.params.userId,
        request.params.memberId,
        request.body,
        request.user.userId,
      );
      return reply.status(200).send(result);
    },
  );

  app.delete(
    "/:userId/memberships/:memberId",
    {
      preHandler: [requireInstanceAdmin()],
      schema: { params: AdminMembershipParam },
    },
    async (request, reply) => {
      const result = await adminUsersService.removeMembership(
        request.params.userId,
        request.params.memberId,
        request.user.userId,
      );
      return reply.status(200).send(result);
    },
  );

  app.put(
    "/:userId/memberships/:memberId/projects",
    {
      preHandler: [requireInstanceAdmin()],
      schema: {
        params: AdminMembershipParam,
        body: ReplaceProjectsBody,
      },
    },
    async (request, reply) => {
      const result = await adminUsersService.replaceMembershipProjects(
        request.params.userId,
        request.params.memberId,
        request.body,
      );
      return reply.status(200).send(result);
    },
  );
}
