import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { createActivityLog } from "../activity/service.js";
import { parseAndUpsertMentions } from "../mentions/service.js";
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
 * Update an existing comment's body.
 *
 * - Verifies the comment exists (404 if not).
 * - Verifies the requester is the original author (403 if not).
 * - Persists the new body via prisma.comment.update.
 * - Appends an activityLog row with action "edited".
 * - Calls parseAndUpsertMentions in a best-effort try/catch (same pattern as recordCycleScopeEvent).
 */
export async function updateComment(
  commentId: string,
  body: string,
  memberId: string,
) {
  // 1. Fetch existing comment with issue context
  //    Note: Issue does NOT have workspaceId directly — it's via issue.project.workspaceId
  const existing = await prisma.comment.findUnique({
    where: { id: commentId },
    include: {
      issue: {
        select: {
          id: true,
          key: true,
          project: { select: { workspaceId: true } },
        },
      },
      author: {
        select: {
          id: true,
          username: true,
          user: { select: { email: true } },
        },
      },
    },
  });

  if (!existing) {
    throw new AppError(404, "COMMENT_NOT_FOUND", `Comment "${commentId}" not found`);
  }

  // 2. Authorization — only the comment author may edit
  if (existing.authorId !== memberId) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "Only the comment author can edit this comment",
    );
  }

  // 3. Update the body
  const updated = await prisma.comment.update({
    where: { id: commentId },
    data: { body },
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

  // 4. Activity log — best-effort (same pattern as createComment)
  await prisma.activityLog.create({
    data: {
      action: "edited",
      issueId: existing.issue.id,
      memberId,
      details: { commentId, previousBody: existing.body },
    },
  });

  // 5. Re-parse mentions — best-effort (must not break the update mutation)
  try {
    await parseAndUpsertMentions({
      workspaceId: existing.issue.project.workspaceId,
      issueId: existing.issue.id,
      commentId,
      body,
      authorMemberId: memberId,
    });
  } catch {
    // Mention parsing failure is non-fatal — log silently and continue
  }

  return updated;
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
