/**
 * IssueSubscription service — S4 / KAN-28
 *
 * Provides subscribe, unsubscribe, getStatus, and auto-subscribe helpers.
 * Also exports the recipient-set algebra helper used by the notification
 * handlers to compute subscribed_activity recipients.
 *
 * Design decisions applied:
 *  D9 — unsubscribe = DELETE row; auto-subscribe uses upsert (idempotent)
 *  D3 — auto-subscribe errors are swallowed (never block the mutation)
 */

import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";

// ─── Explicit subscribe / unsubscribe ────────────────────────────────────────

/**
 * Subscribe the member to the issue.
 * Idempotent: if the subscription already exists, the call is a no-op.
 * Returns the canonical subscription row.
 */
export async function subscribe(
  issueId: string,
  memberId: string,
): Promise<{ subscribed: true }> {
  await prisma.issueSubscription.upsert({
    where: { issueId_memberId: { issueId, memberId } },
    create: { issueId, memberId, origin: "manual" },
    // Do not downgrade origin on re-subscribe
    update: {},
  });
  return { subscribed: true };
}

/**
 * Unsubscribe the member from the issue.
 * Idempotent: if no subscription exists, the call is a no-op.
 * Returns the canonical status.
 */
export async function unsubscribe(
  issueId: string,
  memberId: string,
): Promise<{ subscribed: false }> {
  await prisma.issueSubscription.deleteMany({
    where: { issueId, memberId },
  });
  return { subscribed: false };
}

/**
 * Return whether the member is currently subscribed to the issue.
 */
export async function getStatus(
  issueId: string,
  memberId: string,
): Promise<{ subscribed: boolean }> {
  const existing = await prisma.issueSubscription.findUnique({
    where: { issueId_memberId: { issueId, memberId } },
    select: { id: true },
  });
  return { subscribed: existing !== null };
}

// ─── Auto-subscribe helper ────────────────────────────────────────────────────

/**
 * Auto-subscribe origin values.
 */
export type AutoSubscribeOrigin = "creator" | "assignee" | "commenter";

/**
 * Auto-subscribe a member to an issue.
 * Uses upsert — never creates duplicates, never downgrades origin.
 * Errors are swallowed (D3): auto-subscribe is best-effort and must
 * never interrupt the originating mutation.
 */
export async function autoSubscribe(
  issueId: string,
  memberId: string,
  origin: AutoSubscribeOrigin,
): Promise<void> {
  try {
    await prisma.issueSubscription.upsert({
      where: { issueId_memberId: { issueId, memberId } },
      create: { issueId, memberId, origin },
      // Do not overwrite an existing origin (creator > commenter hierarchy)
      update: {},
    });
  } catch {
    // Best-effort: never interrupt the originating mutation
  }
}

// ─── Recipient-set algebra ────────────────────────────────────────────────────

/**
 * Given the full subscriber set for an issue, compute the set of members who
 * should receive a subscribed_activity notification for a given event.
 *
 * Rules:
 *  1. Exclude the actor (they triggered the event).
 *  2. Exclude members already covered by a specific notification kind for this
 *     same event (e.g. assignee got kind=assignment; mentioned member got
 *     kind=mention). A specific kind wins over the generic subscribed_activity.
 *
 * @param subscriberIds     - All subscriber memberIds for the issue.
 * @param actorId           - The memberId who triggered the event.
 * @param alreadyNotified   - Set of memberIds already notified by a specific kind.
 * @returns                   Filtered array of memberIds to notify.
 */
export function buildSubscribedActivityRecipients(
  subscriberIds: string[],
  actorId: string,
  alreadyNotified: Set<string>,
): string[] {
  return subscriberIds.filter(
    (id) => id !== actorId && !alreadyNotified.has(id),
  );
}

// ─── Issue subscription lookup (used by notification handlers) ────────────────

/**
 * Return all subscriber memberIds for a given issue.
 * Used by the subscribed_activity fan-out handler.
 */
export async function getSubscriberIds(issueId: string): Promise<string[]> {
  const subs = await prisma.issueSubscription.findMany({
    where: { issueId },
    select: { memberId: true },
  });
  return subs.map((s) => s.memberId);
}
