/**
 * IssueSubscription service — S4 / KAN-28
 *
 * Provides subscribe, unsubscribe, getStatus, and auto-subscribe helpers.
 * Also exports the recipient-set algebra helper used by the notification
 * handlers to compute subscribed_activity recipients.
 *
 * Design decisions applied:
 *  D9 — unsubscribe = upsert with optedOut=true (row persisted, not deleted),
 *        so a never-subscribed member who explicitly unsubscribes stays suppressed.
 *        Explicit PUT (subscribe) always sets optedOut=false.
 *  D9a — autoSubscribe uses upsert with update:{} so it NEVER overrides an
 *        existing optedOut=true row (the update is a no-op on existing rows).
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
    create: { issueId, memberId, origin: "manual", optedOut: false },
    // Explicit re-subscribe always clears optedOut (even if previously opted out).
    // Origin is not downgraded (creator > commenter hierarchy).
    update: { optedOut: false },
  });
  return { subscribed: true };
}

/**
 * Unsubscribe the member from the issue.
 * Idempotent: uses upsert to persist optedOut=true so a never-subscribed
 * member who explicitly unsubscribes remains suppressed even if later
 * autoSubscribe triggers fire (D9 / D9a).
 * Returns the canonical status.
 */
export async function unsubscribe(
  issueId: string,
  memberId: string,
): Promise<{ subscribed: false }> {
  await prisma.issueSubscription.upsert({
    where: { issueId_memberId: { issueId, memberId } },
    create: { issueId, memberId, origin: "manual", optedOut: true },
    update: { optedOut: true },
  });
  return { subscribed: false };
}

/**
 * Return whether the member is currently subscribed to the issue.
 * Subscribed = row exists AND optedOut === false.
 */
export async function getStatus(
  issueId: string,
  memberId: string,
): Promise<{ subscribed: boolean }> {
  const existing = await prisma.issueSubscription.findUnique({
    where: { issueId_memberId: { issueId, memberId } },
    select: { optedOut: true },
  });
  return { subscribed: existing !== null && !existing.optedOut };
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
  } catch (err) {
    // Best-effort: never interrupt the originating mutation (Fix 6 / KAN-28)
    console.error("autoSubscribe failed (non-fatal):", err);
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
 * Return all active subscriber memberIds for a given issue.
 * Filters optedOut=false — opted-out rows are excluded from fan-out.
 * Used by the subscribed_activity fan-out handler.
 */
export async function getSubscriberIds(issueId: string): Promise<string[]> {
  const subs = await prisma.issueSubscription.findMany({
    where: { issueId, optedOut: false },
    select: { memberId: true },
  });
  return subs.map((s) => s.memberId);
}
