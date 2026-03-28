import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  BridgeSyncService,
  type SyncEvent,
  type ForcePollResult,
} from "../services/bridge-sync-service.js";
import type { EngramObservation } from "@kanon/bridge";

// ─── Mock EngramClient ────────────────────────────────────────────────────

function createMockEngramClient() {
  return {
    listRecentSince: vi.fn<
      [string, string | undefined],
      Promise<EngramObservation[]>
    >(),
    listRecent: vi.fn(),
    createObservation: vi.fn(),
    updateObservation: vi.fn(),
    healthCheck: vi.fn(),
    getObservation: vi.fn(),
    search: vi.fn(),
  };
}

function makeObservation(
  overrides: Partial<EngramObservation> = {},
): EngramObservation {
  return {
    id: 1,
    sync_id: "sync-1",
    session_id: "sess-1",
    type: "architecture",
    title: "Test obs",
    content: "content",
    project: "kanon",
    scope: "project",
    revision_count: 1,
    duplicate_count: 0,
    last_seen_at: "2026-03-22T10:00:00.000Z",
    created_at: "2026-03-22T10:00:00.000Z",
    updated_at: "2026-03-22T10:00:00.000Z",
    ...overrides,
  };
}

/** Flush pending microtasks (resolved promises) without advancing timers. */
async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((r) => queueMicrotask(r));
  // Double-flush for chained .then()
  await new Promise<void>((r) => queueMicrotask(r));
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe("BridgeSyncService", () => {
  let mockClient: ReturnType<typeof createMockEngramClient>;
  let service: BridgeSyncService;

  beforeEach(() => {
    // Set fake time to a known past date so observation timestamps can be "after"
    vi.useFakeTimers({ now: new Date("2026-01-01T00:00:00.000Z") });
    mockClient = createMockEngramClient();
    service = new BridgeSyncService(mockClient as any, {
      pollIntervalMs: 15000,
      projectKey: "kanon",
    });
  });

  afterEach(() => {
    service.stop();
    vi.useRealTimers();
  });

  // ── Emit sync_complete when changes detected ──────────────────────────

  it("emits 'sync_complete' when EngramClient returns new observations", async () => {
    const obs = makeObservation({
      id: 42,
      updated_at: "2026-03-22T12:00:00.000Z",
    });
    mockClient.listRecentSince.mockResolvedValue([obs]);

    const handler = vi.fn<[SyncEvent], void>();
    service.on("sync_complete", handler);

    service.start();
    // The initial poll is `void this.poll()` — await its resolved promise
    await flushMicrotasks();

    expect(handler).toHaveBeenCalledOnce();
    expect(handler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sync_complete",
        projectKey: "kanon",
        changedCount: 1,
      }),
    );
  });

  // ── Does NOT emit when no changes ─────────────────────────────────────

  it("does NOT emit sync_complete when no changes detected (empty result)", async () => {
    mockClient.listRecentSince.mockResolvedValue([]);

    const syncHandler = vi.fn();
    const heartbeatHandler = vi.fn();
    service.on("sync_complete", syncHandler);
    service.on("heartbeat", heartbeatHandler);

    service.start();
    await flushMicrotasks();

    expect(syncHandler).not.toHaveBeenCalled();
    expect(heartbeatHandler).toHaveBeenCalledOnce();
    expect(heartbeatHandler).toHaveBeenCalledWith(
      expect.objectContaining({ type: "heartbeat" }),
    );
  });

  // ── High-water mark advances after successful poll with changes ───────

  it("high-water mark advances after successful poll with changes", async () => {
    const laterTimestamp = "2026-03-22T15:00:00.000Z";
    const obs = makeObservation({ updated_at: laterTimestamp });
    mockClient.listRecentSince.mockResolvedValue([obs]);

    const initialMark = service.getHighWaterMark();

    service.start();
    await flushMicrotasks();

    expect(service.getHighWaterMark()).toBe(laterTimestamp);
    expect(service.getHighWaterMark()).not.toBe(initialMark);
  });

  // ── High-water mark does NOT advance on error ─────────────────────────

  it("high-water mark does NOT advance on error", async () => {
    mockClient.listRecentSince.mockRejectedValue(new Error("Network down"));

    const initialMark = service.getHighWaterMark();

    service.start();
    await flushMicrotasks();

    expect(service.getHighWaterMark()).toBe(initialMark);
  });

  // ── Emits sync_error on EngramClient failure, continues polling ───────

  it("emits 'sync_error' on EngramClient failure and continues polling", async () => {
    mockClient.listRecentSince
      .mockRejectedValueOnce(new Error("Timeout"))
      .mockResolvedValueOnce([]);

    const errorHandler = vi.fn<[SyncEvent], void>();
    service.on("sync_error", errorHandler);

    service.start();
    // First poll — error
    await flushMicrotasks();

    expect(errorHandler).toHaveBeenCalledOnce();
    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "sync_error",
        message: "Timeout",
      }),
    );

    // Status should revert to "polling" so next interval fires
    expect(service.getStatus()).toBe("polling");

    // Advance to next interval — should succeed without error
    const heartbeatHandler = vi.fn();
    service.on("heartbeat", heartbeatHandler);

    vi.advanceTimersByTime(15000);
    await flushMicrotasks();

    expect(heartbeatHandler).toHaveBeenCalledOnce();
  });

  // ── start()/stop() lifecycle ──────────────────────────────────────────

  it("start()/stop() lifecycle works correctly", async () => {
    mockClient.listRecentSince.mockResolvedValue([]);

    expect(service.getStatus()).toBe("idle");

    service.start();
    // status is "syncing" because initial poll is in-flight
    // (or "polling" if setStatus runs before the await)
    // Actually start() sets status to "polling", then calls poll() which sets "syncing"
    // But poll() is async and status changes happen synchronously before await
    await flushMicrotasks();
    expect(service.getStatus()).toBe("polling");

    service.stop();
    expect(service.getStatus()).toBe("idle");

    // After stop, no more polls should fire
    mockClient.listRecentSince.mockClear();
    vi.advanceTimersByTime(30000);
    await flushMicrotasks();
    expect(mockClient.listRecentSince).not.toHaveBeenCalled();
  });

  it("start() is a no-op when already started", async () => {
    mockClient.listRecentSince.mockResolvedValue([]);

    service.start();
    await flushMicrotasks();

    mockClient.listRecentSince.mockClear();
    service.start(); // second start — should be no-op

    // Only the interval poll should fire, not a duplicate initial poll
    vi.advanceTimersByTime(15000);
    await flushMicrotasks();
    expect(mockClient.listRecentSince).toHaveBeenCalledTimes(1);
  });

  // ── Guards against overlapping polls ──────────────────────────────────

  it("guards against overlapping polls", async () => {
    // Make the first poll hang for a long time
    let resolveFirst!: (value: EngramObservation[]) => void;
    const firstPollPromise = new Promise<EngramObservation[]>((resolve) => {
      resolveFirst = resolve;
    });

    mockClient.listRecentSince
      .mockReturnValueOnce(firstPollPromise)
      .mockResolvedValue([]);

    service.start();
    // First poll is in-flight (hasn't resolved)

    // Advance past one interval — should trigger second poll attempt
    vi.advanceTimersByTime(15000);
    await flushMicrotasks();

    // The second call should have been skipped due to overlap guard
    expect(mockClient.listRecentSince).toHaveBeenCalledTimes(1);

    // Resolve the first poll
    resolveFirst([]);
    await flushMicrotasks();

    // Now the next interval should be allowed to proceed
    vi.advanceTimersByTime(15000);
    await flushMicrotasks();
    // 1 (initial) + 1 (after resolve, next interval)
    expect(mockClient.listRecentSince).toHaveBeenCalledTimes(2);
  });

  // ── forcePoll() ─────────────────────────────────────────────────────────

  describe("forcePoll()", () => {
    it("triggers an immediate poll and returns triggered: true", async () => {
      mockClient.listRecentSince.mockResolvedValue([]);

      const handler = vi.fn<[SyncEvent], void>();
      service.on("heartbeat", handler);

      const result = await service.forcePoll();

      expect(result.triggered).toBe(true);
      expect(result.retryAfterMs).toBeUndefined();
      expect(handler).toHaveBeenCalledOnce();
    });

    it("returns cooldown when called within 10 seconds", async () => {
      mockClient.listRecentSince.mockResolvedValue([]);

      // First call — should succeed
      const first = await service.forcePoll();
      expect(first.triggered).toBe(true);

      // Second call immediately — should be rejected with cooldown
      const second = await service.forcePoll();
      expect(second.triggered).toBe(false);
      expect(second.retryAfterMs).toBeGreaterThan(0);
      expect(second.retryAfterMs).toBeLessThanOrEqual(10000);
    });

    it("succeeds after cooldown expires", async () => {
      mockClient.listRecentSince.mockResolvedValue([]);

      const first = await service.forcePoll();
      expect(first.triggered).toBe(true);

      // Advance past cooldown
      vi.advanceTimersByTime(10_001);

      const second = await service.forcePoll();
      expect(second.triggered).toBe(true);
    });

    it("returns retryAfterMs when poll is in progress", async () => {
      // Make poll hang
      let resolveHanging!: (value: EngramObservation[]) => void;
      const hangingPromise = new Promise<EngramObservation[]>((resolve) => {
        resolveHanging = resolve;
      });
      mockClient.listRecentSince.mockReturnValue(hangingPromise);

      // Start a regular poll
      service.start();

      // Now try forcePoll while the initial poll is in-flight
      const result = await service.forcePoll();
      expect(result.triggered).toBe(false);
      expect(result.retryAfterMs).toBe(1000);

      // Cleanup
      resolveHanging([]);
      await flushMicrotasks();
    });

    it("isOnCooldown() returns correct state", async () => {
      mockClient.listRecentSince.mockResolvedValue([]);

      expect(service.isOnCooldown()).toBe(false);

      await service.forcePoll();
      expect(service.isOnCooldown()).toBe(true);

      vi.advanceTimersByTime(10_001);
      expect(service.isOnCooldown()).toBe(false);
    });
  });
});
