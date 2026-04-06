import { EventEmitter } from "events";
import type { IEventBus } from "./interface.js";
import type { DomainEvent, DomainEventInput } from "./types.js";

/** Maximum number of events kept in the replay buffer. */
const REPLAY_BUFFER_SIZE = 1000;

/**
 * In-process event bus backed by Node.js EventEmitter.
 *
 * - Assigns monotonic sequence IDs to each event.
 * - Maintains a circular replay buffer for SSE reconnection.
 * - All emissions are synchronous and fire-and-forget.
 */
export class InProcessEventBus implements IEventBus {
  private readonly emitter = new EventEmitter();
  private sequenceCounter = 0;
  private readonly replayBuffer: DomainEvent[] = [];

  constructor() {
    // Allow many SSE clients without warnings
    this.emitter.setMaxListeners(0);
  }

  // ─── IEventBus ─────────────────────────────────────────────────────────

  emit(input: DomainEventInput): void {
    const event: DomainEvent = {
      ...input,
      id: ++this.sequenceCounter,
      timestamp: new Date().toISOString(),
    };

    // Push to replay buffer, evicting oldest if full
    this.replayBuffer.push(event);
    if (this.replayBuffer.length > REPLAY_BUFFER_SIZE) {
      this.replayBuffer.shift();
    }

    // Fire to subscribers — errors in handlers must not propagate
    try {
      this.emitter.emit("domain_event", event);
    } catch {
      // Swallow — event emission must never break the caller
    }
  }

  subscribe(handler: (event: DomainEvent) => void): () => void {
    this.emitter.on("domain_event", handler);
    return () => {
      this.emitter.off("domain_event", handler);
    };
  }

  subscribeToWorkspace(
    workspaceId: string,
    handler: (event: DomainEvent) => void,
  ): () => void {
    const filtered = (event: DomainEvent): void => {
      if (event.workspaceId === workspaceId) {
        handler(event);
      }
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
}

// ─── Singleton ───────────────────────────────────────────────────────────────

/**
 * Shared singleton instance.
 * Imported by app.ts for Fastify decoration and by services for emission.
 */
export const eventBus = new InProcessEventBus();
