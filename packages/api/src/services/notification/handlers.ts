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
import { env } from "../../config/env.js";
import type { DomainEvent } from "../event-bus/types.js";
import type { EmailProvider } from "../email/types.js";
import type { NotificationServiceDeps } from "./types.js";
import { buildMentionEmail } from "../email/templates/mention.js";
import { buildAssignmentEmail } from "../email/templates/assignment.js";
import { buildCycleClosedEmail } from "../email/templates/cycle-closed.js";

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

  // S5: email dispatch — detached from handler, never awaited (D3).
  // A DB failure here must NOT reject the handler or lose the notification row.
  if (deps.emailProvider) {
    const provider: EmailProvider = deps.emailProvider;
    const { logger } = deps;

    void (async () => {
      // Batch-load preferences and member email
      const [prefs, memberWithUser] = await Promise.all([
        prisma.notificationPreference.findMany({
          where: { memberId: { in: [recipientId] } },
          select: { memberId: true, emailMention: true, emailAssignment: true, emailCycleClosed: true },
        }),
        prisma.member.findUnique({
          where: { id: recipientId },
          select: { id: true, user: { select: { email: true } } },
        }),
      ]);

      if (memberWithUser?.user?.email && isEmailEnabled(prefs, recipientId, "emailMention")) {
        const actorMember = await prisma.member.findUnique({
          where: { id: event.actorId ?? "" },
          select: { user: { select: { displayName: true, email: true } } },
        });

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

  // S5: email dispatch — detached from handler, never awaited (D3).
  // A DB failure here must NOT reject the handler or lose the notification row.
  if (deps.emailProvider) {
    const provider: EmailProvider = deps.emailProvider;
    const { logger } = deps;

    void (async () => {
      const [prefs, memberWithUser] = await Promise.all([
        prisma.notificationPreference.findMany({
          where: { memberId: { in: [recipientId] } },
          select: { memberId: true, emailMention: true, emailAssignment: true, emailCycleClosed: true },
        }),
        prisma.member.findUnique({
          where: { id: recipientId },
          select: { id: true, user: { select: { email: true } } },
        }),
      ]);

      if (memberWithUser?.user?.email && isEmailEnabled(prefs, recipientId, "emailAssignment")) {
        const actorMember = await prisma.member.findUnique({
          where: { id: event.actorId ?? "" },
          select: { user: { select: { displayName: true } } },
        });

        const msg = buildAssignmentEmail({
          assignedByName: actorMember?.user?.displayName ?? "Someone",
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

// ─── subscribed_activity placeholder ─────────────────────────────────────────

/**
 * Handles subscribed_activity fan-out.
 * Lands fully in S4 — returns early here.
 */
export async function handleSubscribedActivity(
  _event: DomainEvent,
  _deps: NotificationServiceDeps = {},
): Promise<void> {
  // S4 implementation — no-op in S3
  return;
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

  for (const member of members) {
    if (!member.user?.email) continue;
    if (!isEmailEnabled(prefs, member.id, "emailCycleClosed")) continue;

    const email = member.user.email;
    void provider
      .send({ to: email, ...msg })
      .catch((err: unknown) => {
        logger?.error({ err, memberId: member.id }, "cycle-closed email send failed");
      });
  }
}

// ─── Route (event type → handler) ────────────────────────────────────────────

/**
 * Route a domain event to the appropriate handler(s).
 * Returns a promise that resolves when all applicable handlers complete.
 */
export async function routeEvent(
  event: DomainEvent,
  deps: NotificationServiceDeps = {},
): Promise<void> {
  switch (event.type) {
    case "mention.created":
      await handleMentionCreated(event, deps);
      break;
    case "issue.assigned":
      await handleIssueAssigned(event, deps);
      break;
    case "issue.transitioned":
    case "comment.created":
      await handleSubscribedActivity(event, deps);
      break;
    case "cycle.closed":
      await handleCycleClosed(event, deps);
      break;
    default:
      // Unhandled event type — no-op
      break;
  }
}
