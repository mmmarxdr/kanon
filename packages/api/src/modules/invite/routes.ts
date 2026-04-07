import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  CreateInviteBody,
  InviteResponse,
  InviteListResponse,
  InviteMetadataResponse,
  InviteTokenParam,
  WorkspaceIdParam,
  WorkspaceInviteParams,
} from "./schema.js";
import * as inviteService from "./service.js";
import { requireRole } from "../../middleware/require-role.js";

/**
 * Workspace-scoped invite management routes plugin.
 * Registered under /api/workspaces/:wid/invites
 */
export async function workspaceInviteRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/workspaces/:wid/invites
   * Create a new invite link. Requires admin+ role.
   */
  app.post(
    "/",
    {
      preHandler: [requireRole("wid", "admin")],
      schema: {
        params: WorkspaceIdParam,
        body: CreateInviteBody,
        response: { 201: InviteResponse },
      },
    },
    async (request, reply) => {
      const invite = await inviteService.createInvite(
        request.params.wid,
        request.user.userId,
        request.body,
      );
      return reply.status(201).send(invite);
    },
  );

  /**
   * GET /api/workspaces/:wid/invites
   * List all invites for a workspace. Requires admin+ role.
   */
  app.get(
    "/",
    {
      preHandler: [requireRole("wid", "admin")],
      schema: {
        params: WorkspaceIdParam,
        response: { 200: InviteListResponse },
      },
    },
    async (request, _reply) => {
      return inviteService.listInvites(request.params.wid);
    },
  );

  /**
   * DELETE /api/workspaces/:wid/invites/:inviteId
   * Revoke an invite. Requires admin+ role.
   */
  app.delete(
    "/:inviteId",
    {
      preHandler: [requireRole("wid", "admin")],
      schema: {
        params: WorkspaceInviteParams,
        response: { 200: InviteResponse },
      },
    },
    async (request, _reply) => {
      return inviteService.revokeInvite(
        request.params.inviteId,
        request.params.wid,
        request.user.userId,
      );
    },
  );
}

/**
 * Public invite routes plugin.
 * Registered under /api/invites
 *
 * GET /:token — public (no auth), returns invite metadata.
 * POST /:token/accept — requires auth but NOT workspace membership.
 */
export async function publicInviteRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/invites/:token
   * Get invite metadata (public — no auth required).
   * Auth is skipped via PUBLIC_PREFIXES in auth plugin.
   */
  app.get(
    "/:token",
    {
      schema: {
        params: InviteTokenParam,
        response: { 200: InviteMetadataResponse },
      },
    },
    async (request, _reply) => {
      return inviteService.getInviteMetadata(request.params.token);
    },
  );

  /**
   * POST /api/invites/:token/accept
   * Accept an invite. Requires auth (JWT) but NOT workspace membership.
   * Auth is enforced by the global auth hook (this path is not in PUBLIC_PREFIXES
   * because only /api/invites/ GET routes are public — POST routes still need auth).
   */
  app.post(
    "/:token/accept",
    {
      schema: {
        params: InviteTokenParam,
      },
    },
    async (request, reply) => {
      const member = await inviteService.acceptInvite(
        request.params.token,
        request.user.userId,
        request.user.email,
      );
      return reply.status(201).send(member);
    },
  );
}
