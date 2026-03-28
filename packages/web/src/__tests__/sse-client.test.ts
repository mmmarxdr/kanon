import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SseClient, type SyncStatus } from "@/lib/sse-client";

// ─── Helpers ──────────────────────────────────────────────────────────────

/** Flush pending microtasks without advancing timers. */
async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await new Promise<void>((r) => queueMicrotask(r));
  }
}

/**
 * Creates a mock ReadableStream that yields chunks of SSE data.
 * The stream reads are async, so each chunk resolves as a microtask.
 */
function createMockStream(chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  let index = 0;

  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (index < chunks.length) {
        controller.enqueue(encoder.encode(chunks[index]!));
        index++;
      } else {
        controller.close();
      }
    },
  });
}

/**
 * Creates a mock Response with a ReadableStream body.
 */
function createMockResponse(chunks: string[], status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    body: createMockStream(chunks),
    headers: new Headers({ "Content-Type": "text/event-stream" }),
  } as unknown as Response;
}

/**
 * Creates a mock Response that never closes (hangs the reader).
 * Useful for tests where we want a persistent connection.
 */
function createHangingResponse(): Response {
  const stream = new ReadableStream<Uint8Array>({
    // Never enqueue or close — the reader just waits forever
    pull() {
      return new Promise(() => {}); // never resolves
    },
  });

  return {
    ok: true,
    status: 200,
    body: stream,
    headers: new Headers({ "Content-Type": "text/event-stream" }),
  } as unknown as Response;
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("SseClient", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  // ── Connects with Authorization header ────────────────────────────────

  it("connects with credentials: include for cookie-based auth", async () => {
    const mockFetch = vi.fn().mockResolvedValue(createHangingResponse());
    globalThis.fetch = mockFetch;

    const client = new SseClient("http://localhost/api/events/sync");
    client.connect();

    await flushMicrotasks();

    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost/api/events/sync",
      expect.objectContaining({
        headers: expect.objectContaining({
          Accept: "text/event-stream",
        }),
        credentials: "include",
      }),
    );

    client.close();
  });

  // ── Parses SSE data lines into events ─────────────────────────────────

  it("parses SSE data lines into events and calls onEvent callback", async () => {
    const event = { type: "sync_complete", timestamp: "2026-03-22T12:00:00Z", changedCount: 3 };
    const sseData = `data: ${JSON.stringify(event)}\n\n`;

    // Return a response that closes after delivering data — but DON'T let
    // the reconnect loop run by closing the client immediately after.
    globalThis.fetch = vi.fn().mockResolvedValue(
      createMockResponse([sseData]),
    );

    const client = new SseClient("http://localhost/api/events/sync");
    const eventHandler = vi.fn();
    client.onEvent(eventHandler);

    client.connect();
    await flushMicrotasks();

    expect(eventHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sync_complete",
        changedCount: 3,
      }),
    );

    client.close();
  });

  // ── Status changes from connecting to connected ───────────────────────

  it("status changes from 'connecting' to 'connected'", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue(createHangingResponse());

    const client = new SseClient("http://localhost/api/events/sync");
    const statusChanges: SyncStatus[] = [];

    client.onStatusChange((s) => statusChanges.push(s));

    client.connect();
    await flushMicrotasks();

    // Should see: disconnected (initial from onStatusChange), connecting, connected
    expect(statusChanges).toContain("connecting");
    expect(statusChanges).toContain("connected");

    const connectingIdx = statusChanges.indexOf("connecting");
    const connectedIdx = statusChanges.indexOf("connected");
    expect(connectingIdx).toBeLessThan(connectedIdx);

    client.close();
  });

  // ── Reconnects with exponential backoff on disconnect ─────────────────

  it("reconnects with exponential backoff on disconnect", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount <= 2) {
        return Promise.reject(new Error("Connection refused"));
      }
      // Third attempt: return a hanging response (stays connected)
      return Promise.resolve(createHangingResponse());
    });

    const client = new SseClient("http://localhost/api/events/sync");
    const statusChanges: SyncStatus[] = [];
    client.onStatusChange((s) => statusChanges.push(s));

    client.connect();

    // First attempt fails immediately
    await flushMicrotasks();
    expect(callCount).toBe(1);

    // Advance past first backoff (1s)
    vi.advanceTimersByTime(1000);
    await flushMicrotasks();
    expect(callCount).toBe(2);

    // Advance past second backoff (2s)
    vi.advanceTimersByTime(2000);
    await flushMicrotasks();
    expect(callCount).toBe(3);

    // Should have seen error status at some point
    expect(statusChanges).toContain("error");

    client.close();
  });

  // ── close() stops reconnection attempts ───────────────────────────────

  it("close() stops reconnection attempts", async () => {
    // Fail the first connection to trigger reconnect scheduling
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("fail"));

    const client = new SseClient("http://localhost/api/events/sync");
    client.connect();
    await flushMicrotasks();

    const fetchCallCount = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length;

    // Close before reconnect timer fires
    client.close();

    // Advance well past any backoff
    vi.advanceTimersByTime(30000);
    await flushMicrotasks();

    // No additional fetch calls should have been made
    expect((globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls.length).toBe(fetchCallCount);
  });

  // ── Emits 'reconnected' event on successful reconnect ─────────────────

  it("emits 'reconnected' event on successful reconnect", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(() => {
      callCount++;
      if (callCount === 1) {
        // First connection succeeds with a stream that closes immediately
        return Promise.resolve(createMockResponse([]));
      }
      // Second connection (reconnect) succeeds — hang to prevent further reconnects
      return Promise.resolve(createHangingResponse());
    });

    const client = new SseClient("http://localhost/api/events/sync");
    const events: Array<{ type: string }> = [];
    client.onEvent((e) => events.push(e));

    client.connect();

    // First connection completes (stream closes), triggers reconnect scheduling
    await flushMicrotasks();

    // Advance past reconnect backoff (1s)
    vi.advanceTimersByTime(1000);
    await flushMicrotasks();

    // Should have emitted a 'reconnected' event on the second connection
    const reconnectedEvents = events.filter((e) => e.type === "reconnected");
    expect(reconnectedEvents.length).toBeGreaterThanOrEqual(1);

    client.close();
  });
});
