/**
 * Per-event notification handlers — S3 / KAN-27, updated S5 / KAN-29
 *
 * Each handler is responsible for:
 *  - Resolving the recipient(s) from the event payload
 *  - Excluding the actor (actor NEVER receives their own notifications)
 *  - Writing Notification row(s) via prisma
 *  - (S5) Dispatching email via provider — fire-and-forget, never awaited (D3)
 *
 * Design decisions applied:
 *  D3 — per-handler try/catch; errors never propagate to emitter
 *  D5 — cycle.closed: NO in-app row this wave (email-only, locked)
 *  D7 — via read from event.via
 */

import { prisma } from "../../config/prisma.js";
import type { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import type { DomainEvent } from "../event-bus/types.js";
import { eventBus } from "../event-bus/index.js";
import type { EmailProvider } from "../email/types.js";
import type { NotificationServiceDeps } from "./types.js";
import { buildMentionEmail } from "../email/templates/mention.js";
import { buildAssignmentEmail } from "../email/templates/assignment.js";
import { buildCycleClosedEmail } from "../email/templates/cycle-closed.js";
import {
  getSubscriberIds,
  getSubscribersByIssues,
  buildSubscribedActivityRecipients,
} from "../../modules/issue-subscription/service.js";

// ─── App URL (email links) ────────────────────────────────────────────────────
// Use the validated env module (defaults to http://localhost:5173) — consistent
// with the rest of the codebase.

const APP_URL = env.APP_URL;

// ─── Preference gating helpers ────────────────────────────────────────────────

type PrefRow = {
  memberId: string;
  emailMention: boolean;
  emailAssignment: boolean;
  emailCycleClosed: boolean;
};

/**
 * Check if a member's email preference flag is enabled.
 * When no pref row exists → default ON (returns true).
 */
function isEmailEnabled(
  prefs: PrefRow[],
  memberId: string,
  field: keyof Omit<PrefRow, "memberId">,
): boolean {
  const pref = prefs.find((p) => p.memberId === memberId);
  if (!pref) return true; // absent row = default ON
  return pref[field];
}

// ─── mention.created ─────────────────────────────────────────────────────────

/**
 * Handles `mention.created` event.
 *
 * Payload shape: { mentionId, issueId, issueKey, issueTitle, commentId,
 *                   mentionedMemberId, mentionedByMemberId, context }
 *
 * Recipient: mentionedMemberId — ALWAYS exclude if === actorId.
 * Creates kind=mention Notification row.
 * S5: dispatches mention email via provider — detached, never awaited (D3).
 */
export async function handleMentionCreated(
  event: DomainEvent,
  deps: NotificationServiceDeps = {},
): Promise<void> {
  const payload = event.payload as {
    mentionId: string;
    issueId: string;
    issueKey: string;
    issueTitle?: string;
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

  // KAN-40: emit notification.created after successful DB write — fire-and-forget (D3).
  // Bare payload: no recipientId or content (privacy contract).
  try {
    eventBus.emit({ type: "notification.created", workspaceId: event.workspaceId, actorId: event.actorId, payload: {} });
  } catch { /* D3 — bus error must never fail the DB write */ }

  // S5: email dispatch — detached from handler, never awaited (D3).
  // A DB failure here must NOT reject the handler or lose the notification row.
  if (deps.emailProvider) {
    const provider: EmailProvider = deps.emailProvider;
    const { logger } = deps;

    void (async () => {
      // Batch-load preferences, recipient email, and actor display name in parallel
      // to avoid sequential round-trips (actor lookup moved here from inside the gate).
      const [prefs, memberWithUser, actorMember] = await Promise.all([
        prisma.notificationPreference.findMany({
          where: { memberId: { in: [recipientId] } },
          select: { memberId: true, emailMention: true, emailAssignment: true, emailCycleClosed: true },
        }),
        prisma.member.findUnique({
          where: { id: recipientId },
          select: { id: true, user: { select: { email: true } } },
        }),
        // Actor lookup: skip when actorId is null/undefined (system events) to avoid
        // a guaranteed-miss query with id:"" — fall back to "Someone" in the template.
        event.actorId
          ? prisma.member.findUnique({
              where: { id: event.actorId },
              select: { user: { select: { displayName: true } } },
            })
          : Promise.resolve(null),
      ]);

      if (memberWithUser?.user?.email && isEmailEnabled(prefs, recipientId, "emailMention")) {

        const msg = buildMentionEmail({
          mentionedByName: actorMember?.user?.displayName ?? "Someone",
          issueKey: payload.issueKey,
          // Use payload.issueTitle when available — falls back to key for safety (R1)
          issueTitle: payload.issueTitle ?? payload.issueKey,
          context: payload.context,
          issueUrl: `${APP_URL}/issue/${encodeURIComponent(payload.issueKey)}`,
          appUrl: APP_URL,
        });

        await provider
          .send({ to: memberWithUser.user.email, ...msg })
          .catch((err: unknown) => {
            logger?.error({ err, recipientId }, "mention email send failed");
          });
      }
    })().catch((err: unknown) => {
      logger?.error({ err, recipientId }, "mention email dispatch failed");
    });
  }
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
 * S5: dispatches assignment email via provider (fire-and-forget).
 */
export async function handleIssueAssigned(
  event: DomainEvent,
  deps: NotificationServiceDeps = {},
): Promise<void> {
  const payload = event.payload as {
    issueKey: string;
    issueId: string;
    from: string | null;
    to: string | null;
    issueTitle?: string;
  };

  // No assignment recipient
  if (!payload.to) return;

  // Self-assign: actor assigns to themselves → no notification
  if (payload.to === event.actorId) return;

  const recipientId = payload.to;

  await prisma.notification.create({
    data: {
      kind: "assignment",
      workspaceId: event.workspaceId,
      recipientId,
      actorId: event.actorId,
      issueId: payload.issueId,
      payload: {
        issueKey: payload.issueKey,
      },
      via: event.via ?? null,
      read: false,
    },
  });

  // KAN-40: emit notification.created after successful DB write — fire-and-forget (D3).
  try {
    eventBus.emit({ type: "notification.created", workspaceId: event.workspaceId, actorId: event.actorId, payload: {} });
  } catch { /* D3 */ }

  // S5: email dispatch — detached from handler, never awaited (D3).
  // A DB failure here must NOT reject the handler or lose the notification row.
  if (deps.emailProvider) {
    const provider: EmailProvider = deps.emailProvider;
    const { logger } = deps;

    void (async () => {
      // Batch-load preferences, recipient email, and actor display name in parallel
      // to avoid sequential round-trips (actor lookup moved here from inside the gate).
      const [prefs, memberWithUser, actorMember] = await Promise.all([
        prisma.notificationPreference.findMany({
          where: { memberId: { in: [recipientId] } },
          select: { memberId: true, emailMention: true, emailAssignment: true, emailCycleClosed: true },
        }),
        prisma.member.findUnique({
          where: { id: recipientId },
          select: { id: true, user: { select: { email: true } } },
        }),
        // Actor lookup: skip when actorId is null/undefined (system events) to avoid
        // a guaranteed-miss query with id:"" — fall back to "Someone" in the template.
        event.actorId
          ? prisma.member.findUnique({
              where: { id: event.actorId },
              select: { user: { select: { displayName: true } } },
            })
          : Promise.resolve(null),
      ]);

      if (memberWithUser?.user?.email && isEmailEnabled(prefs, recipientId, "emailAssignment")) {
        const msg = buildAssignmentEmail({
          assignedByName: actorMember?.user?.displayName ?? "Someone", // actorMember pre-fetched in parallel above
          issueKey: payload.issueKey,
          issueTitle: payload.issueTitle ?? payload.issueKey,
          issueUrl: `${APP_URL}/issue/${encodeURIComponent(payload.issueKey)}`,
          appUrl: APP_URL,
        });

        await provider
          .send({ to: memberWithUser.user.email, ...msg })
          .catch((err: unknown) => {
            logger?.error({ err, recipientId }, "assignment email send failed");
          });
      }
    })().catch((err: unknown) => {
      logger?.error({ err, recipientId }, "assignment email dispatch failed");
    });
  }
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

  // In-process dedup is handled by the alreadyNotified set passed in from routeEvent.
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
  });

  // KAN-40: ONE notification.created per createMany batch — fire-and-forget (D3).
  try {
    eventBus.emit({ type: "notification.created", workspaceId: event.workspaceId, actorId: event.actorId, payload: {} });
  } catch { /* D3 */ }
}

// ─── cycle.closed ─────────────────────────────────────────────────────────────

/**
 * Handles `cycle.closed` event.
 * D5: Email-only this wave — NO in-app Notification rows.
 * S5: Resolves project members → filters by emailCycleClosed pref → sends email.
 * Actor is INCLUDED in recipients (D5 locked: all opted-in project members).
 *
 * Payload shape: { cycleId, cycleName, projectId, projectKey, projectName,
 *                   workspaceId, velocity, completed, planned, scopeAdded, scopeRemoved }
 */
export async function handleCycleClosed(
  event: DomainEvent,
  deps: NotificationServiceDeps = {},
): Promise<void> {
  // D5 locked: no in-app rows for cycle.closed this wave
  if (!deps.emailProvider) return;

  const provider: EmailProvider = deps.emailProvider;
  const { logger } = deps;

  const payload = event.payload as {
    cycleId: string;
    cycleName: string;
    projectId: string;
    projectKey: string;
    projectName: string;
    workspaceId: string;
    velocity: number;
    completed: number;
    planned: number;
    scopeAdded: number;
    scopeRemoved: number;
  };

  // S5: email dispatch — detached from handler, never awaited (D3 / fix-1).
  // DB failures here must NOT reject the handler promise.
  void (async () => {
    // Resolve all project members
    const projectMembers = await prisma.projectMember.findMany({
      where: { projectId: payload.projectId },
      select: { userId: true },
    });

    if (projectMembers.length === 0) return;

    const userIds = projectMembers.map((pm) => pm.userId);

    // Resolve workspace members from userIds
    const members = await prisma.member.findMany({
      where: {
        userId: { in: userIds },
        workspaceId: payload.workspaceId,
      },
      select: { id: true, user: { select: { email: true } } },
    });

    if (members.length === 0) return;

    const memberIds = members.map((m) => m.id);

    // Batch-load preferences
    const prefs = await prisma.notificationPreference.findMany({
      where: { memberId: { in: memberIds } },
      select: { memberId: true, emailMention: true, emailAssignment: true, emailCycleClosed: true },
    });

    const msg = buildCycleClosedEmail({
      cycleName: payload.cycleName,
      projectName: payload.projectName,
      projectKey: payload.projectKey,
      velocity: payload.velocity,
      completed: payload.completed,
      planned: payload.planned,
      scopeAdded: payload.scopeAdded,
      scopeRemoved: payload.scopeRemoved,
      appUrl: APP_URL,
    });

    // Filter opted-in recipients, then send in sequential chunks of 10 (fix-2).
    // Promise.allSettled ensures one rejection does not abort the rest of a chunk.
    const recipients = members.filter(
      (m) => m.user?.email && isEmailEnabled(prefs, m.id, "emailCycleClosed"),
    );

    const CHUNK_SIZE = 10;
    for (let i = 0; i < recipients.length; i += CHUNK_SIZE) {
      const chunk = recipients.slice(i, i + CHUNK_SIZE);
      const results = await Promise.allSettled(
        chunk.map((member) =>
          provider.send({ to: member.user!.email!, ...msg }),
        ),
      );
      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result && result.status === "rejected") {
          logger?.error(
            { err: result.reason, memberId: chunk[j]?.id },
            "cycle-closed email send failed",
          );
        }
      }
    }
  })().catch((err: unknown) => {
    logger?.error({ err }, "cycle-closed email dispatch failed");
  });
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
export async function routeEvent(
  event: DomainEvent,
  deps: NotificationServiceDeps = {},
): Promise<void> {
  const { logger } = deps;
  switch (event.type) {
    case "mention.created":
      await handleMentionCreated(event, deps);
      break;

    case "issue.assigned": {
      // Per-handler isolation: handleIssueAssigned runs in its own try/catch so
      // a DB failure there never suppresses the subscribed_activity fan-out.
      // payload.to is only added to alreadyNotified if the assignment write succeeded.
      const alreadyNotified = new Set<string>();
      const payload = event.payload as { to?: string | null };
      try {
        await handleIssueAssigned(event, deps);
        // Add to alreadyNotified only on success — if write failed, subscriber
        // may still receive subscribed_activity (the specific-kind won't be there).
        if (payload.to && payload.to !== event.actorId) {
          alreadyNotified.add(payload.to);
        }
      } catch (err) {
        // Log but do NOT re-throw — subscribed_activity fan-out MUST still run.
        logger?.error(
          { err, eventType: event.type, eventId: event.id },
          "handleIssueAssigned failed; continuing with subscribed_activity fan-out",
        );
      }
      // subscribed_activity fan-out — always runs regardless of assignment handler result
      await handleSubscribedActivity(event, alreadyNotified);
      break;
    }

    case "issue.transitioned": {
      // Skip subscribed_activity fan-out for per-issue events emitted by batchTransitionByKeys.
      // Those events carry _skipSubscribedActivity=true because the grouped fan-out is handled
      // by the single issue.batch_transitioned event (Fix 3 / KAN-28 — N+1 guard).
      const tPayload = event.payload as { _skipSubscribedActivity?: boolean };
      if (!tPayload._skipSubscribedActivity) {
        await handleSubscribedActivity(event);
      }
      break;
    }

    case "issue.batch_transitioned": {
      // Grouped subscribed_activity fan-out for batch transitions (Fix 3 / KAN-28).
      // ONE findMany across all issueIds + ONE createMany instead of N per-issue round-trips.
      // Actor exclusion and optedOut filtering are preserved via getSubscribersByIssues.
      const batchPayload = event.payload as {
        issues?: Array<{ id: string; key: string }>;
        to?: string;
      };
      const issues = batchPayload.issues ?? [];
      if (issues.length === 0) break;

      const issueIds = issues.map((i) => i.id);
      // Build id→key map so each notification row carries the correct per-issue key,
      // matching the single-transition handler shape (payload.issueKey). Without this
      // map every batched notification would be written with issueKey=null (KAN-28 bug).
      const keyById = new Map(issues.map((i) => [i.id, i.key]));

      const subscribersByIssue = await getSubscribersByIssues(issueIds);

      // Build de-duplicated notification rows: one per (recipient, issue) pair,
      // excluding actor. A subscriber watching multiple issues in the batch receives
      // one notification per issue (not collapsed) so each activity is traceable.
      const rows: Array<{
        kind: "subscribed_activity";
        workspaceId: string;
        recipientId: string;
        actorId: string;
        issueId: string;
        payload: Prisma.InputJsonValue;
        via: string | null;
        read: boolean;
      }> = [];

      for (const issueId of issueIds) {
        const subscribers = subscribersByIssue.get(issueId) ?? new Set();
        for (const recipientId of subscribers) {
          if (recipientId === event.actorId) continue; // actor exclusion
          rows.push({
            kind: "subscribed_activity",
            workspaceId: event.workspaceId,
            recipientId,
            actorId: event.actorId,
            issueId,
            payload: {
              issueKey: keyById.get(issueId) ?? null,
              action: "issue.transitioned",
            },
            via: event.via ?? null,
            read: false,
          });
        }
      }

      if (rows.length > 0) {
        await prisma.notification.createMany({ data: rows });
        // KAN-40: ONE notification.created for the whole batch — fire-and-forget (D3).
        try {
          eventBus.emit({ type: "notification.created", workspaceId: event.workspaceId, actorId: event.actorId, payload: {} });
        } catch { /* D3 */ }
      }
      break;
    }

    case "comment.created": {
      // Build alreadyNotified from mentionedMemberIds so subscribers who received
      // kind=mention for this comment are NOT also sent subscribed_activity
      // (specific kind wins — D6 cross-event dedup rule, Fix 1 / KAN-28).
      const commentPayload = event.payload as { mentionedMemberIds?: string[] };
      const alreadyNotifiedByMention = new Set<string>(
        commentPayload.mentionedMemberIds ?? [],
      );
      await handleSubscribedActivity(event, alreadyNotifiedByMention);
      break;
    }

    case "cycle.closed":
      await handleCycleClosed(event, deps);
      break;

    default:
      // issue.updated and issue.created are deliberately not fan-out events in wave 1
      // (product decision 2026-06-08).
      break;
  }
}
