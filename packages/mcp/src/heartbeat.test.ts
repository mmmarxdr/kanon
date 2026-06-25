/**
 * Activity-driven heartbeat — KAN-156 Slice 2 (reviewed)
 *
 * Model:
 *   - startAutoHeartbeat fires ONE immediate beat and records {client, lastBeatAt, generation}.
 *   - noteActivity() is fire-and-forget from the tool wrapper; it never rejects.
 *   - No activity → no beats → session TTL-expires. Idle over-count bug is fixed.
 *
 * Resilience (Slice A preserved):
 *   (b) transient 5xx → one retry after 1s, then log + stop
 *   (c) 404 → no retry, log + stop
 *   (d) 401 → no retry, log + stop
 *
 * Generation guard (WARNING 3 fix):
 *   fireOnce captures a generation token. If the issue is stopped+restarted
 *   while a beat is in flight, the old beat sees a stale generation and no-ops
 *   on terminal/retry actions (doesn't kill the new registration).
 *
 * wrapHandlerWithActivity (WARNING 4 fix):
 *   Exported from heartbeat.ts; index.ts uses it. Tests exercise the REAL
 *   function, not an inline re-implementation.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── KanonClient stub ────────────────────────────────────────────────────────

function makeKanonClient() {
  return {
    heartbeat: vi.fn(),
    stopWork: vi.fn().mockResolvedValue({ ok: true }),
  };
}

type FakeClient = ReturnType<typeof makeKanonClient>;

import * as heartbeatMod from "./heartbeat.js";

// ─── Shared setup / teardown ─────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  heartbeatMod.stopAllAutoHeartbeats();
});

afterEach(() => {
  heartbeatMod.stopAllAutoHeartbeats();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

// ─── Suite 1: startAutoHeartbeat — immediate beat + registration ─────────────

describe("startAutoHeartbeat", () => {
  it("sends an immediate first beat and records the issue as active", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-1", client as any);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(client.heartbeat).toHaveBeenCalledWith("KAN-1");
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-1");
  });

  it("replaces an existing registration for the same key", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-1", client as any);
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(2);
    expect(heartbeatMod.getActiveIssueKeys().filter((k) => k === "KAN-1")).toHaveLength(1);
  });
});

// ─── Suite 2: noteActivity — debounce logic ──────────────────────────────────

describe("noteActivity — debounce", () => {
  const DEBOUNCE_MS = 2 * 60 * 1000;

  it("does NOT fire a second heartbeat when called within the debounce window", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-10", client as any);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(DEBOUNCE_MS - 1);
    await heartbeatMod.noteActivity();
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("fires exactly one heartbeat when called after the debounce window", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-10", client as any);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(DEBOUNCE_MS);
    await heartbeatMod.noteActivity();
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("updates lastBeatAt so a second immediate noteActivity does not double-fire", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-10", client as any);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(DEBOUNCE_MS);
    await Promise.all([heartbeatMod.noteActivity(), heartbeatMod.noteActivity()]);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("noteActivity never rejects even when a heartbeat throws", async () => {
    const client = makeKanonClient();
    // Make the heartbeat throw something nasty
    client.heartbeat.mockRejectedValue(new Error("boom"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    heartbeatMod.startAutoHeartbeat("KAN-10", client as any);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(DEBOUNCE_MS);

    // noteActivity must NEVER reject — this should resolve cleanly
    await expect(heartbeatMod.noteActivity()).resolves.toBeUndefined();
  });
});

// ─── Suite 3: THE CORE REGRESSION GUARD — no activity → no beats ────────────

describe("idle session — no activity → no heartbeats after start", () => {
  it("does NOT fire any further heartbeats if noteActivity is never called, and issue stays tracked", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-99", client as any);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // 30 minutes of idle — zero activity calls
    await vi.advanceTimersByTimeAsync(30 * 60 * 1000);

    // Still exactly 1 beat — idle session was NOT beaten
    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    // Session remains tracked — future activity can still beat it (suggestion 5)
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-99");
  });
});

// ─── Suite 4: multiple active issues are debounced independently ─────────────

describe("multiple active issues", () => {
  const DEBOUNCE_MS = 2 * 60 * 1000;

  it("debounces each issue independently", async () => {
    const clientA = makeKanonClient();
    const clientB = makeKanonClient();
    clientA.heartbeat.mockResolvedValue(undefined);
    clientB.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-A", clientA as any);
    heartbeatMod.startAutoHeartbeat("KAN-B", clientB as any);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(DEBOUNCE_MS);
    await heartbeatMod.noteActivity();
    await vi.advanceTimersByTimeAsync(0);

    expect(clientA.heartbeat).toHaveBeenCalledTimes(2);
    expect(clientB.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("stopping one issue does not affect the other", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-A", client as any);
    heartbeatMod.startAutoHeartbeat("KAN-B", client as any);
    await vi.advanceTimersByTimeAsync(0);

    heartbeatMod.stopAutoHeartbeat("KAN-A");

    expect(heartbeatMod.getActiveIssueKeys()).not.toContain("KAN-A");
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-B");
  });
});

// ─── Suite 5: resilience — transient 5xx / 404 / 401 ────────────────────────

describe("resilience", () => {
  it("on transient 5xx from start beat: retries once after 1s, then stops tracking", async () => {
    const client = makeKanonClient();
    client.heartbeat
      .mockRejectedValueOnce({ statusCode: 503, message: "Service Unavailable" })
      .mockRejectedValueOnce({ statusCode: 503, message: "Still down" });

    vi.spyOn(console, "error").mockImplementation(() => {});

    heartbeatMod.startAutoHeartbeat("KAN-1", client as any);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(2);

    expect(heartbeatMod.getActiveIssueKeys()).not.toContain("KAN-1");

    vi.advanceTimersByTime(10 * 60 * 1000);
    await heartbeatMod.noteActivity();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("on transient 5xx from noteActivity beat: retries once after 1s, then stops tracking", async () => {
    const client = makeKanonClient();
    const DEBOUNCE_MS = 2 * 60 * 1000;

    client.heartbeat
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ statusCode: 503, message: "Transient" })
      .mockRejectedValueOnce({ statusCode: 503, message: "Still down" });

    vi.spyOn(console, "error").mockImplementation(() => {});

    heartbeatMod.startAutoHeartbeat("KAN-1", client as any);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(DEBOUNCE_MS);
    await heartbeatMod.noteActivity();
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(3);

    expect(heartbeatMod.getActiveIssueKeys()).not.toContain("KAN-1");
  });

  it("on HTTP 404: no retry, log + stop tracking", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockRejectedValueOnce({ statusCode: 404, message: "Session not found" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    heartbeatMod.startAutoHeartbeat("KAN-2", client as any);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeatMod.getActiveIssueKeys()).not.toContain("KAN-2");
  });

  it("on HTTP 401: no retry, log + stop tracking", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockRejectedValueOnce({ statusCode: 401, message: "Unauthorized" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    heartbeatMod.startAutoHeartbeat("KAN-3", client as any);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeatMod.getActiveIssueKeys()).not.toContain("KAN-3");
  });
});

// ─── Suite 6: generation guard — stale-closure race ─────────────────────────
//
// If an issue is stopped+restarted while an earlier beat is in-flight, the
// old beat's terminal action (stopAutoHeartbeat on 404/401 or retry-exhausted)
// must NOT kill the new registration.

describe("generation guard (stale-closure race)", () => {
  it("a 404 from a stale in-flight beat does NOT stop the new registration", async () => {
    const client = makeKanonClient();
    // The first heartbeat call hangs (we control resolution manually)
    let resolveFirst!: () => void;
    let rejectFirst!: (err: unknown) => void;
    const firstBeatPromise = new Promise<void>((res, rej) => {
      resolveFirst = res;
      rejectFirst = rej;
    });

    client.heartbeat
      .mockImplementationOnce(() => firstBeatPromise) // hangs
      .mockResolvedValue(undefined); // all subsequent succeed

    vi.spyOn(console, "error").mockImplementation(() => {});

    // Start gen 1
    heartbeatMod.startAutoHeartbeat("KAN-42", client as any);
    await vi.advanceTimersByTimeAsync(0); // first beat is in flight

    // Stop gen 1 and start gen 2 before gen 1 resolves
    heartbeatMod.stopAutoHeartbeat("KAN-42");
    heartbeatMod.startAutoHeartbeat("KAN-42", client as any);
    await vi.advanceTimersByTimeAsync(0); // gen 2 immediate beat → succeeds

    // Gen 1 beat comes back with 404 — stale generation
    rejectFirst({ statusCode: 404, message: "old session" });
    await vi.advanceTimersByTimeAsync(0);

    // Gen 2 registration must still be active — the 404 from gen 1 must not kill it
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-42");
  });

  it("a retry-exhausted from a stale beat does NOT stop the new registration", async () => {
    const client = makeKanonClient();
    let rejectFirst!: (err: unknown) => void;
    const firstBeatPromise = new Promise<void>((_, rej) => { rejectFirst = rej; });

    client.heartbeat
      .mockImplementationOnce(() => firstBeatPromise) // gen 1 hangs
      .mockResolvedValue(undefined); // gen 2 immediate beat + retry succeed

    vi.spyOn(console, "error").mockImplementation(() => {});

    heartbeatMod.startAutoHeartbeat("KAN-42", client as any);
    await vi.advanceTimersByTimeAsync(0);

    heartbeatMod.stopAutoHeartbeat("KAN-42");
    heartbeatMod.startAutoHeartbeat("KAN-42", client as any);
    await vi.advanceTimersByTimeAsync(0);

    // Gen 1 comes back with 503. The post-await generation check no-ops it, so
    // it must NOT even schedule a stale retry.
    rejectFirst({ statusCode: 503, message: "transient" });
    await vi.advanceTimersByTimeAsync(0);

    // Advance past the 1s retry backoff: a stale retry, if it had been scheduled,
    // would fire here and could stop the new registration. It must not.
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);

    // Gen 2 must still be alive after the would-be retry window.
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-42");
  });
});

// ─── Suite 7: stop / shutdown ────────────────────────────────────────────────

describe("stop and shutdown", () => {
  it("stopAutoHeartbeat removes the issue and cancels pending retry timer", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockRejectedValueOnce({ statusCode: 503, message: "down" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    heartbeatMod.startAutoHeartbeat("KAN-5", client as any);
    await vi.advanceTimersByTimeAsync(0);

    heartbeatMod.stopAutoHeartbeat("KAN-5");

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeatMod.getActiveIssueKeys()).not.toContain("KAN-5");
  });

  it("stopAllAutoHeartbeats clears all tracked issues", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-A", client as any);
    heartbeatMod.startAutoHeartbeat("KAN-B", client as any);
    await vi.advanceTimersByTimeAsync(0);

    heartbeatMod.stopAllAutoHeartbeats();

    expect(heartbeatMod.getActiveIssueKeys()).toHaveLength(0);
  });

  it("shutdownAllHeartbeats calls stopWork for each active issue", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-X", client as any);
    await vi.advanceTimersByTimeAsync(0);

    await heartbeatMod.shutdownAllHeartbeats();

    expect(client.stopWork).toHaveBeenCalledWith("KAN-X");
    expect(heartbeatMod.getActiveIssueKeys()).toHaveLength(0);
  });
});

// ─── Suite 8: wrapHandlerWithActivity — the REAL exported seam ───────────────
//
// Tests exercise the actual exported function from heartbeat.ts, not an inline
// re-implementation. The optional `notify` parameter is used to inject a spy
// without needing module-level interception (ESM live-binding constraint).

describe("wrapHandlerWithActivity", () => {
  it("calls noteActivity and preserves the handler return value", async () => {
    const notifySpy = vi.fn().mockResolvedValue(undefined);

    const result = Symbol("handler-result");
    const originalHandler = vi.fn().mockResolvedValue(result);

    const wrapped = heartbeatMod.wrapHandlerWithActivity(originalHandler as any, notifySpy);
    const returned = await wrapped("arg1", "arg2");

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(originalHandler).toHaveBeenCalledTimes(1);
    expect(originalHandler).toHaveBeenCalledWith("arg1", "arg2");
    expect(returned).toBe(result);
  });

  it("handler still runs and returns its value when noteActivity throws (error isolation)", async () => {
    const notifySpy = vi.fn().mockRejectedValue(new Error("noteActivity exploded"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = Symbol("handler-result");
    const originalHandler = vi.fn().mockResolvedValue(result);

    const wrapped = heartbeatMod.wrapHandlerWithActivity(originalHandler as any, notifySpy);

    // Must resolve, not reject — heartbeat error must never break the tool call
    const returned = await wrapped();

    expect(originalHandler).toHaveBeenCalledTimes(1);
    expect(returned).toBe(result);
  });

  it("handler result resolves without waiting on a slow/never-resolving noteActivity (non-blocking)", async () => {
    // notify returns a promise that never resolves
    let notifyStarted = false;
    const notifySpy = vi.fn().mockImplementation(() => {
      notifyStarted = true;
      return new Promise<void>(() => {}); // never resolves
    });

    const result = Symbol("handler-result");
    const originalHandler = vi.fn().mockResolvedValue(result);

    const wrapped = heartbeatMod.wrapHandlerWithActivity(originalHandler as any, notifySpy);

    // Should resolve immediately (fire-and-forget), not hang on noteActivity
    const returned = await wrapped();

    expect(notifyStarted).toBe(true); // notify WAS invoked
    expect(originalHandler).toHaveBeenCalledTimes(1);
    expect(returned).toBe(result); // handler result returned without waiting
  });
});
