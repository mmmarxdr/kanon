/**
 * work-session-resilience (Slice A) — Phase 4
 *
 * The MCP heartbeat scheduler must:
 *   (a) apply ±20% jitter to the base interval (`interval * (0.8 + random*0.4)`)
 *   (b) retry exactly once with a 1s backoff on a transient 5xx; on second
 *       failure, log + clear the timer (silent give-up)
 *   (c) NOT retry on HTTP 404 — session is terminal, log + clear
 *   (d) NOT retry on HTTP 401 — auth boundary, retrying won't help
 *
 * The exported `startAutoHeartbeat` triggers the FIRST fire on a setTimeout.
 * Each subsequent fire schedules the next one. We use `vi.useFakeTimers()`
 * to drive the scheduler deterministically and stub a fake `KanonClient`.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── KanonClient stub ───────────────────────────────────────────────────────

function makeKanonClient() {
  return {
    heartbeat: vi.fn(),
    stopWork: vi.fn().mockResolvedValue({ ok: true }),
  };
}

type FakeClient = ReturnType<typeof makeKanonClient>;

// We import the module under test AFTER setting up the fake timers / mocks.
import * as heartbeatMod from "./heartbeat.js";

describe("heartbeat — jitter + bounded retry (Slice A, Phase 4)", () => {
  let client: FakeClient;

  beforeEach(() => {
    vi.useFakeTimers();
    // The test that asserts jitter bounds over many samples needs the
    // function to be deterministic enough to evaluate. Spy on Math.random
    // (NOT replace it) so other randomness elsewhere in the module still
    // works.
    client = makeKanonClient();
    // Stop any leftover heartbeats from a prior test (singleton map).
    heartbeatMod.stopAllAutoHeartbeats?.();
  });

  afterEach(() => {
    heartbeatMod.stopAllAutoHeartbeats?.();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  // ── (a) jitter bounds ──────────────────────────────────────────────────
  //
  // Default HEARTBEAT_INTERVAL_MS = 2 * 60_000 = 120_000. Jitter ±20% →
  // effective delay ∈ [96_000, 144_000]. We can't observe the exact delay
  // without time-mocking the FIRST setTimeout, so we sample by spying
  // on Math.random and checking the multipliers fall in [0.8, 1.2).
  //
  // The scheduler is a `setTimeout`; the first fire happens after the
  // jittered delay. We assert that across many samples the random
  // multiplier used by the scheduler is in [0.8, 1.2].

  it("applies ±20% jitter to the base interval (multiplier ∈ [0.8, 1.2])", () => {
    // Replace Math.random with a fixed sequence; the module reads it
    // synchronously during schedule. Capture the delay passed to setTimeout
    // across many `startAutoHeartbeat` calls.
    const observedMultipliers: number[] = [];
    const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout");

    // Make Math.random deterministic: walk 0.0 → 0.25 → 0.5 → 0.75 → 0.999
    // to exercise the full jitter range. The module is expected to call
    // Math.random() exactly once per schedule.
    const randomValues = [0, 0.25, 0.5, 0.75, 0.999];
    let idx = 0;
    vi.spyOn(Math, "random").mockImplementation(() => {
      const v = randomValues[idx % randomValues.length]!;
      idx++;
      return v;
    });

    // BASE = 120_000. Capture the first setTimeout(..., delay) call.
    const BASE = 120_000;
    const seen = new Set<number>();
    setTimeoutSpy.mockImplementation(((handler: unknown, delay?: number) => {
      if (typeof delay === "number" && !seen.has(delay)) seen.add(delay);
      // Return a no-op handle to avoid blocking event loop in fake timers.
      return 0 as unknown as ReturnType<typeof setTimeout>;
    }) as typeof setTimeout);

    // Drive 5 different issues so we get 5 schedule calls.
    for (let i = 0; i < 5; i++) {
      heartbeatMod.startAutoHeartbeat(`KAN-${i}`, client as any);
    }

    for (const d of seen) {
      const mult = d / BASE;
      observedMultipliers.push(mult);
      // Allow exact 0.8 and 1.2 inclusive; jitter formula is
      // `0.8 + Math.random() * 0.4` → range [0.8, 1.2] inclusive.
      expect(mult).toBeGreaterThanOrEqual(0.8);
      expect(mult).toBeLessThanOrEqual(1.2);
    }
    // Should have at least one observed delay.
    expect(observedMultipliers.length).toBeGreaterThan(0);
  });

  // ── (b) transient 5xx → one retry after 1000ms, then give up ──────────

  it("on transient 5xx: schedules one retry after 1000ms; on second failure clears the timer", async () => {
    client.heartbeat
      .mockRejectedValueOnce({ statusCode: 503, message: "Service Unavailable" })
      .mockRejectedValueOnce({ statusCode: 503, message: "Still down" });

    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Pin the jitter to 0.5 → factor = 0.8 + 0.4*0.5 = 1.0 → delay = 120_000.
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    heartbeatMod.startAutoHeartbeat("KAN-1", client as any);

    // Fire the first scheduled tick. With jitter factor 1.0, the first timer
    // fires at fake-t=120_000. Use a small over-advance to land cleanly
    // past the boundary, but well within range so the +1000ms retry does
    // NOT also fire.
    await vi.advanceTimersByTimeAsync(120_500);
    // Allow microtasks to flush.
    await vi.advanceTimersByTimeAsync(0);
    // The first heartbeat call happened.
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // The retry is scheduled at +1000ms (per design: bounded retry, 1s
    // backoff). Advance to that and let microtasks flush.
    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);
    // Second call happened (the retry).
    expect(client.heartbeat).toHaveBeenCalledTimes(2);

    // On second failure, stopAutoHeartbeat is called → no third call.
    // The scheduler is also self-rescheduling, so the next normal tick
    // would be at the jittered interval. Make sure that tick DOESN'T fire
    // (because the timer was cleared).
    const callsAfterSecondFailure = client.heartbeat.mock.calls.length;
    await vi.advanceTimersByTimeAsync(120_000 * 5);
    expect(client.heartbeat).toHaveBeenCalledTimes(callsAfterSecondFailure);

    // console.error was called with the failure reason.
    expect(errSpy).toHaveBeenCalled();
    const allErrMsgs = errSpy.mock.calls.map((c) => String(c[0] ?? ""));
    const hasGiveUp = allErrMsgs.some((m) =>
      m.includes("KAN-1") || m.includes("heartbeat"),
    );
    expect(hasGiveUp).toBe(true);
  });

  // ── (c) 404 → no retry, log + clear ───────────────────────────────────

  it("on HTTP 404: no retry, console.error logged, timer cleared", async () => {
    client.heartbeat.mockRejectedValueOnce({
      statusCode: 404,
      message: "Session not found",
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    heartbeatMod.startAutoHeartbeat("KAN-2", client as any);

    await vi.advanceTimersByTimeAsync(120_500);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // Advance well past the retry window — the heartbeat should NOT fire again.
    await vi.advanceTimersByTimeAsync(120_000 * 3);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // No retry was scheduled.
    expect(errSpy).toHaveBeenCalled();
  });

  // ── (d) 401 → no retry, log + clear ───────────────────────────────────

  it("on HTTP 401: no retry, console.error logged, timer cleared", async () => {
    client.heartbeat.mockRejectedValueOnce({
      statusCode: 401,
      message: "Unauthorized",
    });
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(Math, "random").mockReturnValue(0.5);

    heartbeatMod.startAutoHeartbeat("KAN-3", client as any);

    await vi.advanceTimersByTimeAsync(120_500);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    // Advance well past — no retry, no second fire.
    await vi.advanceTimersByTimeAsync(120_000 * 3);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    expect(errSpy).toHaveBeenCalled();
  });
});
