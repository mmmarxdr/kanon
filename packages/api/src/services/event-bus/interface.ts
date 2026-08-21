import type { DomainEvent, DomainEventInput } from "./types.js";

/**
 * Event bus interface for domain event pub/sub.
 *
 * Implementations are expected to be in-process (no external deps).
 * The interface exists so we can swap to Redis pub/sub later without
 * changing consumers.
 */
export interface IEventBus {
  /**
   * Emit a domain event. Assigns `id` (monotonic) and `timestamp`.
   * Fire-and-forget — must not throw or block the caller.
   */
  emit(event: DomainEventInput): void;

  /** Deliver a durable event and reject if any current subscriber fails. */
  emitAndWait(event: DomainEventInput): Promise<void>;

  /**
   * Subscribe to ALL domain events.
   * Returns an unsubscribe function.
   *
   * @param handler - Callback invoked for every domain event.
   * @param name    - Optional subscriber name used in error logs (default: handler.name or "anonymous").
   */
  subscribe(handler: (event: DomainEvent) => void, name?: string): () => void;

  /**
   * Subscribe only to events for a specific workspace.
   * Returns an unsubscribe function.
   *
   * @param workspaceId - Only events for this workspace are delivered.
   * @param handler     - Callback invoked for matching domain events.
   * @param name        - Optional subscriber name used in error logs (default: handler.name or "anonymous").
   */
  subscribeToWorkspace(
    workspaceId: string,
    handler: (event: DomainEvent) => void,
    name?: string
  ): () => void;

  /**
   * Retrieve events emitted after a given event ID.
   * Used for SSE `Last-Event-ID` reconnection replay.
   * Returns an empty array if the ID is too old (outside the buffer).
   */
  getEventsSince(lastEventId: number): DomainEvent[];
}
