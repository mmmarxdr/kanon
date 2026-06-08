/**
 * Per-event notification handlers — S3 / KAN-27
 *
 * Each handler is responsible for:
 *  - Resolving the recipient(s) from the event payload
 *  - Excluding the actor (actor NEVER receives their own notifications)
 *  - Writing Notification row(s) via prisma
 *
 * Design decisions applied:
 *  D3 — per-handler try/catch; errors never propagate to emitter
 *  D5 — cycle.closed: NO in-app row this wave (email-only, locked)
 *  D7 — via read from event.via
 */

import { prisma } from "../../config/prisma.js";
import type { DomainEvent } from "../event-bus/types.js";

// ─── mention.created ─────────────────────────────────────────────────────────

/**
 * Handles `mention.created` event.
 *
 * Payload shape: { mentionId, issueId, issueKey, commentId, mentionedMemberId,
 *                   mentionedByMemberId, context }
 *
 * Recipient: mentionedMemberId — ALWAYS exclude if === actorId.
 * Creates kind=mention Notification row.
 */
export async function handleMentionCreated(event: DomainEvent): Promise<void> {
  const payload = event.payload as {
    mentionId: string;
    issueId: string;
    issueKey: string;
    commentId: string | null;
    mentionedMemberId: string;
    mentionedByMemberId: string;
    context: string;
  };

  const recipientId = payload.mentionedMemberId;

  // Actor exclusion: never notify the person who created the mention
  if (recipientId === event.actorId) return;

  await prisma.notification.create({
    data: {
      kind: "mention",
      workspaceId: event.workspaceId,
      recipientId,
      actorId: event.actorId,
      issueId: payload.issueId,
      mentionId: payload.mentionId,
      commentId: payload.commentId ?? null,
      payload: {
        issueKey: payload.issueKey,
        context: payload.context,
      },
      via: event.via ?? null,
      read: false,
    },
  });
}

// ─── issue.assigned ──────────────────────────────────────────────────────────

/**
 * Handles `issue.assigned` event.
 *
 * Payload shape: { issueKey, issueId, from, to }
 *
 * Recipient: payload.to (new assignee).
 * Skip if: to === null (unassigned), or to === actorId (self-assign).
 * Creates kind=assignment Notification row.
 */
export async function handleIssueAssigned(event: DomainEvent): Promise<void> {
  const payload = event.payload as {
    issueKey: string;
    issueId: string;
    from: string | null;
    to: string | null;
  };

  // No assignment recipient
  if (!payload.to) return;

  // Self-assign: actor assigns to themselves → no notification
  if (payload.to === event.actorId) return;

  await prisma.notification.create({
    data: {
      kind: "assignment",
      workspaceId: event.workspaceId,
      recipientId: payload.to,
      actorId: event.actorId,
      issueId: payload.issueId,
      payload: {
        issueKey: payload.issueKey,
      },
      via: event.via ?? null,
      read: false,
    },
  });
}

// ─── subscribed_activity placeholder ─────────────────────────────────────────

/**
 * Handles subscribed_activity fan-out.
 * Lands fully in S4 — returns early here.
 */
export async function handleSubscribedActivity(
  _event: DomainEvent,
): Promise<void> {
  // S4 implementation — no-op in S3
  return;
}

// ─── cycle.closed ─────────────────────────────────────────────────────────────

/**
 * Handles `cycle.closed` event.
 * D5: Email-only this wave — NO in-app Notification rows.
 * Email dispatch lands in S5.
 */
export async function handleCycleClosed(_event: DomainEvent): Promise<void> {
  // D5 locked: no in-app rows for cycle.closed this wave
  return;
}

// ─── Route (event type → handler) ────────────────────────────────────────────

/**
 * Route a domain event to the appropriate handler(s).
 * Returns a promise that resolves when all applicable handlers complete.
 */
export async function routeEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {
    case "mention.created":
      await handleMentionCreated(event);
      break;
    case "issue.assigned":
      await handleIssueAssigned(event);
      break;
    case "issue.transitioned":
    case "comment.created":
      await handleSubscribedActivity(event);
      break;
    case "cycle.closed":
      await handleCycleClosed(event);
      break;
    default:
      // Unhandled event type — no-op
      break;
  }
}
