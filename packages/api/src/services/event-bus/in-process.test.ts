import { describe, it, expect, beforeEach, vi } from "vitest";
import { InProcessEventBus } from "./in-process.js";
import type { DomainEventInput, DomainEvent } from "./types.js";

function makeInput(overrides?: Partial<DomainEventInput>): DomainEventInput {
  return {
    type: "issue.created",
    workspaceId: "ws-1",
    actorId: "actor-1",
    payload: { key: "KAN-1" },
    ...overrides,
  };
}

describe("InProcessEventBus", () => {
  let bus: InProcessEventBus;

  beforeEach(() => {
    bus = new InProcessEventBus();
  });

  // ── emit + subscribe ────────────────────────────────────────────────

  it("delivers emitted event to subscriber", () => {
    const received: DomainEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit(makeInput());

    expect(received).toHaveLength(1);
    expect(received[0]!.type).toBe("issue.created");
    expect(received[0]!.workspaceId).toBe("ws-1");
    expect(received[0]!.payload).toEqual({ key: "KAN-1" });
  });

  it("delivers events to multiple subscribers", () => {
    const a: DomainEvent[] = [];
    const b: DomainEvent[] = [];
    bus.subscribe((e) => a.push(e));
    bus.subscribe((e) => b.push(e));

    bus.emit(makeInput());

    expect(a).toHaveLength(1);
    expect(b).toHaveLength(1);
  });

  // ── subscribeToWorkspace ─────────────────────────────────────────────

  it("subscribeToWorkspace filters by workspace", () => {
    const ws1Events: DomainEvent[] = [];
    const ws2Events: DomainEvent[] = [];

    bus.subscribeToWorkspace("ws-1", (e) => ws1Events.push(e));
    bus.subscribeToWorkspace("ws-2", (e) => ws2Events.push(e));

    bus.emit(makeInput({ workspaceId: "ws-1" }));
    bus.emit(makeInput({ workspaceId: "ws-2" }));
    bus.emit(makeInput({ workspaceId: "ws-1" }));

    expect(ws1Events).toHaveLength(2);
    expect(ws2Events).toHaveLength(1);
  });

  // ── unsubscribe ──────────────────────────────────────────────────────

  it("unsubscribe stops delivering events", () => {
    const received: DomainEvent[] = [];
    const unsub = bus.subscribe((e) => received.push(e));

    bus.emit(makeInput());
    expect(received).toHaveLength(1);

    unsub();
    bus.emit(makeInput());
    expect(received).toHaveLength(1); // no new events
  });

  it("subscribeToWorkspace unsubscribe works", () => {
    const received: DomainEvent[] = [];
    const unsub = bus.subscribeToWorkspace("ws-1", (e) => received.push(e));

    bus.emit(makeInput({ workspaceId: "ws-1" }));
    expect(received).toHaveLength(1);

    unsub();
    bus.emit(makeInput({ workspaceId: "ws-1" }));
    expect(received).toHaveLength(1);
  });

  // ── monotonic ID generation ──────────────────────────────────────────

  it("assigns monotonically increasing IDs", () => {
    const received: DomainEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit(makeInput());
    bus.emit(makeInput());
    bus.emit(makeInput());

    expect(received[0]!.id).toBe(1);
    expect(received[1]!.id).toBe(2);
    expect(received[2]!.id).toBe(3);
  });

  it("assigns ISO timestamp to each event", () => {
    const received: DomainEvent[] = [];
    bus.subscribe((e) => received.push(e));

    bus.emit(makeInput());

    expect(received[0]!.timestamp).toBeDefined();
    // Verify it's a valid ISO-8601 date
    expect(new Date(received[0]!.timestamp).toISOString()).toBe(received[0]!.timestamp);
  });

  // ── replay buffer ────────────────────────────────────────────────────

  it("getEventsSince returns events after a given ID", () => {
    // Emit 5 events
    for (let i = 0; i < 5; i++) {
      bus.emit(makeInput({ payload: { index: i } }));
    }

    const since3 = bus.getEventsSince(3);
    expect(since3).toHaveLength(2);
    expect(since3[0]!.id).toBe(4);
    expect(since3[1]!.id).toBe(5);
  });

  it("getEventsSince returns empty when ID is ahead of all events", () => {
    bus.emit(makeInput());
    bus.emit(makeInput());

    const result = bus.getEventsSince(100);
    expect(result).toEqual([]);
  });

  it("getEventsSince returns all events when ID is 0", () => {
    bus.emit(makeInput());
    bus.emit(makeInput());
    bus.emit(makeInput());

    const result = bus.getEventsSince(0);
    expect(result).toHaveLength(3);
  });

  // ── replay buffer capacity ───────────────────────────────────────────

  it("drops oldest events when replay buffer exceeds 1000", () => {
    // Emit 1005 events
    for (let i = 0; i < 1005; i++) {
      bus.emit(makeInput({ payload: { index: i } }));
    }

    // Events 1-5 should have been evicted; earliest is event 6
    const all = bus.getEventsSince(0);
    expect(all).toHaveLength(1000);
    expect(all[0]!.id).toBe(6);
    expect(all[all.length - 1]!.id).toBe(1005);
  });

  it("getEventsSince returns empty when requested ID was evicted", () => {
    for (let i = 0; i < 1005; i++) {
      bus.emit(makeInput());
    }
    // Event ID 1 was evicted
    const result = bus.getEventsSince(1);
    // Events 2-5 were also evicted, so only events from 6+ remain
    // But since we asked for events after ID 1, and 2-5 don't exist in the buffer,
    // it should still return events starting from 6 (the first one > 1)
    expect(result.length).toBeGreaterThan(0);
    expect(result[0]!.id).toBe(6);
  });

  // ── error isolation ──────────────────────────────────────────────────

  it("does not throw when subscriber throws", () => {
    bus.subscribe(() => {
      throw new Error("subscriber error");
    });

    // emit should not throw even if the subscriber does
    expect(() => bus.emit(makeInput())).not.toThrow();
  });
});
