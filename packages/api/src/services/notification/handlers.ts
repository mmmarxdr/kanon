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
import {
  getSubscriberIds,
  buildSubscribedActivityRecipients,
} from "../../modules/issue-subscription/service.js";

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

// ─── subscribed_activity fan-out ─────────────────────────────────────────────

/**
 * Handles subscribed_activity fan-out — S4 / KAN-28.
 *
 * Events: issue.transitioned, comment.created, issue.assigned.
 *
 * For each event:
 *  1. Resolve issueId from the event payload.
 *  2. Fetch all issue subscribers.
 *  3. Exclude actor + members already notified by a specific kind for this event.
 *  4. Write Notification rows (kind=subscribed_activity) for the remaining recipients.
 *
 * The `alreadyNotified` set is built from any specific-kind notification written
 * by a sibling handler in the same routeEvent call (e.g. assignee who already got
 * kind=assignment; mentioned member who got kind=mention).
 */
export async function handleSubscribedActivity(
  event: DomainEvent,
  alreadyNotified: Set<string> = new Set(),
): Promise<void> {
  const payload = event.payload as {
    issueId?: string;
    issueKey?: string;
    issueTitle?: string;
  };

  const issueId = payload.issueId;
  if (!issueId) return;

  const subscriberIds = await getSubscriberIds(issueId);
  const recipients = buildSubscribedActivityRecipients(
    subscriberIds,
    event.actorId,
    alreadyNotified,
  );

  if (recipients.length === 0) return;

  await prisma.notification.createMany({
    data: recipients.map((recipientId) => ({
      kind: "subscribed_activity" as const,
      workspaceId: event.workspaceId,
      recipientId,
      actorId: event.actorId,
      issueId,
      payload: {
        issueKey: payload.issueKey ?? null,
        action: event.type,
      },
      via: event.via ?? null,
      read: false,
    })),
    skipDuplicates: true,
  });
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
 *
 * For events that can trigger BOTH a specific kind AND subscribed_activity,
 * we build an `alreadyNotified` set from the specific-kind handler so the
 * subscribed_activity fan-out skips members who already received a more
 * targeted notification for the same event (D6 dedup rule).
 */
export async function routeEvent(event: DomainEvent): Promise<void> {
  switch (event.type) {
    case "mention.created":
      await handleMentionCreated(event);
      break;

    case "issue.assigned": {
      // Specific kind first — capture who was already notified
      const alreadyNotified = new Set<string>();
      const payload = event.payload as { to?: string | null };
      if (payload.to && payload.to !== event.actorId) {
        await handleIssueAssigned(event);
        alreadyNotified.add(payload.to);
      } else {
        await handleIssueAssigned(event);
      }
      // subscribed_activity fan-out — skip the assignee if they got kind=assignment
      await handleSubscribedActivity(event, alreadyNotified);
      break;
    }

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
