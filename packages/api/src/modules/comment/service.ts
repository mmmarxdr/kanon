import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { createActivityLog } from "../activity/service.js";
import { parseAndUpsertMentions, emitMentionEvents } from "../mentions/service.js";
import { eventBus } from "../../services/event-bus/index.js";
import { autoSubscribe } from "../issue-subscription/service.js";
import type { CreateCommentBody } from "./schema.js";
import { captureIntegrationWorkTx, createIntegrationWorkLaneKey } from "../integrations/outbox.js";
import { hasReservedCommentMarker } from "../integrations/providers/redmine/comment-marker.js";

/**
 * Create a comment on an issue and log the activity.
 */
export async function createComment(
  issueKey: string,
  body: CreateCommentBody,
  memberId: string,
  via?: string | null,
  commentCaptureEnabled = env.INTEGRATION_COMMENT_CAPTURE_ENABLED,
) {
  // Note: Issue does NOT have workspaceId directly — it lives in issue.project.workspaceId
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: {
      id: true,
      key: true,
      title: true,
      projectId: true,
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

  const create = {
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
  } satisfies Prisma.CommentCreateArgs;

  const comment = commentCaptureEnabled
    ? await prisma.$transaction(async (transaction) => {
        const candidate = await transaction.integrationProjectBinding.findFirst({
          where: { projectId: issue.projectId, lifecycle: "active", connection: { provider: "redmine", lifecycle: "active" } },
          orderBy: { id: "asc" },
          select: { id: true },
        });
        const [binding] = candidate
          ? await transaction.$queryRaw<Array<{ id: string; connectionId: string; lifecycleEpoch: number; serviceFallbackEnabled: boolean; serviceCredentialId: string | null }>>(Prisma.sql`
              SELECT binding."id", binding."connection_id" AS "connectionId", binding."lifecycle_epoch" AS "lifecycleEpoch"
                   , connection."service_fallback_enabled" AS "serviceFallbackEnabled", connection."service_credential_id" AS "serviceCredentialId"
              FROM "integration_connections" connection
              JOIN "integration_project_bindings" binding ON binding."connection_id" = connection."id"
              WHERE binding."id" = ${candidate.id}::uuid
                AND binding."project_id" = ${issue.projectId}::uuid
                AND binding."lifecycle" = 'active'::"IntegrationLifecycle"
                AND connection."provider" = 'redmine'
                AND connection."lifecycle" = 'active'::"IntegrationLifecycle"
              FOR SHARE OF connection, binding
            `)
          : [];
        const [parentRef, actor] = binding
          ? await Promise.all([
              transaction.externalRef.findFirst({
                where: { bindingId: binding.id, entityType: "issue", entityId: issue.id },
                select: { id: true, externalId: true },
              }),
              transaction.member.findUnique({ where: { id: memberId }, select: { isAgent: true } }),
            ])
          : [null, null];
        const credential = !binding || !actor || (actor.isAgent && (!binding.serviceFallbackEnabled || !binding.serviceCredentialId))
          ? null
          : await transaction.memberIntegrationCredential.findFirst({
              where: {
                connectionId: binding.connectionId,
                lastAuthStatus: "valid",
                revokedAt: null,
                externalUserId: { not: null },
                ...(actor.isAgent ? { id: binding.serviceCredentialId! } : { memberId }),
              },
              select: { id: true, externalUserId: true, lastValidatedAt: true },
            });
        const value = await transaction.comment.create(create);
        await transaction.activityLog.create({
          data: { issueId: issue.id, memberId, action: "commented", details: { commentId: value.id, source: value.source }, via: via ?? null },
        });
        if (binding && parentRef && credential?.externalUserId) {
          const marker = `<!-- kanon-comment:${value.id} -->`;
          const work = await captureIntegrationWorkTx(transaction, {
            bindingId: binding.id,
            entityType: "comment",
            entityId: value.id,
            direction: "outbound",
            operation: "create",
            actorKey: `member:${memberId}`,
            actorKind: actor!.isAgent ? "ai" : "user",
            payload: {
              version: 1,
              body: value.body,
              bodySha256: createHash("sha256").update(value.body).digest("hex"),
              commentUpdatedAt: value.updatedAt.toISOString(),
              issueId: issue.id,
              parentRefId: parentRef.id,
              parentRemoteIssueId: parentRef.externalId,
              bindingEpoch: binding.lifecycleEpoch,
              credentialId: credential.id,
              credentialLastValidatedAt: credential.lastValidatedAt?.toISOString() ?? null,
              credentialRemoteUserId: credential.externalUserId,
            },
            correlationId: value.id,
            authCredentialId: credential.id,
            refId: null,
            marker,
            laneKey: createIntegrationWorkLaneKey(binding.id, "issue", issue.id),
          });
          if (hasReservedCommentMarker(value.body)) {
            await transaction.integrationSyncWork.update({ where: { id: work.id }, data: { state: "ambiguous" } });
            await transaction.integrationConflict.create({
              data: {
                kind: "outbound-create-ambiguity",
                bindingId: binding.id,
                workId: work.id,
                localEvidence: { reason: "reserved-comment-marker" },
                remoteEvidence: {},
              },
            });
          }
        }
        return value;
      })
    : await prisma.comment.create(create);

  // Auto-create activity log for comment
  if (!commentCaptureEnabled) {
    await createActivityLog({
      issueId: issue.id,
      memberId,
      action: "commented",
      details: { commentId: comment.id, source: comment.source },
      via,
    });
  }

  // Auto-subscribe commenter (best-effort, D9)
  void autoSubscribe(issue.id, memberId, "commenter");

  // Parse @mentions BEFORE emitting comment.created so that we can include
  // the mentionedMemberIds in the comment.created payload (Fix 1 / KAN-28).
  // This lets the subscribed_activity handler skip members who already received
  // a kind=mention notification, preventing the cross-event dedup gap.
  //
  // mentionedMemberIds is built from members whose mention.created was actually
  // emitted successfully. If eventBus.emit throws for a member (per-member
  // try/catch), that member is NOT added to the set — so they will still receive
  // subscribed_activity and are not silently dropped (no double-notification gap).
  // This is stricter than using created.map() up-front (which would exclude members
  // even if their mention.created emit failed). Wave 1 scope: per-event, not per-issue-lifetime.
  let mentionedMemberIds: string[] = [];
  try {
    const { created } = await parseAndUpsertMentions({
      workspaceId: issue.project.workspaceId,
      issueId: issue.id,
      commentId: comment.id,
      body: body.body,
      authorMemberId: memberId,
    });
    mentionedMemberIds = emitMentionEvents(created, {
      workspaceId: issue.project.workspaceId,
      actorMemberId: memberId,
      issueId: issue.id,
      issueKey: issue.key,
      issueTitle: issue.title,
      commentId: comment.id,
      via,
    });
  } catch {
    // Mention parsing failure is non-fatal — log silently and continue.
    // mentionedMemberIds stays at whatever was successfully emitted so far.
  }

  // Emit comment.created AFTER mentions so mentionedMemberIds are known.
  // The subscribed_activity handler reads this set and excludes those members
  // (they already receive kind=mention for the same event — D6 dedup rule).
  try {
    eventBus.emit({
      type: "comment.created",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      payload: {
        commentId: comment.id,
        issueId: issue.id,
        issueKey: issue.key,
        mentionedMemberIds,
      },
      via: via ?? null,
    });
  } catch {
    // Fire-and-forget; never break the mutation
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
          title: true,
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
    emitMentionEvents(created, {
      workspaceId: existing.issue.project.workspaceId,
      actorMemberId: memberId,
      issueId: existing.issue.id,
      issueKey: existing.issue.key,
      issueTitle: existing.issue.title,
      commentId,
      via: null, // updateComment has no via param yet (future improvement)
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
