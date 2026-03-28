import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ProfileResponse, UpdateProfileBody } from "./schema.js";
import * as memberService from "./service.js";

/**
 * Member routes plugin.
 * All routes require authentication (handled by auth plugin).
 */
export default async function memberRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/members/me
   * Returns the authenticated user's profile.
   */
  app.get(
    "/me",
    {
      schema: {
        response: { 200: ProfileResponse },
      },
    },
    async (request, _reply) => {
      return memberService.getProfile(request.user.memberId);
    },
  );

  /**
   * PATCH /api/members/me
   * Updates the authenticated user's profile (displayName, avatarUrl).
   */
  app.patch(
    "/me",
    {
      schema: {
        body: UpdateProfileBody,
        response: { 200: ProfileResponse },
      },
    },
    async (request, _reply) => {
      return memberService.updateProfile(
        request.user.memberId,
        request.body,
      );
    },
  );
}
