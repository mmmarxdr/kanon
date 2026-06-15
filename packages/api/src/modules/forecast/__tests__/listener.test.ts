/**
 * Unit tests for registerForecastListener — Phase 8 / KAN-102 PR2.
 *
 * All DB and service calls are mocked; no real Postgres connection needed.
 * vi.useFakeTimers() controls debounce timing.
 *
 * Scenarios:
 *   L1  N events for one project → exactly 1 rebuild fires after debounce window
 *   L2  2 projects receive events → each debounced independently (2 rebuilds)
 *   L3  A rejected rebuildProjectForecast promise is caught (no unhandled rejection)
 *   L4  unsubscribe() clears pending timers → no rebuild fires after unsubscribe
 *   L5  time-entry.approved with null issueId → skip (no rebuild)
 *   L6  ppm.forecast.updated events → ignored (no infinite self-trigger)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks (must be declared before any imports from the module under test) ───

// Mock prisma so we can control projectId resolution without a DB.
vi.mock("../../../config/prisma.js", () => ({
  prisma: {
    issue: {
      findUnique: vi.fn(),
    },
  },
}));

// Mock rebuildProjectForecast so we can spy without triggering real service I/O.
vi.mock("../service.js", () => ({
  rebuildProjectForecast: vi.fn(),
}));

import { prisma } from "../../../config/prisma.js";
import { rebuildProjectForecast } from "../service.js";
import { registerForecastListener } from "../listener.js";
import type { IEventBus } from "../../../services/event-bus/interface.js";
import type { DomainEvent } from "../../../services/event-bus/types.js";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const mockIssueFindUnique = vi.mocked(prisma.issue.findUnique);
const mockRebuild = vi.mocked(rebuildProjectForecast);

/**
 * Minimal in-process event bus stub.
 * Stores the subscribed handler so tests can fire events directly.
 */
function makeStubBus(): IEventBus & { fire: (event: Partial<DomainEvent>) => void } {
  let handler: ((event: DomainEvent) => void) | null = null;
  let unsubscribeFn: (() => void) | null = null;

  return {
    emit: vi.fn(),
    subscribe(h, _name) {
      handler = h;
      const unsub = () => {
        handler = null;
      };
      unsubscribeFn = unsub;
      return unsub;
    },
    subscribeToWorkspace: vi.fn().mockReturnValue(() => {}),
    getEventsSince: vi.fn().mockReturnValue([]),
    fire(event: Partial<DomainEvent>) {
      if (handler) {
        handler({
          id: 1,
          type: "schedule.updated",
          workspaceId: "ws-1",
          actorId: "actor-1",
          payload: {},
          timestamp: new Date().toISOString(),
          ...event,
        } as DomainEvent);
      }
    },
  };
}

/** Minimal logger stub */
const stubLogger = {
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
};

/** Build a schedule.updated event for a given issueId */
function makeScheduleUpdatedEvent(issueId: string): Partial<DomainEvent> {
  return {
    type: "schedule.updated",
    payload: { issueId, progress: 50 },
  };
}

/** Build a worklog.created event for a given issueId */
function makeWorklogCreatedEvent(issueId: string): Partial<DomainEvent> {
  return {
    type: "worklog.created",
    payload: { workLogId: "wl-1", issueId, workspaceId: "ws-1" },
  };
}

/** Build a dependency.changed event for a given sourceIssueId */
function makeDependencyChangedEvent(sourceIssueId: string): Partial<DomainEvent> {
  return {
    type: "dependency.changed",
    payload: { sourceIssueId, targetIssueId: "tgt-1", action: "created" },
  };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

const DEBOUNCE_MS = 3000; // env default, set via vi.stubEnv below

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  // Default: issue resolves to project-A
  mockIssueFindUnique.mockResolvedValue({ projectId: "project-A" } as never);
  // Default: rebuild resolves OK
  mockRebuild.mockResolvedValue({ issueCount: 1, criticalCount: 0, worstSlipDays: 0 } as never);
});

afterEach(() => {
  vi.useRealTimers();
});

// ─── L1: N events → 1 rebuild after debounce window ─────────────────────────

describe("L1 — trailing debounce: N events for one project → exactly 1 rebuild", () => {
  it("fires rebuild exactly once after 5 events for the same project within the window", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    // Emit 5 schedule.updated events within the debounce window
    for (let i = 0; i < 5; i++) {
      bus.fire(makeScheduleUpdatedEvent("issue-1"));
    }

    // Advance to just before the debounce window expires → rebuild not yet called
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(mockRebuild).not.toHaveBeenCalled();

    // Advance past the debounce window → rebuild fires exactly once
    await vi.advanceTimersByTimeAsync(1);
    expect(mockRebuild).toHaveBeenCalledTimes(1);
    expect(mockRebuild).toHaveBeenCalledWith("project-A");

    unsub();
  });

  it("resets the debounce timer when a new event arrives before the window expires", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeScheduleUpdatedEvent("issue-1"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 500);

    // New event resets the timer
    bus.fire(makeScheduleUpdatedEvent("issue-1"));
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);

    // Still not fired — the second event reset the window
    expect(mockRebuild).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    expect(mockRebuild).toHaveBeenCalledTimes(1);

    unsub();
  });
});

// ─── L2: 2 projects are debounced independently ──────────────────────────────

describe("L2 — per-project isolation: 2 projects each get their own debounce", () => {
  it("fires 2 independent rebuilds when events for 2 different projects arrive", async () => {
    const bus = makeStubBus();

    // issue-1 → project-A, issue-2 → project-B
    mockIssueFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "issue-1") return { projectId: "project-A" } as never;
      if (where.id === "issue-2") return { projectId: "project-B" } as never;
      return null as never;
    });

    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeScheduleUpdatedEvent("issue-1"));
    bus.fire(makeScheduleUpdatedEvent("issue-2"));
    bus.fire(makeScheduleUpdatedEvent("issue-1")); // additional event for project-A

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    // Both projects should have been rebuilt exactly once
    expect(mockRebuild).toHaveBeenCalledTimes(2);
    expect(mockRebuild).toHaveBeenCalledWith("project-A");
    expect(mockRebuild).toHaveBeenCalledWith("project-B");

    unsub();
  });
});

// ─── L3: rejected rebuild is caught (no unhandled rejection) ─────────────────

describe("L3 — rejection safety: a failing rebuild must not produce an unhandled rejection", () => {
  it("catches a rejected rebuild and does not rethrow", async () => {
    const bus = makeStubBus();
    const error = new Error("forecast engine exploded");
    mockRebuild.mockRejectedValueOnce(error);

    const unsub = registerForecastListener(bus, stubLogger);
    bus.fire(makeScheduleUpdatedEvent("issue-1"));

    // Should not throw even though rebuild rejects — just advance time
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    // Rebuild was called (and errored), but it was caught
    expect(mockRebuild).toHaveBeenCalledTimes(1);

    unsub();
  });

  it("logs the error when rebuild rejects", async () => {
    const bus = makeStubBus();
    const error = new Error("db timeout");
    mockRebuild.mockRejectedValueOnce(error);

    const unsub = registerForecastListener(bus, stubLogger);
    bus.fire(makeScheduleUpdatedEvent("issue-1"));

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(stubLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ err: error, projectId: "project-A" }),
      expect.stringContaining("forecast rebuild failed")
    );

    unsub();
  });
});

// ─── L4: unsubscribe clears pending timers ────────────────────────────────────

describe("L4 — unsubscribe: clears all pending timers; no rebuild fires after unsubscribe", () => {
  it("does not fire rebuild after unsubscribe is called mid-debounce", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeScheduleUpdatedEvent("issue-1"));

    // Unsubscribe before the debounce window expires
    unsub();

    // Advance well past the window — rebuild must NOT fire
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);

    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("does not fire rebuild for any pending project after unsubscribe", async () => {
    const bus = makeStubBus();

    mockIssueFindUnique.mockImplementation(async ({ where }: { where: { id: string } }) => {
      if (where.id === "issue-1") return { projectId: "project-A" } as never;
      if (where.id === "issue-2") return { projectId: "project-B" } as never;
      return null as never;
    });

    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeScheduleUpdatedEvent("issue-1"));
    bus.fire(makeScheduleUpdatedEvent("issue-2"));

    // Unsubscribe with 2 pending timers
    unsub();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);

    expect(mockRebuild).not.toHaveBeenCalled();
  });
});

// ─── L5: time-entry.approved with null issueId → skip ────────────────────────

describe("L5 — null issueId on time-entry.approved → skip (no rebuild)", () => {
  it("ignores time-entry.approved events with null issueId", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire({
      type: "time-entry.approved",
      payload: { entryId: "te-1", issueId: null, approvedAt: new Date().toISOString() },
    });

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);

    expect(mockRebuild).not.toHaveBeenCalled();

    unsub();
  });

  it("fires rebuild for time-entry.approved with a valid non-null issueId", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire({
      type: "time-entry.approved",
      payload: { entryId: "te-1", issueId: "issue-1", approvedAt: new Date().toISOString() },
    });

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(mockRebuild).toHaveBeenCalledWith("project-A");

    unsub();
  });
});

// ─── L6: ppm.forecast.updated → ignored ──────────────────────────────────────

describe("L6 — ppm.forecast.updated is ignored (no self-trigger loop)", () => {
  it("does not schedule any rebuild when ppm.forecast.updated is received", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire({
      type: "ppm.forecast.updated",
      payload: { projectId: "project-A", issueCount: 3, criticalCount: 1, worstSlipDays: 2 },
    });

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);

    expect(mockRebuild).not.toHaveBeenCalled();

    unsub();
  });
});

// ─── L7: unresolvable issueId → skip ─────────────────────────────────────────

describe("L7 — unresolvable issueId → skip (issue not found in DB)", () => {
  it("does not schedule a rebuild when prisma returns null for the issue", async () => {
    const bus = makeStubBus();
    mockIssueFindUnique.mockResolvedValue(null as never);

    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeScheduleUpdatedEvent("unknown-issue"));

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);

    expect(mockRebuild).not.toHaveBeenCalled();

    unsub();
  });
});

// ─── L8: issue.transitioned triggers a rebuild (state change → forecast) ──────

describe("L8 — issue.transitioned triggers a rebuild (state change affects forecastEnd)", () => {
  it("fires rebuild when an issue transitions state (e.g. → done)", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    // A transition to done changes state + completedAt, which the engine uses to
    // pin forecastEnd (engine.forecastEndFor). It MUST trigger a rebuild.
    bus.fire({
      type: "issue.transitioned",
      payload: {
        issueKey: "KAN-1",
        issueId: "issue-1",
        projectKey: "KAN",
        from: "in_progress",
        to: "done",
      },
    });

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(mockRebuild).toHaveBeenCalledTimes(1);
    expect(mockRebuild).toHaveBeenCalledWith("project-A");

    unsub();
  });
});

// ─── L9: dependency.changed triggers a rebuild (via sourceIssueId) ────────────

describe("L9 — dependency.changed triggers a rebuild (resolved via sourceIssueId)", () => {
  it("fires rebuild when a dependency is created/removed", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    // dependency.changed carries sourceIssueId (not issueId) — the source issue
    // always belongs to the project. A dependency edit changes the schedule graph,
    // so it MUST trigger a rebuild. Guards against a silent break if the emit
    // payload field is ever renamed.
    bus.fire(makeDependencyChangedEvent("issue-1"));

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(mockRebuild).toHaveBeenCalledTimes(1);
    expect(mockRebuild).toHaveBeenCalledWith("project-A");

    unsub();
  });
});

// ─── L10: worklog.created triggers a rebuild ─────────────────────────────────
// Kills survivors at listener.ts:177/179 (worklog.created switch arm + p.issueId ?? null).

/** Build an estimate.revised event for a given issueId */
function makeEstimateRevisedEvent(issueId: string): Partial<DomainEvent> {
  return {
    type: "estimate.revised",
    payload: { issueId, revisionId: "rev-1", hours: "8" },
  };
}

describe("L10 — worklog.created triggers a rebuild", () => {
  it("fires rebuild when worklog.created is received for an issue", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeWorklogCreatedEvent("issue-1"));

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(mockRebuild).toHaveBeenCalledTimes(1);
    expect(mockRebuild).toHaveBeenCalledWith("project-A");

    unsub();
  });
});

// ─── L11: estimate.revised triggers a rebuild ────────────────────────────────
// Kills survivors at listener.ts:171/173 (estimate.revised switch arm + p.issueId ?? null).

describe("L11 — estimate.revised triggers a rebuild", () => {
  it("fires rebuild when estimate.revised is received for an issue", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeEstimateRevisedEvent("issue-1"));

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(mockRebuild).toHaveBeenCalledTimes(1);
    expect(mockRebuild).toHaveBeenCalledWith("project-A");

    unsub();
  });
});

// ─── L4b: unsubscribe clears a PENDING timer (clearTimeout path) ─────────────
// The original L4 never gets the timer set before calling unsub() because
// handleEvent is still pending on the microtask queue. This test flushes
// microtasks first so scheduleRebuild runs and sets the timer BEFORE unsub().
//
// Mutation gate: if the clearTimeout(handle) call in unsubscribe() is removed,
// the timer fires and mockRebuild IS called → test FAILS. Verified manually
// by the RED → GREEN cycle below.

describe("L4b — unsubscribe clears a timer that was already scheduled (clearTimeout path)", () => {
  it("does not fire rebuild when timer is already set and unsubscribe() clears it", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeScheduleUpdatedEvent("issue-1"));

    // Flush microtasks so handleEvent's await resolveProjectIdFromIssue() resolves
    // and scheduleRebuild() executes → timer is NOW set in the timers Map.
    await vi.advanceTimersByTimeAsync(0);

    // At this point the debounce timer is pending. Unsubscribe must clearTimeout it.
    unsub();

    // Advance well past the debounce window — rebuild must NOT fire (timer was cleared).
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);

    expect(mockRebuild).not.toHaveBeenCalled();
  });

  it("active-flag path: unsubscribe BEFORE handleEvent resolves still prevents rebuild", async () => {
    // Original L4 scenario: unsub() called synchronously after bus.fire() while
    // handleEvent is still awaiting the DB lookup. active=false prevents
    // scheduleRebuild from setting any timer. This verifies the active-flag guard.
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeScheduleUpdatedEvent("issue-1"));
    // Unsubscribe BEFORE any microtasks flush → active=false before scheduleRebuild runs.
    unsub();

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);

    expect(mockRebuild).not.toHaveBeenCalled();
  });
});

// ─── L12: outer-catch (handler failed) kills survivors 239/241/242 ───────────
// When resolveProjectIdFromIssue() throws, handleEvent() propagates the error
// and the outer .catch() on the bus.subscribe callback logs "forecast listener
// event handler failed". Verifies the catch path and that no rebuild fires.

describe("L12 — outer-catch: bus handler logs 'forecast listener event handler failed' on DB error", () => {
  it("logs the handler-failed message when resolveProjectIdFromIssue rejects", async () => {
    const bus = makeStubBus();
    mockIssueFindUnique.mockRejectedValueOnce(new Error("db down"));

    const unsub = registerForecastListener(bus, stubLogger);
    bus.fire(makeScheduleUpdatedEvent("issue-1"));

    // Flush microtasks + any timers so the rejection propagates to the outer catch.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(stubLogger.error).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: "schedule.updated" }),
      expect.stringContaining("forecast listener event handler failed")
    );
    // No rebuild should have fired — the handler errored before scheduleRebuild.
    expect(mockRebuild).not.toHaveBeenCalled();

    unsub();
  });

  it("does not call rebuild when the DB lookup rejects", async () => {
    const bus = makeStubBus();
    mockIssueFindUnique.mockRejectedValueOnce(new Error("connection lost"));

    const unsub = registerForecastListener(bus, stubLogger);
    bus.fire(makeWorklogCreatedEvent("issue-1"));

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);

    expect(mockRebuild).not.toHaveBeenCalled();

    unsub();
  });
});

// ─── L13: projectId cache — avoids repeat DB lookups, expires on TTL ──────────
// resolveProjectIdFromIssue caches issueId→projectId (TTL 30s). These tests
// cover the cache-hit return path and the TTL-expiry re-query (kills the
// listener.ts:125 hit/TTL survivors and the cache no-coverage mutants).
// NOTE: the size-cap eviction branch (listener.ts:137-141) is a rarely-hit
// safety valve whose async set-ordering makes a deterministic test
// disproportionately costly — left as a documented minor gap (tracked in KAN-115).

describe("L13 — projectId cache", () => {
  it("serves a repeat lookup for the same issue from cache (1 DB call, not 2)", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    // First event: cache miss → 1 DB lookup, entry cached.
    bus.fire(makeScheduleUpdatedEvent("issue-1"));
    await vi.advanceTimersByTimeAsync(0); // flush handleEvent so the cache is set
    expect(mockIssueFindUnique).toHaveBeenCalledTimes(1);

    // Second event for the SAME issue within TTL → cache hit, NO new DB lookup.
    bus.fire(makeScheduleUpdatedEvent("issue-1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockIssueFindUnique).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS + 10);
    expect(mockRebuild).toHaveBeenCalledWith("project-A");

    unsub();
  });

  it("re-queries the DB after the cache entry expires (TTL = 30s)", async () => {
    const bus = makeStubBus();
    const unsub = registerForecastListener(bus, stubLogger);

    bus.fire(makeScheduleUpdatedEvent("issue-1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockIssueFindUnique).toHaveBeenCalledTimes(1);

    // Advance past the 30s TTL so the cached entry is stale.
    await vi.advanceTimersByTimeAsync(30_000 + 1);

    // Same issue again → entry expired → DB queried a second time.
    bus.fire(makeScheduleUpdatedEvent("issue-1"));
    await vi.advanceTimersByTimeAsync(0);
    expect(mockIssueFindUnique).toHaveBeenCalledTimes(2);

    unsub();
  });
});
