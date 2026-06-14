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
  | "time-entry.approved"
  | "time-entry.rejected"
  | "worklog.promoted"
  // KAN-101 PPM W2: dependency lifecycle event for forecast trigger (KAN-102).
  // Emitted post-commit fire-and-forget on create + delete.
  | "dependency.changed";

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
   *  Known values: claude-code | cursor | antigravity | web | cli. Null if unknown. */
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
