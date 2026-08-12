/**
 * Unit tests for the work-session transition listener (KAN-156, Slice 1).
 *
 * Strict TDD: tests written BEFORE implementation.
 *
 * Covers:
 *   - First entry into active-work state (analysis / in_progress) opens a session
 *   - Entering close state (review / done) closes the session
 *   - review → in_progress (rework) reopens/resumes (open rule)
 *   - Idempotency: re-entering an already-open active state is a no-op
 *   - Idempotency: closing when none open is a no-op
 *   - from-was-already-active: no new session opened (already open guard)
 *   - Actor-only attribution: startWork is called with actorMemberId
 *   - Failure in startWork / stopWork does NOT propagate (fire-and-forget)
 *   - KAN-143 guard seam: events with cause="start_work" are skipped
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock prisma ────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    member: { findUnique: vi.fn() },
    workSession: { findUnique: vi.fn(), findMany: vi.fn() },
    issue: { findUnique: vi.fn() },
  },
}));

// ── Mock work-session service ──────────────────────────────────────────────
vi.mock("./service.js", () => ({
  startWork: vi.fn(),
  stopWork: vi.fn(),
  stageTransitionStart: vi.fn(),
  captureTransitionInterval: vi.fn(),
  SESSION_TTL_MS: 5 * 60 * 1000,
}));

import { prisma } from "../../config/prisma.js";
import {
  captureTransitionInterval,
  stageTransitionStart,
  startWork,
  stopWork,
} from "./service.js";
import { registerTransitionListener } from "./transition-listener.js";
import type { IEventBus } from "../../services/event-bus/interface.js";
import type { DomainEvent } from "../../services/event-bus/types.js";

// ── Typed mocks ────────────────────────────────────────────────────────────
const mockMemberFindUnique = vi.mocked(prisma.member.findUnique);
const mockIssueFindUnique = vi.mocked(prisma.issue.findUnique);
const mockWorkSessionFindMany = vi.mocked(prisma.workSession.findMany);
const mockStartWork = vi.mocked(startWork);
const mockStopWork = vi.mocked(stopWork);
const mockStageTransitionStart = vi.mocked(stageTransitionStart);
const mockCaptureTransitionInterval = vi.mocked(captureTransitionInterval);

// ── Fake event bus ─────────────────────────────────────────────────────────
function makeFakeBus(): { bus: IEventBus; emit: (e: DomainEvent) => void } {
  let handler: ((e: DomainEvent) => void) | null = null;
  const bus: IEventBus = {
    subscribe: vi.fn((h: (e: DomainEvent) => void) => {
      handler = h;
      return vi.fn(); // unsubscribe
    }),
    emit: vi.fn(),
    subscribeToWorkspace: vi.fn(),
    getEventsSince: vi.fn(() => []),
  } as unknown as IEventBus;
  return {
    bus,
    emit: (e: DomainEvent) => handler?.(e),
  };
}

function deferred<T = void>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

async function flushMicrotasks(): Promise<void> {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

// ── Helper: build an issue.transitioned event ──────────────────────────────
function makeTransitionEvent(
  from: string,
  to: string,
  overrides: Partial<{
    actorMemberId: string;
    actorUserId: string;
    cause: string;
    issueKey: string;
    issueId: string;
  }> = {}
): DomainEvent {
  return {
    id: 1,
    type: "issue.transitioned",
    workspaceId: "ws-1",
    actorId: overrides.actorMemberId ?? "member-1",
    timestamp: new Date().toISOString(),
    payload: {
      from,
      to,
      issueKey: overrides.issueKey ?? "KAN-42",
      issueId: overrides.issueId ?? "issue-1",
      projectKey: "KAN",
      actorMemberId: overrides.actorMemberId ?? "member-1",
      actorUserId: overrides.actorUserId ?? "user-1",
      ...(overrides.cause !== undefined ? { cause: overrides.cause } : {}),
    },
  };
}

// ── Default member stub ────────────────────────────────────────────────────
const fakeMember = { id: "member-1", userId: "user-1" };

describe("registerTransitionListener", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockMemberFindUnique.mockResolvedValue(fakeMember as any);
    // Default: issue found, one open session owned by the actor
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1", state: "in_progress" } as any);
    mockWorkSessionFindMany.mockResolvedValue([
      { id: "session-1", userId: "user-1", memberId: "member-1" },
    ] as any);
    mockStartWork.mockResolvedValue({ session: {}, warnings: [], autoAssigned: false } as any);
    mockStopWork.mockResolvedValue({ ok: true, deleted: true, workLog: null } as any);
    mockStageTransitionStart.mockResolvedValue({ session: null } as any);
    mockCaptureTransitionInterval.mockResolvedValue({
      workLog: { id: "wl-transition-interval", durationS: 120 },
    } as any);
  });

  // ─── Registration ─────────────────────────────────────────────────────────

  it("returns an unsubscribe function", () => {
    const { bus } = makeFakeBus();
    const unsubscribe = registerTransitionListener(bus);
    expect(typeof unsubscribe).toBe("function");
  });

  it("subscribes to the event bus", () => {
    const { bus } = makeFakeBus();
    registerTransitionListener(bus);
    expect(bus.subscribe).toHaveBeenCalledOnce();
  });

  // ─── Active-work state entry → open session ────────────────────────────

  it("opens a session when transitioning to 'analysis' from a non-active state", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("backlog", "analysis"));
    await vi.waitFor(() => expect(mockStartWork).toHaveBeenCalledOnce());

    expect(mockStartWork).toHaveBeenCalledWith(
      "KAN-42",
      "member-1",
      "user-1",
      "transition-listener",
      null,
      undefined,
      { autoAssign: false, onConflict: "skip", transitionObservedAt: expect.any(Date) }
    );
  });

  it("opens a session when transitioning to 'in_progress' from a non-active state", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("todo", "in_progress"));
    await vi.waitFor(() => expect(mockStartWork).toHaveBeenCalledOnce());
  });

  it("opens a session when transitioning from 'review' back to 'in_progress' (rework)", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    // review → in_progress: review is a close state, in_progress is active
    // "from" was NOT an active-work state (review is close), so session should open
    emit(makeTransitionEvent("review", "in_progress"));
    await vi.waitFor(() => expect(mockStartWork).toHaveBeenCalledOnce());
  });

  // ─── Idempotency: from-was-already-active → no-op ─────────────────────

  it("does NOT open a new session when transitioning analysis → in_progress (already in active work)", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("analysis", "in_progress"));
    // Give async ops time to run
    await new Promise((r) => setTimeout(r, 20));

    expect(mockStartWork).not.toHaveBeenCalled();
  });

  it("does NOT open a new session when already in in_progress (in_progress → in_progress self-transition)", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("in_progress", "in_progress"));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockStartWork).not.toHaveBeenCalled();
  });

  // ─── Close state → close session ──────────────────────────────────────

  it("closes the session when transitioning to 'review'", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("in_progress", "review"));
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());

    // BUG-4 fix: stopWork is called with the session owner's ids (from DB lookup),
    // not the actor's ids — so any worker's session is closed, not just the actor's.
    expect(mockStopWork).toHaveBeenCalledWith(
      "KAN-42",
      "user-1",   // session.userId from workSession.findMany
      "member-1", // session.memberId from workSession.findMany
      null,
      expect.any(Date),
      "session-1",
    );
  });

  it("closes the session when transitioning to 'done'", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("in_progress", "done"));
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());
  });

  it.each(["todo", "backlog"])(
    "closes the session at the exact boundary when active work regresses to '%s'",
    async (targetState) => {
      const { bus, emit } = makeFakeBus();
      registerTransitionListener(bus);
      const event = makeTransitionEvent("analysis", targetState);
      event.timestamp = "2026-08-11T12:02:03.000Z";

      emit(event);

      await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());
      expect(mockStopWork).toHaveBeenCalledWith(
        "KAN-42",
        "user-1",
        "member-1",
        null,
        new Date("2026-08-11T12:02:03.000Z"),
        "session-1",
      );
    },
  );

  // ─── Idempotency: close when none open is a no-op ──────────────────────

  it("is a no-op (does not throw) when closing and no session exists", async () => {
    mockStopWork.mockResolvedValue({ ok: true, deleted: false, workLog: null } as any);

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("in_progress", "review"));
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());
    // No error thrown — listener absorbed it
  });

  // ─── Non-matching events are ignored ──────────────────────────────────

  it("ignores events with irrelevant types", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    const irrelevantEvent: DomainEvent = {
      id: 2,
      type: "worklog.created",
      workspaceId: "ws-1",
      actorId: "member-1",
      timestamp: new Date().toISOString(),
      payload: { workLogId: "wl-1", issueId: "issue-1", workspaceId: "ws-1" },
    };
    emit(irrelevantEvent);
    await new Promise((r) => setTimeout(r, 20));

    expect(mockStartWork).not.toHaveBeenCalled();
    expect(mockStopWork).not.toHaveBeenCalled();
  });

  it("ignores transitions to states that are neither active-work nor close states", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    // backlog → todo: neither open nor close
    emit(makeTransitionEvent("backlog", "todo"));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockStartWork).not.toHaveBeenCalled();
    expect(mockStopWork).not.toHaveBeenCalled();
  });

  // ─── Actor-only attribution ────────────────────────────────────────────

  it("uses actorMemberId from payload for startWork (actor-only attribution)", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    const otherMember = { id: "member-99", userId: "user-99" };
    mockMemberFindUnique.mockResolvedValue(otherMember as any);

    emit(
      makeTransitionEvent("backlog", "in_progress", {
        actorMemberId: "member-99",
        actorUserId: "user-99",
      })
    );
    await vi.waitFor(() => expect(mockStartWork).toHaveBeenCalledOnce());

    expect(mockStartWork).toHaveBeenCalledWith(
      expect.any(String),
      "member-99",
      "user-99",
      "transition-listener",
      null,
      undefined,
      { autoAssign: false, onConflict: "skip", transitionObservedAt: expect.any(Date) }
    );
  });

  // ─── Fire-and-forget: failures do not propagate ────────────────────────

  it("does not throw if startWork throws (fire-and-forget)", async () => {
    mockStartWork.mockRejectedValue(new Error("DB error"));

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    // Should not reject
    emit(makeTransitionEvent("backlog", "analysis"));
    await new Promise((r) => setTimeout(r, 50));
    // If we reached here, the error was swallowed — pass
  });

  it("does not throw if stopWork throws (fire-and-forget)", async () => {
    mockStopWork.mockRejectedValue(new Error("DB error"));

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("in_progress", "review"));
    await new Promise((r) => setTimeout(r, 50));
    // If we reached here, the error was swallowed — pass
  });

  // ─── BUG-4: close ALL sessions — not just actor's ─────────────────────

  it("closes Bob's session when Alice transitions the issue to review (BUG-4)", async () => {
    // Bob is the worker (session owner), Alice is the actor who transitions
    const bobSession = { id: "session-bob", userId: "user-bob", memberId: "member-bob" };
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1" } as any);
    mockWorkSessionFindMany.mockResolvedValue([bobSession] as any);

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    // Alice transitions (actorMemberId = member-alice), Bob owns the session
    emit(
      makeTransitionEvent("in_progress", "review", {
        actorMemberId: "member-alice",
        actorUserId: "user-alice",
        issueKey: "KAN-99",
        issueId: "issue-1",
      })
    );

    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());

    // stopWork must be called with BOB's ids (the session owner), not Alice's
    expect(mockStopWork).toHaveBeenCalledWith(
      "KAN-99",
      "user-bob",
      "member-bob",
      null,
      expect.any(Date),
      "session-bob",
    );
  });

  it("closes all open sessions when multiple workers are active (BUG-4)", async () => {
    const sessions = [
      { id: "s-1", userId: "user-1", memberId: "member-1" },
      { id: "s-2", userId: "user-2", memberId: "member-2" },
    ];
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1" } as any);
    mockWorkSessionFindMany.mockResolvedValue(sessions as any);

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("in_progress", "done"));
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledTimes(2));

    expect(mockStopWork).toHaveBeenCalledWith(
      "KAN-42",
      "user-1",
      "member-1",
      null,
      expect.any(Date),
      "s-1",
    );
    expect(mockStopWork).toHaveBeenCalledWith(
      "KAN-42",
      "user-2",
      "member-2",
      null,
      expect.any(Date),
      "s-2",
    );
  });

  it("is a no-op when no sessions exist on close transition (BUG-4 idempotency)", async () => {
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1" } as any);
    mockWorkSessionFindMany.mockResolvedValue([] as any);

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("in_progress", "review"));
    await new Promise((r) => setTimeout(r, 30));

    expect(mockStopWork).not.toHaveBeenCalled();
  });

  // ─── BUG-5: backlog → done — ADR-named edge case ──────────────────────

  it("does not open a session and does not crash on backlog → done (BUG-5)", async () => {
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1" } as any);
    mockWorkSessionFindMany.mockResolvedValue([] as any);

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    // backlog is not an active-work state, done is a close state.
    // No session should be opened. stopWork should be a no-op (no open sessions).
    emit(makeTransitionEvent("backlog", "done"));
    await new Promise((r) => setTimeout(r, 30));

    expect(mockStartWork).not.toHaveBeenCalled();
    // stopWork is NOT called because workSession.findMany returns [] — no sessions to stop.
    expect(mockStopWork).not.toHaveBeenCalled();
  });

  // ─── KAN-143 circular guard seam ──────────────────────────────────────

  it("skips the event when cause is 'start_work' (KAN-143 guard seam)", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("backlog", "in_progress", { cause: "start_work" }));
    await new Promise((r) => setTimeout(r, 20));

    expect(mockStartWork).not.toHaveBeenCalled();
  });

  // ─── Missing actorMemberId falls back gracefully ───────────────────────

  it("skips when actorMemberId is missing from payload", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    const eventWithoutActor: DomainEvent = {
      id: 3,
      type: "issue.transitioned",
      workspaceId: "ws-1",
      actorId: "member-1",
      timestamp: new Date().toISOString(),
      payload: { from: "backlog", to: "in_progress", issueKey: "KAN-42", issueId: "issue-1", projectKey: "KAN" },
    };
    emit(eventWithoutActor);
    await new Promise((r) => setTimeout(r, 20));

    expect(mockStartWork).not.toHaveBeenCalled();
  });

  // ─── Close-state finalization includes expired leases ─────────────────

  it("finalizes a stale session when the issue enters review", async () => {
    const staleSession = {
      id: "session-stale",
      userId: "user-stale",
      memberId: "member-stale",
      lastHeartbeat: new Date("2026-08-11T11:00:00.000Z"),
    };
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1" } as any);
    mockWorkSessionFindMany.mockResolvedValue([staleSession] as any);

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    const reviewEvent = makeTransitionEvent("in_progress", "review");
    reviewEvent.timestamp = "2026-08-11T12:00:00.000Z";
    emit(reviewEvent);

    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());
    const call = mockWorkSessionFindMany.mock.calls[0]![0] as any;
    expect(call.where).toEqual({ issueId: "issue-1" });
    expect(mockStopWork).toHaveBeenCalledWith(
      "KAN-42",
      "user-stale",
      "member-stale",
      null,
      new Date("2026-08-11T12:00:00.000Z"),
      "session-stale",
    );
  });

  it("FRESH: closes a fresh session (recent lastHeartbeat) and produces a stopWork call", async () => {
    const freshSession = { id: "session-fresh", userId: "user-1", memberId: "member-1" };
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1" } as any);
    mockWorkSessionFindMany.mockResolvedValue([freshSession] as any);

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("in_progress", "review"));

    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());
    expect(mockStopWork).toHaveBeenCalledWith(
      "KAN-42",
      "user-1",
      "member-1",
      null,
      expect.any(Date),
      "session-fresh",
    );
  });

  // ─── FIX 2a: done → in_progress reopen ────────────────────────────────

  it("FIX-2a: done → in_progress opens a session (done is not an active state)", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("done", "in_progress"));
    await vi.waitFor(() => expect(mockStartWork).toHaveBeenCalledOnce());

    expect(mockStartWork).toHaveBeenCalledWith(
      "KAN-42",
      "member-1",
      "user-1",
      "transition-listener",
      null,
      undefined,
      { autoAssign: false, onConflict: "skip", transitionObservedAt: expect.any(Date) }
    );
  });

  // ─── FIX 2b: actorUserId absent but actorMemberId present → DB fallback ──

  it("FIX-2b: resolves userId via DB fallback when actorUserId is absent but actorMemberId is present", async () => {
    const { bus, emit } = makeFakeBus();
    mockMemberFindUnique.mockResolvedValue({ id: "member-1", userId: "user-from-db" } as any);
    registerTransitionListener(bus);

    // Pre-enrichment event shape: no actorUserId
    const preEnrichEvent: DomainEvent = {
      id: 10,
      type: "issue.transitioned",
      workspaceId: "ws-1",
      actorId: "member-1",
      timestamp: new Date().toISOString(),
      payload: {
        from: "backlog",
        to: "in_progress",
        issueKey: "KAN-42",
        issueId: "issue-1",
        projectKey: "KAN",
        actorMemberId: "member-1",
        // actorUserId intentionally absent (pre-enrichment rolling-deploy shape)
      },
    };
    emit(preEnrichEvent);

    await vi.waitFor(() => expect(mockStartWork).toHaveBeenCalledOnce());

    // DB fallback: member.findUnique was called
    expect(mockMemberFindUnique).toHaveBeenCalledWith({
      where: { id: "member-1" },
      select: { userId: true },
    });
    // startWork called with the DB-resolved userId
    expect(mockStartWork).toHaveBeenCalledWith(
      "KAN-42",
      "member-1",
      "user-from-db",
      "transition-listener",
      null,
      undefined,
      { autoAssign: false, onConflict: "skip", transitionObservedAt: expect.any(Date) }
    );
  });

  // ─── FIX 2d: backlog → done WITH existing open session → session closed ──

  it("FIX-2d: backlog → done WITH an existing open session closes it", async () => {
    const existingSession = { id: "session-open", userId: "user-1", memberId: "member-1" };
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1" } as any);
    mockWorkSessionFindMany.mockResolvedValue([existingSession] as any);

    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("backlog", "done"));
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());

    expect(mockStopWork).toHaveBeenCalledWith(
      "KAN-42",
      "user-1",
      "member-1",
      null,
      expect.any(Date),
      "session-open",
    );
  });

  // ─── FIX 2e: rapid flapping in_progress → review → in_progress ───────

  it("FIX-2e: rapid in_progress → review → in_progress: session closes then reopens", async () => {
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    // First: close (in_progress → review)
    emit(makeTransitionEvent("in_progress", "review"));
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());

    // Then: reopen (review → in_progress)
    emit(makeTransitionEvent("review", "in_progress"));
    await vi.waitFor(() => expect(mockStartWork).toHaveBeenCalledOnce());

    expect(mockStopWork).toHaveBeenCalledTimes(1);
    expect(mockStartWork).toHaveBeenCalledTimes(1);
    expect(mockStartWork).toHaveBeenCalledWith(
      "KAN-42",
      "member-1",
      "user-1",
      "transition-listener",
      null,
      undefined,
      { autoAssign: false, onConflict: "skip", transitionObservedAt: expect.any(Date) }
    );
  });

  it("serializes an overlapping open before the later close", async () => {
    const openGate = deferred<any>();
    mockStartWork.mockReturnValueOnce(openGate.promise);
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("backlog", "analysis"));
    await vi.waitFor(() => expect(mockStartWork).toHaveBeenCalledOnce());
    emit(makeTransitionEvent("analysis", "review"));
    await flushMicrotasks();

    expect(mockStopWork).not.toHaveBeenCalled();

    openGate.resolve({ session: {}, warnings: [], autoAssigned: false });
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());
  });

  it("serializes an overlapping close before the later rework open", async () => {
    const closeGate = deferred<any>();
    mockStopWork.mockReturnValueOnce(closeGate.promise);
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);

    emit(makeTransitionEvent("in_progress", "review"));
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());
    emit(makeTransitionEvent("review", "in_progress"));
    await flushMicrotasks();

    expect(mockStartWork).not.toHaveBeenCalled();

    closeGate.resolve({ ok: true, deleted: true, workLog: null });
    await vi.waitFor(() => expect(mockStartWork).toHaveBeenCalledOnce());
  });

  it("durably stages a delayed active-entry interval when the issue is already closed", async () => {
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1", state: "review" } as any);
    mockStageTransitionStart.mockResolvedValue({
      session: {
        id: "historical-session",
        userId: "user-1",
        memberId: "member-1",
      },
    } as any);
    mockWorkSessionFindMany.mockResolvedValue([
      { id: "historical-session", userId: "user-1", memberId: "member-1" },
    ] as any);
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);
    const activeAt = "2026-08-11T12:00:00.000Z";
    const closedAt = "2026-08-11T12:02:00.000Z";
    const activeEvent = makeTransitionEvent("backlog", "analysis");
    activeEvent.timestamp = activeAt;
    const closeEvent = makeTransitionEvent("analysis", "review");
    closeEvent.timestamp = closedAt;

    emit(activeEvent);
    emit(closeEvent);

    await vi.waitFor(() => expect(mockStageTransitionStart).toHaveBeenCalledOnce());
    expect(mockStageTransitionStart).toHaveBeenCalledWith(
      "KAN-42",
      "user-1",
      "member-1",
      new Date(activeAt),
      "transition-listener",
    );
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());
    expect(mockStopWork).toHaveBeenCalledWith(
      "KAN-42",
      "user-1",
      "member-1",
      null,
      new Date(closedAt),
      "historical-session",
    );
    expect(mockStartWork).not.toHaveBeenCalled();
    expect(mockCaptureTransitionInterval).not.toHaveBeenCalled();
  });

  it("does not attribute a delayed historical interval across another worker's lifecycle", async () => {
    mockIssueFindUnique.mockResolvedValue({ id: "issue-1", state: "review" } as any);
    mockStageTransitionStart.mockResolvedValue({ session: null } as any);
    mockWorkSessionFindMany.mockResolvedValue([
      { id: "session-b", userId: "user-b", memberId: "member-b" },
    ] as any);
    const { bus, emit } = makeFakeBus();
    registerTransitionListener(bus);
    const activeEvent = makeTransitionEvent("backlog", "analysis", {
      actorMemberId: "member-a",
      actorUserId: "user-a",
    });
    activeEvent.timestamp = "2026-08-11T12:00:00.000Z";
    const closeEvent = makeTransitionEvent("analysis", "review");
    closeEvent.timestamp = "2026-08-11T12:02:00.000Z";

    emit(activeEvent);
    emit(closeEvent);

    await vi.waitFor(() => expect(mockStageTransitionStart).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(mockStopWork).toHaveBeenCalledOnce());
    expect(mockCaptureTransitionInterval).not.toHaveBeenCalled();
  });

  // ─── Unsubscribe ──────────────────────────────────────────────────────

  it("calls the bus unsubscribe on the returned function", () => {
    const mockUnsubscribeBus = vi.fn();
    const bus: IEventBus = {
      subscribe: vi.fn(() => mockUnsubscribeBus),
      emit: vi.fn(),
      subscribeToWorkspace: vi.fn(),
      getEventsSince: vi.fn(() => []),
    } as unknown as IEventBus;

    const unsubscribe = registerTransitionListener(bus);
    unsubscribe();

    expect(mockUnsubscribeBus).toHaveBeenCalledOnce();
  });
});
