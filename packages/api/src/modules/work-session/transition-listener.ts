/**
 * Work-session transition listener — KAN-156 Slice 1.
 *
 * Subscribes to `issue.transitioned` domain events and manages WorkSession
 * lifecycle based on the issue state machine:
 *
 *   - First entry into active-work state (analysis | in_progress) where `from`
 *     was NOT already an active-work state → open a session for the actor member.
 *   - Transition to close state (review | done) → close the open session.
 *   - review → in_progress (rework) → covered by the open rule (from=review is
 *     not active-work, to=in_progress is active).
 *   - Idempotent: startWork upserts so re-entering an open state is safe;
 *     stopWork returns ok:true/deleted:false when none open (no-op).
 *
 * Fire-and-forget: a session failure MUST NEVER break the transition emitter.
 * Lifecycle effects are serialized per issue so an older transition cannot
 * finish after a newer close/rework signal and mutate the wrong generation.
 *
 * KAN-143 circular guard SEAM: if the event carries `cause: "start_work"`,
 * the listener skips it to avoid the loop where start_work auto-advances the
 * issue state, which would re-trigger this listener.
 * TODO(KAN-143): once start_work emits cause on the transition event, this seam
 * will activate automatically — no further change needed here.
 */

import { prisma } from "../../config/prisma.js";
import {
  captureTransitionClose,
  captureTransitionInterval,
  drainTransitionLifecycleEffects,
  stageTransitionStart,
  startWork,
  stopWork,
  TRANSITION_EFFECT_RECOVERY_INTERVAL_MS,
} from "./service.js";
import type { IEventBus } from "../../services/event-bus/interface.js";
import type { DomainEvent, IssueTransitionedPayload } from "../../services/event-bus/types.js";

// ─── Logger interface (minimal — compatible with pino and console) ─────────

export interface TransitionListenerLogger {
  error(obj: unknown, msg?: string): void;
}

// ─── State classification ──────────────────────────────────────────────────

/** States where active work is happening — a session should be open. */
const ACTIVE_WORK_STATES = new Set(["analysis", "in_progress"]);

/** States that close an active work window — stop the session. */
const CLOSE_STATES = new Set(["review", "done"]);

function isActiveWork(state: string): boolean {
  return ACTIVE_WORK_STATES.has(state);
}

function isCloseState(state: string): boolean {
  return CLOSE_STATES.has(state);
}

// ─── Main export ──────────────────────────────────────────────────────────

/**
 * Register the work-session transition listener on the event bus.
 *
 * Subscribes to all domain events and reacts only to `issue.transitioned`
 * with the right state classification. All session operations are
 * fire-and-forget: errors are caught and logged but never propagate.
 *
 * @param bus    - The application EventBus instance.
 * @param logger - Optional logger (pino-compatible). Defaults to console.
 * @returns unsubscribe function — call in app onClose hook to detach.
 */
export function registerTransitionListener(
  bus: IEventBus,
  logger: TransitionListenerLogger = console
): () => void {
  // Active flag guards the race where handleEvent awaits a DB lookup and
  // tries to act after unsubscribe() has already been called.
  let active = true;
  const issueQueues = new Map<string, Promise<void>>();
  const pendingTransitions = new Map<string, DomainEvent[]>();

  const recoverEffects = () => {
    void drainTransitionLifecycleEffects().catch((err: unknown) => {
      logger.error(
        { err },
        "transition-listener: lifecycle effect recovery failed",
      );
    });
  };
  recoverEffects();
  const effectRecoveryTimer = setInterval(
    recoverEffects,
    TRANSITION_EFFECT_RECOVERY_INTERVAL_MS,
  );
  effectRecoveryTimer.unref();

  function queuedCloseBoundary(
    queueKey: string,
    currentEvent: DomainEvent,
  ): Date | null {
    const pending = pendingTransitions.get(queueKey) ?? [];
    const currentIndex = pending.indexOf(currentEvent);
    if (currentIndex < 0) return null;

    for (const candidate of pending.slice(currentIndex + 1)) {
      if (candidate.type !== "issue.transitioned") continue;
      const payload = candidate.payload as unknown as IssueTransitionedPayload;
      const toIsActive = isActiveWork(payload.to);
      const fromIsActive = isActiveWork(payload.from);
      if (isCloseState(payload.to) || (fromIsActive && !toIsActive)) {
        return new Date(candidate.timestamp);
      }
    }

    return null;
  }

  async function handleEvent(event: DomainEvent): Promise<void> {
    if (!active) return;
    if (event.type !== "issue.transitioned") return;

    const p = event.payload as unknown as IssueTransitionedPayload;

    // ── KAN-143 circular guard seam ──────────────────────────────────────
    // If the transition was caused by start_work itself, skip to avoid loop.
    // TODO(KAN-143): this seam activates automatically once KAN-143 emits
    // cause="start_work" on the auto-advance transition event.
    if (p.cause === "start_work") return;

    // ── Guard: actorMemberId required ─────────────────────────────────────
    // Pre-enrichment events (before KAN-156 deploy) lack actorMemberId.
    // Skip them safely — no actor means no session attribution.
    if (!p.actorMemberId) return;

    // actorMemberId is non-null here — the guard above returned if falsy.
    const actorMemberId: string = p.actorMemberId;
    const { from, to, issueKey } = p;
    const queueKey = p.issueId || issueKey;

    // ── Determine action ──────────────────────────────────────────────────
    const toIsActive = isActiveWork(to);
    const fromIsActive = isActiveWork(from);
    const shouldClose = isCloseState(to) || (fromIsActive && !toIsActive);

    if (toIsActive && !fromIsActive) {
      // First entry into active-work: open a session for the actor.
      // We need userId for startWork. Prefer actorUserId from payload (fast
      // path); fall back to a member DB lookup if absent (pre-enrichment events).
      let userId = p.actorUserId;
      if (!userId) {
        const member = await prisma.member.findUnique({
          where: { id: actorMemberId },
          select: { userId: true },
        });
        if (!member) return; // member deleted between emit and handler
        userId = member.userId;
      }

      if (!active) return; // re-check after await

      const activeSignalAt = new Date(event.timestamp);
      // Persist the stable start identity BEFORE any live-session decision.
      // This is the cross-process ordering primitive: an earlier close can
      // already be waiting in the database, and an exact completed replay is
      // detected here without creating a WorkSession or any marker WorkLog.
      const staged = await stageTransitionStart(
        issueKey,
        userId,
        actorMemberId,
        activeSignalAt,
        "transition-listener",
      );
      if (!active || staged.lifecycle.completed) return;

      const currentIssue = await prisma.issue.findUnique({
        where: { key: issueKey },
        select: { id: true, state: true },
      });
      if (!currentIssue || !active) return;

      const queuedCloseAt = queuedCloseBoundary(queueKey, event);
      if (queuedCloseAt) {
        await captureTransitionInterval(
          issueKey,
          userId,
          actorMemberId,
          activeSignalAt,
          queuedCloseAt,
          "transition-listener",
        );
        return;
      }

      // The event is authoritative evidence that work began even if delivery
      // lag means the database has already advanced to review/done. Defer that
      // historical start until its ordered close event so no live session is
      // created on a currently closed issue.
      if (!isActiveWork(currentIssue.state)) {
        return;
      }

      // autoAssign:false — a state transition must not assign the actor (KAN-156).
      // onConflict:skip — KAN-160: if another member already works the issue, do
      // NOT open a second session and do NOT throw (the transition must succeed).
      await startWork(issueKey, actorMemberId, userId, "transition-listener", null, undefined, {
        autoAssign: false,
        onConflict: "skip",
        transitionObservedAt: activeSignalAt,
        transitionLifecycleIdentity:
          staged.lifecycle.startIdentity ?? undefined,
      });

      // A close can arrive while startWork is awaiting its locked transaction.
      // Re-check the ordered queue before deciding the active signal is unbounded.
      const closeAfterOpen = queuedCloseBoundary(queueKey, event);
      if (closeAfterOpen) {
        await captureTransitionInterval(
          issueKey,
          userId,
          actorMemberId,
          activeSignalAt,
          closeAfterOpen,
          "transition-listener",
        );
        return;
      }

      // An ownership conflict leaves the durable start open for a later
      // authoritative close. No marker WorkLog is needed.
      return;
    }

    if (shouldClose) {
      // BUG-4 fix: close ALL open WorkSessions for the issue, not just the actor's.
      // The work phase is ending regardless of who performed the transition —
      // a PM/third party closing the issue must stop any worker's open session.
      // Look up the issue to get its id, then find all open sessions.
      const issueRow = await prisma.issue.findUnique({
        where: { key: issueKey },
        select: { id: true, state: true },
      });
      if (!issueRow) return; // issue deleted between emit and handler

      if (!active) return; // re-check after await

      await captureTransitionClose(
        issueKey,
        new Date(event.timestamp),
        "transition-listener",
      );

      if (!active) return; // re-check after durable close capture

      const openSessions = await prisma.workSession.findMany({
        // Close every remaining window, including an expired lease that cleanup
        // has not finalized yet. stopWork applies the same lease cap for both.
        where: { issueId: issueRow.id },
        select: { id: true, userId: true, memberId: true },
      });

      if (!active) return; // re-check after await

      // Fire-and-forget each stopWork; errors per session are caught individually
      // so one failure does not block the others.
      const observedAt = new Date(event.timestamp);
      for (const session of openSessions) {
        if (!active) break;
        await stopWork(
          issueKey,
          session.userId,
          session.memberId,
          null,
          observedAt,
          session.id,
        ).catch((err: unknown) => {
          logger.error(
            { err, issueKey, sessionId: session.id },
            "transition-listener: stopWork failed for session"
          );
        });
      }
      return;
    }

    // All other transitions (e.g. backlog → todo) are ignored.
  }

  // ── Subscribe — single handler for all domain events ──────────────────
  const unsubscribeBus = bus.subscribe((event) => {
    if (event.type !== "issue.transitioned") return;

    const payload = event.payload as unknown as IssueTransitionedPayload;
    const queueKey = payload.issueId || payload.issueKey;
    const pending = pendingTransitions.get(queueKey) ?? [];
    pending.push(event);
    pendingTransitions.set(queueKey, pending);
    const previous = issueQueues.get(queueKey) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(() => handleEvent(event));
    issueQueues.set(queueKey, next);

    void next
      .catch((err: unknown) => {
        logger.error(
          { err, eventType: event.type, eventId: event.id },
          "transition-listener event handler failed"
        );
      })
      .finally(() => {
        const remaining = pendingTransitions.get(queueKey);
        if (remaining) {
          const index = remaining.indexOf(event);
          if (index >= 0) remaining.splice(index, 1);
          if (remaining.length === 0) pendingTransitions.delete(queueKey);
        }
        if (issueQueues.get(queueKey) === next) issueQueues.delete(queueKey);
      });
  }, "work-session-transition-listener");

  // ── Return unsubscribe ────────────────────────────────────────────────
  return function unsubscribe(): void {
    active = false;
    clearInterval(effectRecoveryTimer);
    unsubscribeBus();
  };
}
