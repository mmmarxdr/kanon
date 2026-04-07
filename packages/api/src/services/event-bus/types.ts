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
  | "invite.accepted";

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
}

/**
 * Input to `IEventBus.emit()` — the caller provides everything
 * except `id` and `timestamp`, which the bus assigns.
 */
export type DomainEventInput<T = Record<string, unknown>> = Omit<
  DomainEvent<T>,
  "id" | "timestamp"
>;
