import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { createActivityLog } from "../activity/service.js";
import { parseAndUpsertMentions } from "../mentions/service.js";
import { eventBus } from "../../services/event-bus/index.js";
import type { CreateCommentBody } from "./schema.js";

/**
 * Create a comment on an issue and log the activity.
 */
export async function createComment(
  issueKey: string,
  body: CreateCommentBody,
  memberId: string,
  via?: string | null,
) {
  // Note: Issue does NOT have workspaceId directly — it lives in issue.project.workspaceId
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: {
      id: true,
      key: true,
      project: { select: { workspaceId: true } },
    },
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
      via: via ?? null,
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
    via,
  });

  // Parse @mentions — best-effort (must not break comment creation)
  // Emit mention.created per genuinely new mention (D1 delta).
  try {
    const { created } = await parseAndUpsertMentions({
      workspaceId: issue.project.workspaceId,
      issueId: issue.id,
      commentId: comment.id,
      body: body.body,
      authorMemberId: memberId,
    });
    for (const entry of created) {
      try {
        eventBus.emit({
          type: "mention.created",
          workspaceId: issue.project.workspaceId,
          actorId: memberId,
          payload: {
            mentionId: entry.mentionId,
            issueId: issue.id,
            issueKey: issue.key,
            commentId: comment.id,
            mentionedMemberId: entry.mentionedMemberId,
            mentionedByMemberId: memberId,
            context: entry.context,
          },
          via: via ?? null,
        });
      } catch {
        // Event emission is fire-and-forget; never break the mutation
      }
    }
  } catch {
    // Mention parsing failure is non-fatal — log silently and continue
  }

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

  // 5. Re-parse mentions — best-effort; emit mention.created for NEW mentions only (delta).
  try {
    const { created } = await parseAndUpsertMentions({
      workspaceId: existing.issue.project.workspaceId,
      issueId: existing.issue.id,
      commentId,
      body,
      authorMemberId: memberId,
    });
    for (const entry of created) {
      try {
        eventBus.emit({
          type: "mention.created",
          workspaceId: existing.issue.project.workspaceId,
          actorId: memberId,
          payload: {
            mentionId: entry.mentionId,
            issueId: existing.issue.id,
            issueKey: existing.issue.key,
            commentId,
            mentionedMemberId: entry.mentionedMemberId,
            mentionedByMemberId: memberId,
            context: entry.context,
          },
          via: null, // updateComment has no via param yet (future improvement)
        });
      } catch {
        // Fire-and-forget
      }
    }
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
