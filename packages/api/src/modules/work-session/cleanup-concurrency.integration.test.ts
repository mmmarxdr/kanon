/**
 * work-session-resilience (Slice A) — Phase 2
 *
 * The API cleanup scheduler in `app.ts` must execute non-overlapping:
 *
 *   (a) while a cleanup is in flight, the next scheduled tick is SKIPPED
 *       (the `running` flag is true);
 *   (b) when the in-flight run finishes, the `running` flag flips back
 *       to false in `finally`, and a fresh tick is scheduled;
 *   (c) when the app closes (`onClose`), the pending tick is cleared so
 *       no cleanup runs after shutdown begins.
 *
 * This file uses `vi.mock` to inject a controllable `cleanupExpired`
 * stub and `vi.useFakeTimers()` to drive the scheduler deterministically.
 * The test calls `buildApp()` (real `addHook('onReady')` and
 * `addHook('onClose')` wiring) and asserts against the stub's call count.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
// Set env vars BEFORE importing app.js — env.ts validates at module load time.
process.env["COOKIE_SECRET"] =
  process.env["COOKIE_SECRET"] ?? "test-cookie-secret-at-least-32-chars-long";
import { buildApp } from "../../app.js";

// ── Mocks ────────────────────────────────────────────────────────────────────

/**
 * Controllable stub for cleanupExpired. `run` resolves the in-flight
 * promise the test awaits; `resolveRun` causes the in-flight promise to
 * actually settle.
 */
const cleanupMock = {
  inFlight: null as Promise<void> | null,
  resolveRun: null as (() => void) | null,
  calls: 0,
};

vi.mock("./service.js", () => ({
  cleanupExpired: vi.fn((_logger?: unknown) => {
    cleanupMock.calls++;
    cleanupMock.inFlight = new Promise<void>((resolve) => {
      cleanupMock.resolveRun = () => resolve();
    });
    return cleanupMock.inFlight;
  }),
  // Other exports must be present so module-level imports of work-session
  // service by other modules don't crash if they're pulled in transitively.
  startWork: vi.fn(),
  stopWork: vi.fn(),
  heartbeat: vi.fn(),
  getActiveWorkers: vi.fn(),
  getActiveWorkersForIssues: vi.fn(),
  recordInterruption: vi.fn(),
  drainTransitionLifecycleEffects: vi.fn().mockResolvedValue(undefined),
  TRANSITION_EFFECT_RECOVERY_INTERVAL_MS: 30_000,
}));

const CLEANUP_INTERVAL_MS = 60_000;

describe("app.ts — cleanup scheduler non-overlap (Slice A, Phase 2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    cleanupMock.inFlight = null;
    cleanupMock.resolveRun = null;
    cleanupMock.calls = 0;
  });

  afterEach(async () => {
    vi.useRealTimers();
  });

  it("schedules the first cleanup tick on onReady", async () => {
    const app = await buildApp();
    await app.ready();

    // The first tick fires after CLEANUP_INTERVAL_MS; advance and let it run.
    expect(cleanupMock.calls).toBe(0);
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
    expect(cleanupMock.calls).toBe(1);

    // Let the in-flight promise settle so the app can close cleanly.
    cleanupMock.resolveRun?.();
    await cleanupMock.inFlight;
    await app.close();
  });

  it("skips the next tick while a previous cleanup is in flight (no overlap)", async () => {
    const app = await buildApp();
    await app.ready();

    // First tick: fire and HOLD (don't resolve yet).
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
    expect(cleanupMock.calls).toBe(1);

    // Advance another full interval — the second tick should be SKIPPED
    // (running flag is true) and the third one should still be pending.
    // The scheduler still has to re-arm so cleanupMock.calls stays at 1.
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
    expect(cleanupMock.calls).toBe(1);

    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
    expect(cleanupMock.calls).toBe(1);

    // Resolve the in-flight run; the scheduler's `.finally` must flip
    // `running` back to false and schedule the NEXT tick.
    cleanupMock.resolveRun?.();
    await cleanupMock.inFlight;

    // The next tick fires at CLEANUP_INTERVAL_MS after the previous one
    // re-armed in `.finally`.
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
    expect(cleanupMock.calls).toBe(2);

    // Settle the second run.
    cleanupMock.resolveRun?.();
    await cleanupMock.inFlight;

    await app.close();
  });

  it("running flag flips back to false after the in-flight run completes", async () => {
    const app = await buildApp();
    await app.ready();

    // Fire the first tick; hold it.
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
    expect(cleanupMock.calls).toBe(1);

    // Resolve and let the scheduler's `.finally` run.
    cleanupMock.resolveRun?.();
    await cleanupMock.inFlight;

    // After settling, the next tick is re-armed. If the running flag
    // were still true, this next tick would be skipped — assert that it
    // actually runs.
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS);
    expect(cleanupMock.calls).toBe(2);

    cleanupMock.resolveRun?.();
    await cleanupMock.inFlight;
    await app.close();
  });

  it("onClose clears the pending timer (no cleanup runs after shutdown)", async () => {
    const app = await buildApp();
    await app.ready();

    // The first tick is scheduled but has NOT fired yet.
    expect(cleanupMock.calls).toBe(0);

    // Close the app BEFORE advancing the timer.
    await app.close();

    // Advance well past the interval — no cleanup should have run.
    await vi.advanceTimersByTimeAsync(CLEANUP_INTERVAL_MS * 5);
    expect(cleanupMock.calls).toBe(0);
  });
});
