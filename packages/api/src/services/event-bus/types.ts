// ─── Domain Event Types ────────────────────────────────────────────────────

/**
 * All domain event types emitted by the system.
 * Dot-separated: `{entity}.{action}`.
 */
export type DomainEventType =
  | "issue.created"
  | "issue.updated"
  | "issue.transitioned"
  | "issue.assigned"
  | "project.created"
  | "project.updated"
  | "project.archived"
  | "member.added"
  | "member.removed"
  | "member.role_changed"
  | "work_session.started"
  // work_session.ended payload carries `reason: "stopped" | "expired"` —
  // "stopped" = explicit user-driven stopWork; "expired" = cleanupExpired
  // (S2 / KAN-26) closed the session. Downstream listeners (forecast,
  // telemetry) key off this field to distinguish stop from crash/expiry.
  | "work_session.ended"
  | "invite.created"
  | "invite.revoked"
  | "invite.accepted"
  | "cycle.deleted" // KAN-23: hard-delete cycle event; payload: { cycleId: string; projectId: string }
  // S1 / KAN-30: new event types for capture-and-notify
  | "comment.created"
  | "mention.created"
  | "cycle.closed"
  // S4 / KAN-28: emitted by batchTransitionByKeys for grouped subscribed_activity fan-out.
  // Carries `issues: [{id, key}]` so the handler can write per-issue issueKey on each
  // notification row without an extra DB round-trip. Per-issue issue.transitioned events
  // are still emitted for SSE consumers but carry _skipSubscribedActivity=true to prevent
  // double fan-out.
  | "issue.batch_transitioned"
  // KAN-40: notification lifecycle events for live inbox SSE propagation.
  // Payloads are BARE ({}) — no recipient identity or content fields.
  | "notification.created"
  | "notification.marked_read"
  // KAN-99/100 PPM W1: schedule and timesheet lifecycle events.
  // Emitted post-commit in try/catch (fire-and-forget); emissions wired in PR2/PR3.
  | "estimate.revised"
  | "schedule.updated"
  // KAN-147 (ADR-0007): project working-day calendar changed. Project-level
  // (no issue) — payload carries projectId directly so the forecast listener
  // can rebuild without an issue→project resolution step.
  | "schedule-config.updated"
  | "time-entry.approved"
  | "time-entry.rejected"
  // worklog.promoted removed KAN-102 (dead event — never emitted anywhere)
  // KAN-102: emitted from work-session/service.ts when WorkLog is created
  | "worklog.created"
  // KAN-101 PPM W2: dependency lifecycle event for forecast trigger (KAN-102).
  // Emitted post-commit fire-and-forget on create + delete.
  | "dependency.changed"
  // KAN-103 PR3: forecast trigger when an incident opens/closes an interruption.
  | "interruption.opened"
  | "interruption.closed"
  // KAN-102: seam for PPM P2 rollup-listener
  | "ppm.forecast.updated";

/**
 * Payload shape for the `issue.transitioned` event.
 * KAN-156: enriched with actor identity so the work-session transition listener
 * can open/close sessions without an extra member lookup in the common path.
 */
export interface IssueTransitionedPayload {
  issueKey: string;
  issueId: string;
  projectKey: string;
  from: string;
  to: string;
  /**
   * Member ID of the actor who performed the transition (KAN-156).
   * Null when the member row cannot be resolved at emit time (deleted member).
   */
  actorMemberId: string | null;
  /**
   * User ID of the actor who performed the transition (KAN-156).
   * Null when the member row cannot be resolved at emit time (deleted member).
   */
  actorUserId: string | null;
  /**
   * Optional cause tag for circular-guard detection.
   * When set to "start_work", the work-session listener skips this event
   * to avoid the KAN-143 feedback loop (start_work → auto-advance → re-open session).
   * The cause IS wired: startWork → transitionIssue already threads cause="start_work"
   * through the payload; the guard here is defense-in-depth against any future
   * path that calls transitionIssue without setting cause.
   */
  cause?: string;
}

/**
 * A typed domain event emitted after a successful mutation.
 *
 * `id` is a monotonic sequence number assigned by the EventBus,
 * used as the SSE `id:` field for `Last-Event-ID` reconnection.
 */
export interface DomainEvent<T = Record<string, unknown>> {
  /** Monotonic sequence number assigned by the EventBus */
  id: number;
  /** Event type — determines the shape of `payload` */
  type: DomainEventType;
  /** Workspace the event belongs to (used for scoped SSE streams) */
  workspaceId: string;
  /** Member ID of the actor who triggered the mutation */
  actorId: string;
  /** Event-specific data */
  payload: T;
  /** ISO-8601 timestamp when the event was created */
  timestamp: string;
  /** Normalized X-Kanon-Client value that originated the mutation (S1 / KAN-30).
   *  Known values: claude-code | cursor | codex | antigravity | web | cli. Null if unknown. */
  via?: string | null;
}

/**
 * Input to `IEventBus.emit()` — the caller provides everything
 * except `id` and `timestamp`, which the bus assigns.
 */
export type DomainEventInput<T = Record<string, unknown>> = Omit<
  DomainEvent<T>,
  "id" | "timestamp"
>;
