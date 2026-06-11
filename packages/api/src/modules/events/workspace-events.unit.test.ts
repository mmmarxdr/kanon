/**
 * Unit tests for exported pure functions in workspace-events.ts (KAN-84 slice 1).
 *
 * These are fast, NO-DB tests that target every exported seam so StrykerJS
 * mutation testing can kill all covered mutants. They run in the main vitest
 * suite and in the focused vitest.mutation.config.ts suite.
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { ServerResponse } from "http";
import {
  HEARTBEAT_INTERVAL_MS,
  parseLastEventId,
  selectWorkspaceEvents,
  startHeartbeat,
  writeHeartbeat,
  writeSSEEvent,
} from "./workspace-events.js";
import type { DomainEvent } from "../../services/event-bus/index.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeFakeRaw(): ServerResponse & { write: ReturnType<typeof vi.fn> } {
  return { write: vi.fn() } as unknown as ServerResponse & {
    write: ReturnType<typeof vi.fn>;
  };
}

function makeEvent(overrides: Partial<DomainEvent> = {}): DomainEvent {
  return {
    id: 1,
    type: "issue.created",
    workspaceId: "ws-1",
    actorId: "member-1",
    payload: {},
    timestamp: "2026-06-11T00:00:00.000Z",
    ...overrides,
  };
}

// ─── parseLastEventId ──────────────────────────────────────────────────────────

describe("parseLastEventId", () => {
  it("returns null when header is undefined", () => {
    expect(parseLastEventId(undefined)).toBeNull();
  });

  it("returns null when header is an empty string", () => {
    expect(parseLastEventId("")).toBeNull();
  });

  it("returns null when header is non-numeric", () => {
    expect(parseLastEventId("abc")).toBeNull();
  });

  it("parses a valid numeric string to an integer", () => {
    expect(parseLastEventId("5")).toBe(5);
  });

  it("truncates a decimal string to integer (parseInt behaviour)", () => {
    expect(parseLastEventId("12.9")).toBe(12);
  });

  it("takes the first element when header is an array", () => {
    expect(parseLastEventId(["7", "8"])).toBe(7);
  });

  it("returns null when array header starts with an empty string", () => {
    expect(parseLastEventId(["", "5"])).toBeNull();
  });

  it("returns null for an empty array (no first element, raw is undefined)", () => {
    // Array.isArray([]) is true; header[0] is undefined → !raw guard fires → null
    // Note: parseInt(undefined, 10) is also NaN, so this is an equivalent mutant path.
    expect(parseLastEventId([])).toBeNull();
  });

  it("returns null when array header starts with non-numeric", () => {
    expect(parseLastEventId(["abc", "5"])).toBeNull();
  });
});

// ─── selectWorkspaceEvents ────────────────────────────────────────────────────

describe("selectWorkspaceEvents", () => {
  it("returns empty array for empty input", () => {
    expect(selectWorkspaceEvents([], "ws-1")).toEqual([]);
  });

  it("keeps only events with the matching workspaceId", () => {
    const a = makeEvent({ id: 1, workspaceId: "ws-1" });
    const b = makeEvent({ id: 2, workspaceId: "ws-2" });
    const c = makeEvent({ id: 3, workspaceId: "ws-1" });

    expect(selectWorkspaceEvents([a, b, c], "ws-1")).toEqual([a, c]);
  });

  it("returns empty array when no events match", () => {
    const a = makeEvent({ workspaceId: "ws-other" });
    expect(selectWorkspaceEvents([a], "ws-1")).toEqual([]);
  });

  it("returns all events when all match the workspaceId", () => {
    const a = makeEvent({ id: 1, workspaceId: "ws-1" });
    const b = makeEvent({ id: 2, workspaceId: "ws-1" });

    const result = selectWorkspaceEvents([a, b], "ws-1");
    expect(result).toHaveLength(2);
    expect(result[0]).toBe(a);
    expect(result[1]).toBe(b);
  });
});

// ─── writeSSEEvent ────────────────────────────────────────────────────────────

describe("writeSSEEvent", () => {
  it("writes the exact SSE frame string to raw", () => {
    const raw = makeFakeRaw();
    const event = makeEvent({
      id: 42,
      type: "issue.updated",
      workspaceId: "ws-abc",
      actorId: "member-xyz",
      payload: { foo: "bar" },
      timestamp: "2026-06-11T12:00:00.000Z",
    });

    writeSSEEvent(raw, event);

    expect(raw.write).toHaveBeenCalledOnce();
    expect(raw.write).toHaveBeenCalledWith(
      `id: 42\nevent: issue.updated\ndata: ${JSON.stringify(event)}\n\n`,
    );
  });

  it("calls raw.write exactly once per event", () => {
    const raw = makeFakeRaw();
    writeSSEEvent(raw, makeEvent());
    expect(raw.write).toHaveBeenCalledTimes(1);
  });

  it("frame uses the event id field", () => {
    const raw = makeFakeRaw();
    writeSSEEvent(raw, makeEvent({ id: 99 }));
    const written = (raw.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(written).toMatch(/^id: 99\n/);
  });

  it("frame uses the event type field", () => {
    const raw = makeFakeRaw();
    writeSSEEvent(raw, makeEvent({ type: "member.added" }));
    const written = (raw.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(written).toContain("event: member.added\n");
  });

  it("frame ends with double newline", () => {
    const raw = makeFakeRaw();
    writeSSEEvent(raw, makeEvent());
    const written = (raw.write as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    expect(written.endsWith("\n\n")).toBe(true);
  });
});

// ─── writeHeartbeat ───────────────────────────────────────────────────────────

describe("writeHeartbeat", () => {
  it("writes exactly \":heartbeat\\n\\n\" to raw", () => {
    const raw = makeFakeRaw();
    writeHeartbeat(raw);
    expect(raw.write).toHaveBeenCalledOnce();
    expect(raw.write).toHaveBeenCalledWith(":heartbeat\n\n");
  });
});

// ─── startHeartbeat ───────────────────────────────────────────────────────────

describe("startHeartbeat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not write immediately on start", () => {
    const raw = makeFakeRaw();
    const handle = startHeartbeat(raw);
    expect(raw.write).not.toHaveBeenCalled();
    clearInterval(handle);
  });

  it("writes one heartbeat after exactly 30000ms", () => {
    const raw = makeFakeRaw();
    const handle = startHeartbeat(raw);

    vi.advanceTimersByTime(30000);

    expect(raw.write).toHaveBeenCalledTimes(1);
    expect(raw.write).toHaveBeenCalledWith(":heartbeat\n\n");
    clearInterval(handle);
  });

  it("writes two heartbeats after two 30000ms intervals", () => {
    const raw = makeFakeRaw();
    const handle = startHeartbeat(raw);

    vi.advanceTimersByTime(30000);
    vi.advanceTimersByTime(30000);

    expect(raw.write).toHaveBeenCalledTimes(2);
    clearInterval(handle);
  });

  it("stops writing after clearInterval", () => {
    const raw = makeFakeRaw();
    const handle = startHeartbeat(raw);

    vi.advanceTimersByTime(30000);
    expect(raw.write).toHaveBeenCalledTimes(1);

    clearInterval(handle);

    vi.advanceTimersByTime(30000);
    // Still only 1 — cleared interval does not fire
    expect(raw.write).toHaveBeenCalledTimes(1);
  });

  it("uses HEARTBEAT_INTERVAL_MS constant as interval (exported value = 30000)", () => {
    // Assert the exported constant equals 30000 so a mutant that changes it is caught
    expect(HEARTBEAT_INTERVAL_MS).toBe(30000);
  });
});
