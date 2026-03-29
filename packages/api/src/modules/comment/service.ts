import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { createActivityLog } from "../activity/service.js";
import type { CreateCommentBody } from "./schema.js";

/**
 * Create a comment on an issue and log the activity.
 */
export async function createComment(
  issueKey: string,
  body: CreateCommentBody,
  memberId: string,
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true },
  });
  if (!issue) {
    throw new AppError(
      404,
      "ISSUE_NOT_FOUND",
      `Issue "${issueKey}" not found`,
    );
  }

  const comment = await prisma.comment.create({
    data: {
      body: body.body,
      source: body.source,
      issueId: issue.id,
      authorId: memberId,
    },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  // Auto-create activity log for comment
  await createActivityLog({
    issueId: issue.id,
    memberId,
    action: "commented",
    details: { commentId: comment.id, source: comment.source },
  });

  return comment;
}

/**
 * List comments for an issue, ordered by createdAt ASC.
 */
export async function listComments(issueKey: string) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true },
  });
  if (!issue) {
    throw new AppError(
      404,
      "ISSUE_NOT_FOUND",
      `Issue "${issueKey}" not found`,
    );
  }

  return prisma.comment.findMany({
    where: { issueId: issue.id },
    orderBy: { createdAt: "asc" },
    include: {
      author: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
    },
  });
}
