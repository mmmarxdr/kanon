import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { CreateCommentBody, IssueKeyParam } from "./schema.js";
import { resolveMemberIdFromIssue } from "../../shared/resolve-member.js";
import * as commentService from "./service.js";

/**
 * Comment routes plugin.
 * Registered under /api prefix.
 */
export default async function commentRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/issues/:key/comments
   */
  app.post(
    "/issues/:key/comments",
    {
      schema: {
        params: IssueKeyParam,
        body: CreateCommentBody,
      },
    },
    async (request, reply) => {
      const memberId = await resolveMemberIdFromIssue(
        request.user.userId,
        request.params.key,
      );
      const comment = await commentService.createComment(
        request.params.key,
        request.body,
        memberId,
      );
      return reply.status(201).send(comment);
    },
  );

  /**
   * GET /api/issues/:key/comments
   */
  app.get(
    "/issues/:key/comments",
    {
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, _reply) => {
      return commentService.listComments(request.params.key);
    },
  );
}
