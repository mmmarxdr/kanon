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
    releaseWork: vi.fn(),
    closeWork: vi.fn(),
  };
}

type FakeClient = ReturnType<typeof makeKanonClient>;

import * as heartbeatMod from "./heartbeat.js";

// ─── Shared setup / teardown ─────────────────────────────────────────────────

beforeEach(() => {
  vi.useFakeTimers();
  heartbeatMod.stopAllAutoHeartbeats();
  heartbeatMod.configureCaptureJournal(null);
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
    await heartbeatMod.noteActivity(["KAN-10"]);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("fires exactly one heartbeat when called after the debounce window", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-10", client as any);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(DEBOUNCE_MS);
    await heartbeatMod.noteActivity(["KAN-10"]);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(2);
  });

  it("updates lastBeatAt so a second immediate noteActivity does not double-fire", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue(undefined);

    heartbeatMod.startAutoHeartbeat("KAN-10", client as any);
    await vi.advanceTimersByTimeAsync(0);

    vi.advanceTimersByTime(DEBOUNCE_MS);
    await Promise.all([
      heartbeatMod.noteActivity(["KAN-10"]),
      heartbeatMod.noteActivity(["KAN-10"]),
    ]);
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
    await expect(heartbeatMod.noteActivity(["KAN-10"])).resolves.toBeUndefined();
  });
});

describe("transition adoption recovery", () => {
  it("retains a null-fence entry after a transient adoption failure and retries on exact activity", async () => {
    const client = makeKanonClient();
    client.heartbeat
      .mockRejectedValueOnce({ statusCode: 503, code: "WORK_CAPTURE_RETRYABLE" })
      .mockResolvedValueOnce({
        ok: true,
        captureIntent: {
          epoch: "550e8400-e29b-41d4-a716-446655440000",
          leaseGeneration: 1,
          state: "capturing",
        },
      });

    await expect(
      heartbeatMod.adoptCaptureByHeartbeat("KAN-243", client as any)
    ).rejects.toMatchObject({ statusCode: 503 });
    expect(heartbeatMod.getActiveIssueKeys()).toEqual(["KAN-243"]);

    await heartbeatMod.noteActivity(["KAN-243"]);

    expect(client.heartbeat).toHaveBeenCalledTimes(2);
    expect(client.heartbeat.mock.calls).toEqual([["KAN-243"], ["KAN-243"]]);
    expect(heartbeatMod.getActiveIssueKeys()).toEqual(["KAN-243"]);
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
    await heartbeatMod.noteActivity(["KAN-A", "KAN-B"]);
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
  it("on transient 5xx from compatible start adoption: retains the issue for later exact activity", async () => {
    const client = makeKanonClient();
    client.heartbeat
      .mockRejectedValueOnce({ statusCode: 503, message: "Service Unavailable" })
      .mockRejectedValueOnce({ statusCode: 503, message: "Still down" });

    vi.spyOn(console, "error").mockImplementation(() => {});

    heartbeatMod.startAutoHeartbeat("KAN-1", client as any);
    await vi.advanceTimersByTimeAsync(0);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-1");

    await heartbeatMod.noteActivity(["KAN-1"]);
    expect(client.heartbeat).toHaveBeenCalledTimes(2);
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-1");
  });

  it("on transient 5xx from compatible activity: waits for another exact activity", async () => {
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
    await heartbeatMod.noteActivity(["KAN-1"]);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(1_000);
    await vi.advanceTimersByTimeAsync(0);
    expect(client.heartbeat).toHaveBeenCalledTimes(2);
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-1");
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

  it("on HTTP 401: no retry and suspends the exact issue", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockRejectedValueOnce({ statusCode: 401, message: "Unauthorized" });
    vi.spyOn(console, "error").mockImplementation(() => {});

    heartbeatMod.startAutoHeartbeat("KAN-3", client as any);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-3");
    await heartbeatMod.noteActivity(["KAN-3"]);
    expect(client.heartbeat).toHaveBeenCalledTimes(1);
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
    const firstBeatPromise = new Promise<void>((_, rej) => {
      rejectFirst = rej;
    });

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

  it("a late durable success cannot overwrite the replacement fence", async () => {
    const oldFence = {
      epoch: "550e8400-e29b-41d4-a716-446655440000",
      leaseGeneration: 1,
      state: "capturing" as const,
    };
    const newFence = {
      epoch: "550e8400-e29b-41d4-a716-446655440010",
      leaseGeneration: 1,
      state: "capturing" as const,
    };
    let resolveOld!: (value: unknown) => void;
    const client = {
      ...makeKanonClient(),
      heartbeat: vi.fn().mockImplementation(
        () =>
          new Promise((resolve) => {
            resolveOld = resolve;
          })
      ),
      releaseWork: vi.fn().mockResolvedValue({
        ok: true,
        commandId: "550e8400-e29b-41d4-a716-446655440001",
        deliveryStatus: "acknowledged",
        captureIntent: { ...newFence, state: "adopted" },
      }),
    };
    heartbeatMod.startAutoHeartbeat("KAN-42", client as any, oldFence);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    const oldActivity = heartbeatMod.noteActivity(["KAN-42"]);
    await vi.advanceTimersByTimeAsync(0);

    heartbeatMod.stopAutoHeartbeat("KAN-42");
    heartbeatMod.startAutoHeartbeat("KAN-42", client as any, newFence);
    resolveOld({ ok: true, deliveryStatus: "acknowledged", captureIntent: oldFence });
    await oldActivity;
    await heartbeatMod.shutdownAllHeartbeats();

    expect(client.releaseWork).toHaveBeenCalledWith(
      "KAN-42",
      expect.objectContaining({ epoch: newFence.epoch }),
      expect.objectContaining({ beforeLegacyFallback: expect.any(Function) })
    );
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

  it("shutdownAllHeartbeats releases each fenced issue without close or DELETE", async () => {
    const client = makeKanonClient();
    const captureIntent = {
      epoch: "550e8400-e29b-41d4-a716-446655440000",
      leaseGeneration: 1,
      state: "capturing" as const,
    };
    client.releaseWork.mockResolvedValue({
      ok: true,
      commandId: "550e8400-e29b-41d4-a716-446655440001",
      deliveryStatus: "acknowledged",
      captureIntent: { ...captureIntent, state: "adopted" },
    });

    heartbeatMod.startAutoHeartbeat("KAN-X", client as any, captureIntent);

    await heartbeatMod.shutdownAllHeartbeats();

    expect(client.releaseWork).toHaveBeenCalledWith(
      "KAN-X",
      expect.objectContaining({
        epoch: captureIntent.epoch,
        leaseGeneration: 1,
      }),
      expect.objectContaining({ beforeLegacyFallback: expect.any(Function) })
    );
    expect(client.closeWork).not.toHaveBeenCalled();
    expect(client.stopWork).not.toHaveBeenCalled();
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
    const input = { issueKey: "KAN-1" };
    const returned = await wrapped(input, "arg2");

    expect(notifySpy).toHaveBeenCalledTimes(1);
    expect(originalHandler).toHaveBeenCalledTimes(1);
    expect(notifySpy).toHaveBeenCalledWith(["KAN-1"]);
    expect(originalHandler).toHaveBeenCalledWith(input, "arg2");
    expect(returned).toBe(result);
  });

  it("handler still runs and returns its value when noteActivity throws (error isolation)", async () => {
    const notifySpy = vi.fn().mockRejectedValue(new Error("noteActivity exploded"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const result = Symbol("handler-result");
    const originalHandler = vi.fn().mockResolvedValue(result);

    const wrapped = heartbeatMod.wrapHandlerWithActivity(originalHandler as any, notifySpy);

    // Must resolve, not reject — heartbeat error must never break the tool call
    const returned = await wrapped({ issueKey: "KAN-1" });

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
    const returned = await wrapped({ issueKey: "KAN-1" });

    expect(notifyStarted).toBe(true); // notify WAS invoked
    expect(originalHandler).toHaveBeenCalledTimes(1);
    expect(returned).toBe(result); // handler result returned without waiting
  });
});

describe("KAN-243 issue-scoped durable capture policy", () => {
  const DEBOUNCE_MS = 2 * 60 * 1000;
  const captureIntent = {
    epoch: "550e8400-e29b-41d4-a716-446655440000",
    leaseGeneration: 1,
    state: "capturing" as const,
  };

  it("beats only the exact issue named by activity", async () => {
    const clientA = makeKanonClient();
    const clientB = makeKanonClient();
    clientA.heartbeat.mockResolvedValue({ ok: true, captureIntent });
    clientB.heartbeat.mockResolvedValue({ ok: true, captureIntent });

    heartbeatMod.startAutoHeartbeat("KAN-A", clientA as any, captureIntent);
    heartbeatMod.startAutoHeartbeat("KAN-B", clientB as any, captureIntent);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await heartbeatMod.noteActivity(["KAN-A"]);

    expect(clientA.heartbeat).toHaveBeenCalledTimes(1);
    expect(clientB.heartbeat).not.toHaveBeenCalled();
  });

  it("does not report activity for tools without issue keys", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const handler = vi.fn().mockResolvedValue("ok");
    const wrapped = heartbeatMod.wrapHandlerWithActivity(handler, notify);

    await wrapped({ workspaceId: "workspace-1" });

    expect(notify).not.toHaveBeenCalled();
  });

  it("waits for an in-flight activity command before a lifecycle mutation on the same issue", async () => {
    let resolveActivity!: (value: unknown) => void;
    const client = makeKanonClient();
    client.heartbeat.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveActivity = resolve;
        })
    );
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, captureIntent);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    const activity = heartbeatMod.noteActivity(["KAN-1"]);
    await vi.advanceTimersByTimeAsync(0);

    const handler = vi.fn().mockResolvedValue("done");
    const wrapped = heartbeatMod.wrapHandlerWithActivity(handler, vi.fn(), {
      mode: "lifecycle-exclusive",
      issueKeyField: "issue_key",
    });
    const lifecycle = wrapped({ issue_key: "KAN-1" });
    await vi.advanceTimersByTimeAsync(0);
    expect(handler).not.toHaveBeenCalled();

    resolveActivity({ ok: true, deliveryStatus: "acknowledged", captureIntent });
    await activity;
    await expect(lifecycle).resolves.toBe("done");
  });

  it("reuses the byte-identical durable command after an ambiguous 503", async () => {
    const client = makeKanonClient();
    client.heartbeat
      .mockRejectedValueOnce({ statusCode: 503, code: "WORK_CAPTURE_RETRYABLE" })
      .mockResolvedValueOnce({ ok: true, deliveryStatus: "pending", captureIntent });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, captureIntent);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await heartbeatMod.noteActivity(["KAN-1"]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(client.heartbeat).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(client.heartbeat.mock.calls[0]?.[1])).toBe(
      JSON.stringify(client.heartbeat.mock.calls[1]?.[1])
    );
    expect(client.heartbeat.mock.calls[0]?.[1]).toMatchObject({
      epoch: captureIntent.epoch,
      leaseGeneration: captureIntent.leaseGeneration,
      commandId: expect.any(String),
      ownerId: heartbeatMod.getCaptureProcessOwnerId(),
    });
  });

  it("uses one process owner for activity and owner-scoped shutdown release", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue({ ok: true, deliveryStatus: "pending", captureIntent });
    client.releaseWork.mockResolvedValue({
      ok: true,
      deliveryStatus: "pending",
      captureIntent: { ...captureIntent, state: "adopted" },
    });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, captureIntent);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await heartbeatMod.noteActivity(["KAN-1"]);
    await heartbeatMod.shutdownAllHeartbeats();

    const ownerId = heartbeatMod.getCaptureProcessOwnerId();
    expect(ownerId).toMatch(/^[0-9a-f-]{36}$/);
    expect(client.heartbeat.mock.calls[0]?.[1]).toMatchObject({ ownerId });
    expect(client.releaseWork.mock.calls[0]?.[1]).toMatchObject({ ownerId });
  });

  it("accepts a 202/pending response as durable success without another retry", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue({
      ok: true,
      commandId: "550e8400-e29b-41d4-a716-446655440001",
      deliveryStatus: "pending",
      captureIntent,
    });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, captureIntent);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await heartbeatMod.noteActivity(["KAN-1"]);
    await vi.advanceTimersByTimeAsync(5_000);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
  });

  it("suspends an exact issue when the durable effect is blocked", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockRejectedValue({
      statusCode: 409,
      code: "CAPTURE_EFFECT_BLOCKED",
    });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, captureIntent);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await heartbeatMod.noteActivity(["KAN-1"]);
    await heartbeatMod.noteActivity(["KAN-1"]);

    expect(client.heartbeat).toHaveBeenCalledTimes(1);
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-1");
  });

  it("discards a stale command and readopts the fence on later exact activity", async () => {
    const replacement = { ...captureIntent, leaseGeneration: 2 };
    const client = makeKanonClient();
    client.heartbeat
      .mockRejectedValueOnce({
        statusCode: 409,
        code: "CAPTURE_EFFECT_STALE_FENCE",
      })
      .mockResolvedValueOnce({ ok: true, captureIntent: replacement });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, captureIntent);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS);
    await heartbeatMod.noteActivity(["KAN-1"]);
    await heartbeatMod.noteActivity(["KAN-1"]);

    expect(client.heartbeat).toHaveBeenCalledTimes(2);
    expect(client.heartbeat.mock.calls[0]?.[1]).toMatchObject({
      commandId: expect.any(String),
    });
    expect(client.heartbeat.mock.calls[1]).toEqual(["KAN-1"]);
  });

  it("releases tracked capture on shutdown and never closes or deletes it", async () => {
    const client = {
      ...makeKanonClient(),
      releaseWork: vi.fn().mockResolvedValue({
        ok: true,
        commandId: "550e8400-e29b-41d4-a716-446655440001",
        deliveryStatus: "acknowledged",
        captureIntent: { ...captureIntent, state: "adopted" },
      }),
      closeWork: vi.fn(),
    };
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, captureIntent);

    await heartbeatMod.shutdownAllHeartbeats();

    expect(client.releaseWork).toHaveBeenCalledOnce();
    expect(client.closeWork).not.toHaveBeenCalled();
    expect(client.stopWork).not.toHaveBeenCalled();
  });

  it("uses durable close with a fence and removes tracking only after 200/202 acceptance", async () => {
    const client = {
      ...makeKanonClient(),
      closeWork: vi.fn().mockResolvedValue({
        ok: true,
        commandId: "550e8400-e29b-41d4-a716-446655440001",
        deliveryStatus: "pending",
        captureIntent: { ...captureIntent, state: "closing" },
      }),
    };
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, captureIntent);

    await heartbeatMod.closeTrackedCapture("KAN-1", client as any);

    expect(client.closeWork).toHaveBeenCalledWith(
      "KAN-1",
      expect.objectContaining({
        commandId: expect.any(String),
        epoch: captureIntent.epoch,
        leaseGeneration: 1,
      }),
      expect.objectContaining({ beforeLegacyFallback: expect.any(Function) })
    );
    expect(client.stopWork).not.toHaveBeenCalled();
    expect(heartbeatMod.getActiveIssueKeys()).not.toContain("KAN-1");
  });

  it("preserves a fenced entry and the same close command after failed delivery", async () => {
    const client = {
      ...makeKanonClient(),
      closeWork: vi
        .fn()
        .mockRejectedValueOnce({ statusCode: 503, code: "WORK_CAPTURE_RETRYABLE" })
        .mockResolvedValueOnce({
          ok: true,
          commandId: "550e8400-e29b-41d4-a716-446655440001",
          deliveryStatus: "acknowledged",
          captureIntent: null,
        }),
    };
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, captureIntent);

    await expect(heartbeatMod.closeTrackedCapture("KAN-1", client as any)).rejects.toBeDefined();
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-1");
    await heartbeatMod.closeTrackedCapture("KAN-1", client as any);

    expect(JSON.stringify(client.closeWork.mock.calls[0]?.[1])).toBe(
      JSON.stringify(client.closeWork.mock.calls[1]?.[1])
    );
  });

  it("falls back to legacy DELETE only when no fence can be tracked", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue({ ok: true, captureIntent: null });
    client.stopWork.mockResolvedValue({ ok: true, deleted: true, workLog: null });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any);
    await vi.advanceTimersByTimeAsync(0);

    await heartbeatMod.closeTrackedCapture("KAN-1", client as any);

    expect(client.stopWork).toHaveBeenCalledWith("KAN-1");
    expect(client.closeWork).not.toHaveBeenCalled();
  });

  it("readopts a missing fence before durable shutdown release", async () => {
    const client = makeKanonClient();
    client.heartbeat.mockResolvedValue({ ok: true, captureIntent });
    client.releaseWork.mockResolvedValue({
      ok: true,
      commandId: "550e8400-e29b-41d4-a716-446655440001",
      deliveryStatus: "pending",
      captureIntent: { ...captureIntent, state: "adopted" },
    });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any);
    await vi.advanceTimersByTimeAsync(0);

    await heartbeatMod.shutdownAllHeartbeats();

    expect(client.heartbeat).toHaveBeenCalledWith("KAN-1");
    expect(client.releaseWork).toHaveBeenCalledOnce();
    expect(client.closeWork).not.toHaveBeenCalled();
    expect(client.stopWork).not.toHaveBeenCalled();
  });

  it("uses legacy DELETE after fence-less shutdown adoption and aggregates DELETE failure", async () => {
    const client = makeKanonClient();
    const deleteFailure = new Error("legacy DELETE failed");
    client.heartbeat.mockResolvedValue({ ok: true, captureIntent: null });
    client.stopWork.mockRejectedValue(deleteFailure);
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const typedClient = client as unknown as Parameters<typeof heartbeatMod.startAutoHeartbeat>[1];
    heartbeatMod.startAutoHeartbeat("KAN-1", typedClient);
    await vi.advanceTimersByTimeAsync(0);

    await heartbeatMod.shutdownAllHeartbeats();

    expect(client.heartbeat).toHaveBeenCalledTimes(2);
    expect(client.stopWork).toHaveBeenCalledOnce();
    expect(client.stopWork).toHaveBeenCalledWith("KAN-1");
    expect(client.releaseWork).not.toHaveBeenCalled();
    expect(client.closeWork).not.toHaveBeenCalled();
    expect(log).toHaveBeenCalledWith(
      "[heartbeat] Failed to release work session for KAN-1:",
      deleteFailure
    );
    expect(heartbeatMod.getActiveIssueKeys()).toEqual([]);
  });
});

describe("capture journal integration", () => {
  const scopeHash = "a".repeat(64);
  const journalCaptureIntent = {
    epoch: "550e8400-e29b-41d4-a716-446655440000",
    leaseGeneration: 1,
    state: "capturing" as const,
  };

  function fakeJournal() {
    let sequence = 0;
    return {
      append: vi.fn(async (record) => ({
        path: `/journal/${++sequence}.json`,
        fileName: `${sequence}.json`,
        record,
      })),
      remove: vi.fn().mockResolvedValue(undefined),
      hasClose: vi.fn().mockResolvedValue(false),
    };
  }

  afterEach(() => heartbeatMod.configureCaptureJournal(null));

  it("persists an activity signal before HTTP and reuses it byte-identically after response loss", async () => {
    const events: string[] = [];
    const journal = fakeJournal();
    journal.append.mockImplementation(async (record) => {
      events.push("persist");
      return { path: "/journal/activity.json", fileName: "activity.json", record };
    });
    const client = makeKanonClient();
    client.heartbeat
      .mockImplementationOnce(async () => {
        events.push("http-1");
        throw { statusCode: 503, code: "WORK_CAPTURE_RETRYABLE" };
      })
      .mockImplementationOnce(async () => {
        events.push("http-2");
        return { ok: true, deliveryStatus: "pending", captureIntent: journalCaptureIntent };
      });
    heartbeatMod.configureCaptureJournal({ journal: journal as any, scopeHash });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, journalCaptureIntent);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await heartbeatMod.noteActivity(["KAN-1"]);
    await vi.advanceTimersByTimeAsync(1_000);

    expect(events).toEqual(["persist", "http-1", "http-2"]);
    expect(journal.append).toHaveBeenCalledTimes(1);
    expect(journal.append).toHaveBeenCalledWith(
      expect.objectContaining({
        version: 3,
        command: expect.objectContaining({ ownerId: heartbeatMod.getCaptureProcessOwnerId() }),
      })
    );
    expect(client.heartbeat.mock.calls[0]?.[1]).toEqual(client.heartbeat.mock.calls[1]?.[1]);
    expect(journal.remove).toHaveBeenCalledTimes(1);
  });

  it("retains an immutable signal byte-identically on 401", async () => {
    const journal = fakeJournal();
    const client = makeKanonClient();
    client.heartbeat.mockRejectedValueOnce({ statusCode: 401, code: "UNAUTHORIZED" });
    heartbeatMod.configureCaptureJournal({ journal: journal as any, scopeHash });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, journalCaptureIntent);
    await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
    await heartbeatMod.noteActivity(["KAN-1"]);

    expect(journal.remove).not.toHaveBeenCalled();
    expect(heartbeatMod.getActiveIssueKeys()).toContain("KAN-1");
  });

  it.each([
    ["activity", { statusCode: 404 }],
    ["release", { statusCode: 404, code: "API_ERROR" }],
    ["close", { statusCode: 404, code: "API_ERROR" }],
  ] as const)(
    "retains the %s signal when an old route returns a generic 404",
    async (kind, error) => {
      const journal = fakeJournal();
      const client = makeKanonClient();
      const typedJournal = journal as unknown as NonNullable<
        Parameters<typeof heartbeatMod.configureCaptureJournal>[0]
      >["journal"];
      const typedClient = client as unknown as Parameters<
        typeof heartbeatMod.startAutoHeartbeat
      >[1];
      vi.spyOn(console, "error").mockImplementation(() => {});
      heartbeatMod.configureCaptureJournal({ journal: typedJournal, scopeHash });
      heartbeatMod.startAutoHeartbeat("KAN-1", typedClient, journalCaptureIntent);

      if (kind === "activity") {
        client.heartbeat.mockRejectedValueOnce(error);
        await vi.advanceTimersByTimeAsync(2 * 60 * 1000);
        await heartbeatMod.noteActivity(["KAN-1"]);
      } else if (kind === "release") {
        client.releaseWork.mockRejectedValueOnce(error);
        await heartbeatMod.shutdownAllHeartbeats();
      } else {
        client.closeWork.mockRejectedValueOnce(error);
        await expect(heartbeatMod.closeTrackedCapture("KAN-1", typedClient)).rejects.toBe(error);
      }

      expect(journal.append).toHaveBeenCalledWith(expect.objectContaining({ kind }));
      expect(journal.remove).not.toHaveBeenCalled();
    }
  );

  it("persists close before I/O and an existing close blocks shutdown release", async () => {
    const events: string[] = [];
    const journal = fakeJournal();
    journal.append.mockImplementation(async (record) => {
      events.push(`persist-${record.kind}`);
      return { path: `/journal/${record.kind}.json`, fileName: `${record.kind}.json`, record };
    });
    journal.hasClose.mockResolvedValue(true);
    const client = {
      ...makeKanonClient(),
      closeWork: vi.fn(async () => {
        events.push("close-http");
        throw { statusCode: 503, code: "WORK_CAPTURE_RETRYABLE" };
      }),
    };
    heartbeatMod.configureCaptureJournal({ journal: journal as any, scopeHash });
    heartbeatMod.startAutoHeartbeat("KAN-1", client as any, journalCaptureIntent);

    await expect(heartbeatMod.closeTrackedCapture("KAN-1", client as any)).rejects.toBeDefined();
    await heartbeatMod.shutdownAllHeartbeats();

    expect(events).toEqual(["persist-close", "close-http"]);
    expect(client.releaseWork).not.toHaveBeenCalled();
  });
});
