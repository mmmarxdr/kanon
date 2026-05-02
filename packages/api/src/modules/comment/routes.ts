import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { CreateCommentBody, CommentIdParam, IssueKeyParam, UpdateCommentBody } from "./schema.js";
import { requireIssueMember, requireIssueRole } from "../../middleware/require-role.js";
import * as commentService from "./service.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";

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
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        body: CreateCommentBody,
      },
    },
    async (request, reply) => {
      const comment = await commentService.createComment(
        request.params.key,
        request.body,
        request.member!.id,
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
      preHandler: [requireIssueMember("key")],
      schema: {
        params: IssueKeyParam,
      },
    },
    async (request, _reply) => {
      return commentService.listComments(request.params.key);
    },
  );

  /**
   * PATCH /api/comments/:id
   *
   * Update the body of an existing comment.
   * Only the comment's author may edit it.
   * Auth: any authenticated user; service enforces authorship.
   *
   * To resolve member.id from user.id, we fetch the comment first to get the
   * workspaceId, then look up the Member row.
   */
  app.patch(
    "/comments/:id",
    {
      schema: {
        params: CommentIdParam,
        body: UpdateCommentBody,
      },
    },
    async (request, reply) => {
      const { id: commentId } = request.params;
      const { body } = request.body;

      // Resolve the Member context: find comment → workspace → member
      const comment = await prisma.comment.findUnique({
        where: { id: commentId },
        select: { issue: { select: { project: { select: { workspaceId: true } } } } },
      });

      if (!comment) {
        throw new AppError(404, "COMMENT_NOT_FOUND", `Comment "${commentId}" not found`);
      }

      const workspaceId = comment.issue.project.workspaceId;

      const member = await prisma.member.findUnique({
        where: {
          userId_workspaceId: {
            userId: request.user.userId,
            workspaceId,
          },
        },
        select: { id: true },
      });

      if (!member) {
        throw new AppError(403, "FORBIDDEN", "You are not a member of this workspace");
      }

      const updated = await commentService.updateComment(commentId, body, member.id);
      return reply.status(200).send(updated);
    },
  );
}
