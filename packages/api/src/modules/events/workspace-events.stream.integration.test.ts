/**
 * Real-HTTP integration tests for the workspace SSE streaming endpoint (KAN-84 slice 1).
 *
 * Why real HTTP?  Fastify's inject() buffers the entire response and only
 * returns when the handler completes.  The SSE handler never completes —
 * it streams indefinitely — so inject() would hang forever.  We bind the app
 * to a random port, use the global fetch API + ReadableStream to read frames,
 * and abort the connection when done.
 *
 * Guards against hangs: every read operation races against a timeout promise
 * so a broken handler fails fast instead of hanging the whole suite.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { FastifyInstance } from "fastify";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { eventBus } from "../../services/event-bus/index.js";

// ─── helpers ──────────────────────────────────────────────────────────────────

/**
 * Race a promise against a timeout.  Throws a descriptive error on timeout.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label = "operation",
): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<T>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Timeout: ${label} did not complete in ${ms}ms`)),
      ms,
    );
  });
  // Clear the timer once the real promise settles so it never keeps the
  // event loop alive (otherwise every won race leaves a dangling timer that
  // can delay process exit and flip the suite to a CI timeout).
  return Promise.race([promise.finally(() => clearTimeout(timer)), timeout]);
}

/**
 * Read one chunk from a ReadableStream reader and return its text.
 * Races against a timeout to prevent hanging on broken handlers.
 */
async function readChunk(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs = 5000,
): Promise<string> {
  const result = await withTimeout(reader.read(), timeoutMs, "SSE chunk read");
  if (result.done) return "";
  return new TextDecoder().decode(result.value);
}

/**
 * Drain the reader until the accumulated text satisfies a predicate, or
 * timeout.  Returns the accumulated text.
 */
async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  predicate: (text: string) => boolean,
  timeoutMs = 5000,
): Promise<string> {
  let accumulated = "";
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const chunk = await withTimeout(
      reader.read(),
      Math.max(0, deadline - Date.now()),
      "SSE readUntil chunk",
    );
    if (chunk.done) break;
    accumulated += new TextDecoder().decode(chunk.value);
    if (predicate(accumulated)) return accumulated;
  }

  throw new Error(
    `readUntil: predicate never satisfied. Accumulated: ${JSON.stringify(accumulated)}`,
  );
}

// ─── suite ────────────────────────────────────────────────────────────────────

describe("Workspace SSE streaming — real HTTP", () => {
  let app: FastifyInstance;
  let address: string;

  beforeAll(async () => {
    app = await createTestApp();
    address = await app.listen({ port: 0, host: "127.0.0.1" });
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ─── Test A: headers + live event delivery ───────────────────────────────

  it("responds with correct SSE headers and delivers a live event", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");

    const controller = new AbortController();

    const res = await withTimeout(
      fetch(`${address}/api/events/workspace/${ws.id}`, {
        headers: { authorization: `Bearer ${member.token}` },
        signal: controller.signal,
      }),
      5000,
      "SSE connect",
    );

    try {
      // Assert SSE headers — also kills header-value mutants (Cache-Control, Connection)
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/text\/event-stream/);
      expect(res.headers.get("cache-control")).toBe("no-cache");
      expect(res.headers.get("connection")).toBe("keep-alive");

      if (!res.body) throw new Error("Response body is null");

      const reader = res.body.getReader();

      // Emit an event AFTER the connection is established.
      // Give the server a small tick to process the subscribe before emitting.
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      eventBus.emit({
        type: "issue.created",
        workspaceId: ws.id,
        actorId: member.id,
        payload: { title: "Test Issue" },
      });

      // Read chunks until we see the event frame
      const text = await readUntil(
        reader,
        (t) => t.includes("event: issue.created"),
        5000,
      );

      expect(text).toContain("event: issue.created");
      expect(text).toContain("id: ");

      // cancel() may reject with an AbortError once the signal fires; swallow it
      // so it never becomes an unhandled rejection (matches the other tests).
      await reader.cancel().catch(() => {});
    } finally {
      controller.abort();
    }
  });

  // ─── Test C2: no replay when Last-Event-ID header is absent ────────────

  it("does NOT call getEventsSince when Last-Event-ID header is absent", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");

    // Spy on getEventsSince — it must NOT be called when no Last-Event-ID header is sent
    const getSinceSpy = vi.spyOn(eventBus, "getEventsSince");

    const controller = new AbortController();

    const res = await withTimeout(
      fetch(`${address}/api/events/workspace/${ws.id}`, {
        // Deliberately NO last-event-id header
        headers: { authorization: `Bearer ${member.token}` },
        signal: controller.signal,
      }),
      5000,
      "SSE connect — no replay",
    );

    try {
      expect(res.status).toBe(200);
      if (!res.body) throw new Error("Response body is null");

      const reader = res.body.getReader();

      // Give the server time to finish the replay phase (if any)
      await new Promise<void>((resolve) => setTimeout(resolve, 100));

      // Emit a live event so we know the connection is established
      eventBus.emit({
        type: "project.updated",
        workspaceId: ws.id,
        actorId: member.id,
        payload: {},
      });

      await readUntil(reader, (t) => t.includes("project.updated"), 5000);

      // getEventsSince must NOT have been called — no Last-Event-ID was sent
      expect(getSinceSpy).not.toHaveBeenCalled();

      await reader.cancel().catch(() => {
        // expected: AbortError
      });
    } finally {
      controller.abort();
      vi.restoreAllMocks();
    }
  });

  // ─── Test C: Last-Event-ID replay ───────────────────────────────────────

  it("replays missed events when Last-Event-ID header is sent", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");

    // Pre-emit two events so they land in the replay buffer before connecting
    eventBus.emit({
      type: "issue.created",
      workspaceId: ws.id,
      actorId: member.id,
      payload: { title: "Missed Event 1" },
    });
    eventBus.emit({
      type: "issue.updated",
      workspaceId: ws.id,
      actorId: member.id,
      payload: { title: "Missed Event 2" },
    });

    // Capture the ID of the first event (the replay should start after id=0)
    const controller = new AbortController();

    const res = await withTimeout(
      fetch(`${address}/api/events/workspace/${ws.id}`, {
        headers: {
          authorization: `Bearer ${member.token}`,
          // Replay from the very beginning (id=0 means "give me everything")
          "last-event-id": "0",
        },
        signal: controller.signal,
      }),
      5000,
      "SSE connect for replay test",
    );

    try {
      expect(res.status).toBe(200);
      if (!res.body) throw new Error("Response body is null");

      const reader = res.body.getReader();

      // Read until we see both missed events replayed
      const text = await readUntil(
        reader,
        (t) => t.includes("issue.created") && t.includes("issue.updated"),
        5000,
      );

      expect(text).toContain("event: issue.created");
      expect(text).toContain("event: issue.updated");

      await reader.cancel().catch(() => {
        // expected: AbortError
      });
    } finally {
      controller.abort();
    }
  });

  // ─── Test B: cleanup on disconnect ──────────────────────────────────────

  it("cleans up subscription when client disconnects", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");

    // Spy on subscribeToWorkspace to capture the returned unsubscribe function
    const unsubSpy = vi.fn();

    const origSubscribeToWorkspace =
      eventBus.subscribeToWorkspace.bind(eventBus);

    vi.spyOn(eventBus, "subscribeToWorkspace").mockImplementation(
      (workspaceId, handler, name) => {
        const realUnsub = origSubscribeToWorkspace(workspaceId, handler, name);
        return () => {
          unsubSpy();
          realUnsub();
        };
      },
    );

    try {
      const controller = new AbortController();

      const res = await withTimeout(
        fetch(`${address}/api/events/workspace/${ws.id}`, {
          headers: { authorization: `Bearer ${member.token}` },
          signal: controller.signal,
        }),
        5000,
        "SSE connect for cleanup test",
      );

      if (!res.body) throw new Error("Response body is null");

      const reader = res.body.getReader();

      // Read at least one chunk to confirm the subscription is live
      // (the heartbeat fires after 30s so we emit one event to get a real frame)
      await new Promise<void>((resolve) => setTimeout(resolve, 50));

      eventBus.emit({
        type: "member.added",
        workspaceId: ws.id,
        actorId: member.id,
        payload: {},
      });

      // Wait for the event frame to confirm connection is live and subscribed
      await readUntil(reader, (t) => t.includes("event: member.added"), 5000);

      // Now disconnect — abort the fetch.
      // reader.cancel() may reject with an AbortError; swallow it so it doesn't
      // become an unhandled rejection in the test runner.
      controller.abort();
      await reader.cancel().catch(() => {
        // expected: AbortError from the in-flight read
      });

      // Wait for the close event to propagate to the server and cleanup to run.
      // Poll up to ~2 seconds.
      const deadline = Date.now() + 2000;
      while (!unsubSpy.mock.calls.length && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, 50));
      }

      expect(unsubSpy).toHaveBeenCalledTimes(1);
    } finally {
      vi.restoreAllMocks();
    }
  });
});
