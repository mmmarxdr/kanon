import { EventEmitter } from "events";
import type { IEventBus } from "./interface.js";
import type { DomainEvent, DomainEventInput } from "./types.js";

/** Maximum number of events kept in the replay buffer. */
const REPLAY_BUFFER_SIZE = 1000;

/**
 * Minimal logger interface — compatible with pino and console.
 * Kept local to this module; not part of IEventBus to avoid interface churn.
 */
export interface BusLogger {
  error(obj: unknown, msg?: string): void;
}

type DeliveryResult =
  | { ok: true }
  | { ok: false; error: unknown };

const DELIVERED: DeliveryResult = { ok: true };

/**
 * In-process event bus backed by Node.js EventEmitter.
 *
 * - Assigns monotonic sequence IDs to each event.
 * - Maintains a circular replay buffer for SSE reconnection.
 * - All emissions are synchronous and fire-and-forget.
 * - Per-subscriber isolation: a throwing or rejecting handler is caught and
 *   logged individually, so later subscribers always receive the event.
 */
export class InProcessEventBus implements IEventBus {
  private readonly emitter = new EventEmitter();
  private sequenceCounter = 0;
  private readonly replayBuffer: DomainEvent[] = [];

  /**
   * Logger used for subscriber error reporting.
   * Defaults to console so the singleton is safe before Fastify is wired.
   * Call setLogger(fastify.log) in app.ts after the app is created.
   */
  private logger: BusLogger = console;

  /** Count of subscriber errors observed — cheap observability hook. */
  private subscriberErrorCount = 0;

  constructor() {
    // Allow many SSE clients without warnings
    this.emitter.setMaxListeners(0);
  }

  /**
   * Replace the default console logger with an application logger (e.g. pino).
   * Call this once during app bootstrap, right after building Fastify.
   */
  setLogger(logger: BusLogger): void {
    this.logger = logger;
  }

  /**
   * Number of subscriber errors caught since this instance was created.
   * Useful as a lightweight health/observability counter.
   */
  getSubscriberErrorCount(): number {
    return this.subscriberErrorCount;
  }

  // ─── IEventBus ─────────────────────────────────────────────────────────

  emit(input: DomainEventInput): void {
    const event = this.prepareEvent(input);

    // Fire to subscribers — per-subscriber isolation is applied at registration
    // time (see subscribe / subscribeToWorkspace). This outer guard is a last
    // resort; errors here indicate a bug in the wrapping logic itself.
    try {
      this.emitter.emit("domain_event", event);
    } catch (err) {
      this.logger.error(
        { err, eventType: event.type, eventId: event.id },
        "event-bus unhandled emit error",
      );
    }
  }

  /**
   * Deliver an event and wait for every current subscriber to settle.
   *
   * Normal domain mutations use `emit()` and remain fire-and-forget. Durable
   * outbox publishers use this acknowledgement-aware path so an async handler
   * rejection leaves the database effect pending for a later retry.
   */
  async emitAndWait(input: DomainEventInput): Promise<void> {
    const event = this.prepareEvent(input);
    const listeners = this.emitter.listeners("domain_event") as Array<
      (event: DomainEvent) => DeliveryResult | Promise<DeliveryResult>
    >;
    const results = await Promise.all(
      listeners.map((listener) => Promise.resolve(listener(event))),
    );
    const failures = results.filter(
      (result): result is Extract<DeliveryResult, { ok: false }> => !result.ok,
    );
    if (failures.length > 0) {
      throw new AggregateError(
        failures.map((failure) => failure.error),
        "event-bus subscriber delivery failed",
      );
    }
  }

  subscribe(
    handler: (event: DomainEvent) => void,
    name?: string,
  ): () => void {
    const subscriberName = name || handler.name || "anonymous";
    const safeHandler = this.wrapHandler(handler, subscriberName);
    this.emitter.on("domain_event", safeHandler);
    return () => {
      this.emitter.off("domain_event", safeHandler);
    };
  }

  subscribeToWorkspace(
    workspaceId: string,
    handler: (event: DomainEvent) => void,
    name?: string,
  ): () => void {
    const subscriberName = name || handler.name || "anonymous";
    const safeHandler = this.wrapHandler(handler, subscriberName);

    // Workspace filter is the outer function so unsubscribe can off() the
    // exact registered reference. The filter comparison is inside its own
    // guard: a malformed event (unsafe cast at an emit site) must not abort
    // the emitter loop for later listeners.
    const filtered = (
      event: DomainEvent,
    ): DeliveryResult | Promise<DeliveryResult> => {
      try {
        if (event.workspaceId !== workspaceId) return DELIVERED;
      } catch (err) {
        this.logSubscriberError(subscriberName, event, err);
        return { ok: false, error: err };
      }
      return safeHandler(event);
    };

    this.emitter.on("domain_event", filtered);
    return () => {
      this.emitter.off("domain_event", filtered);
    };
  }

  getEventsSince(lastEventId: number): DomainEvent[] {
    // Find the first event after the given ID
    const index = this.replayBuffer.findIndex((e) => e.id > lastEventId);
    if (index === -1) return [];
    return this.replayBuffer.slice(index);
  }

  // ─── Private helpers ────────────────────────────────────────────────────

  private prepareEvent(input: DomainEventInput): DomainEvent {
    const event: DomainEvent = {
      ...input,
      id: ++this.sequenceCounter,
      timestamp: new Date().toISOString(),
    };
    this.replayBuffer.push(event);
    if (this.replayBuffer.length > REPLAY_BUFFER_SIZE) {
      this.replayBuffer.shift();
    }
    return event;
  }

  /**
   * Wraps a subscriber handler so that:
   * - Synchronous throws are caught and logged.
   * - Async rejects are caught on the microtask queue and logged.
   * Neither path re-throws, so the EventEmitter loop continues to the next
   * registered listener.
   */
  private wrapHandler(
    handler: (event: DomainEvent) => void,
    name: string,
  ): (event: DomainEvent) => DeliveryResult | Promise<DeliveryResult> {
    return (event: DomainEvent): DeliveryResult | Promise<DeliveryResult> => {
      try {
        const result = handler(event) as unknown;
        // Thenable check (not instanceof Promise): a subscriber returning a
        // PrismaPromise or other custom thenable must also have its rejection
        // caught. Promise.resolve() normalizes any thenable to a real Promise.
        if (
          result != null &&
          typeof (result as { then?: unknown }).then === "function"
        ) {
          return Promise.resolve(result).then(
            () => DELIVERED,
            (err: unknown) => {
              this.logSubscriberError(name, event, err);
              return { ok: false, error: err };
            },
          );
        }
        return DELIVERED;
      } catch (err) {
        this.logSubscriberError(name, event, err);
        return { ok: false, error: err };
      }
    };
  }

  /**
   * Log a subscriber error with structured context and increment the error counter.
   */
  private logSubscriberError(
    subscriber: string,
    event: DomainEvent,
    err: unknown,
  ): void {
    this.subscriberErrorCount++;
    this.logger.error(
      {
        err,
        subscriber,
        eventType: event.type,
        eventId: event.id,
        workspaceId: event.workspaceId,
      },
      "event-bus subscriber error",
    );
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────────

/**
 * Shared singleton instance.
 * Imported by app.ts for Fastify decoration and by services for emission.
 */
export const eventBus = new InProcessEventBus();
