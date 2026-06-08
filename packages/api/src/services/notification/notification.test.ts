/**
 * Unit tests for NotificationService — S3 / KAN-27
 *
 * Tests:
 *  3.1a — mention handler creates Notification row, excludes actor
 *  3.1b — handler error does not propagate to emitter
 *  3.1c — mention delta (edit re-parse → no duplicate Notification)
 *
 * TDD: RED first — references production code that does not yet exist.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock prisma ──────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    notification: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    issueSubscription: {
      findMany: vi.fn(),
    },
    mention: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../config/prisma.js";
import { registerNotificationService } from "./index.js";
import { routeEvent } from "./handlers.js";
import type { IEventBus } from "../event-bus/interface.js";
import type { DomainEvent } from "../event-bus/types.js";

// ── Minimal EventBus stub ────────────────────────────────────────────────────

function makeEventBusStub() {
  let _handler: ((e: DomainEvent) => void) | null = null;

  return {
    subscribe: vi.fn((handler: (e: DomainEvent) => void) => {
      _handler = handler;
      return () => { _handler = null; };
    }),
    emit: vi.fn((event: DomainEvent) => {
      if (_handler) _handler(event);
    }),
    // Expose for direct emit in tests
    _emit: (event: DomainEvent) => {
      if (_handler) _handler(event);
    },
    subscribeToWorkspace: vi.fn(),
    getEventsSince: vi.fn(() => []),
  } as unknown as IEventBus & { _emit: (e: DomainEvent) => void };
}

function makeMentionCreatedEvent(overrides?: Partial<DomainEvent>): DomainEvent {
  return {
    id: 1,
    type: "mention.created",
    workspaceId: "ws-1",
    actorId: "actor-member-id",
    payload: {
      mentionId: "mention-1",
      issueId: "issue-1",
      issueKey: "KAN-1",
      commentId: "comment-1",
      mentionedMemberId: "recipient-member-id",
      mentionedByMemberId: "actor-member-id",
      context: "@recipient check this",
    },
    timestamp: new Date().toISOString(),
    via: "web",
    ...overrides,
  };
}

function makeIssueAssignedEvent(overrides?: Partial<DomainEvent>): DomainEvent {
  return {
    id: 2,
    type: "issue.assigned",
    workspaceId: "ws-1",
    actorId: "actor-member-id",
    payload: {
      issueKey: "KAN-1",
      issueId: "issue-1",
      from: null,
      to: "assignee-member-id",
    },
    timestamp: new Date().toISOString(),
    via: null,
    ...overrides,
  };
}

// ── Tests ───────────────────────────────────────────────────────────────────

describe("3.1a — mention.created handler creates Notification row, excludes actor", () => {
  let bus: ReturnType<typeof makeEventBusStub>;
  const mockLogger = { error: vi.fn(), info: vi.fn(), debug: vi.fn() };

  beforeEach(() => {
    bus = makeEventBusStub();
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    registerNotificationService(bus as unknown as IEventBus, { logger: mockLogger as any });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("mention.created → notification.create called with kind=mention and recipientId=mentionedMemberId", async () => {
    const event = makeMentionCreatedEvent();
    bus._emit(event);
    await vi.waitFor(() => expect(prisma.notification.create).toHaveBeenCalledOnce());
    const call = vi.mocked(prisma.notification.create).mock.calls[0]![0] as any;
    expect(call.data.kind).toBe("mention");
    expect(call.data.recipientId).toBe("recipient-member-id");
    expect(call.data.actorId).toBe("actor-member-id");
    expect(call.data.mentionId).toBe("mention-1");
    expect(call.data.via).toBe("web");
  });

  it("mention.created where mentionedMemberId === actorId → notification.create NOT called (actor excluded)", async () => {
    // Actor mentions themselves — should be excluded
    const event = makeMentionCreatedEvent({
      actorId: "self-member-id",
      payload: {
        mentionId: "mention-2",
        issueId: "issue-1",
        issueKey: "KAN-1",
        commentId: null,
        mentionedMemberId: "self-member-id", // same as actorId
        mentionedByMemberId: "self-member-id",
        context: "@self check",
      },
    });
    bus._emit(event);
    // No positive proxy available for a NOT-called assertion; use a short settle
    // via vi.waitFor with a condition that will never be true — instead just tick
    // microtasks by waiting for Promise.resolve() chain to drain.
    // The handler returns synchronously (actor-excluded path), so we only need to
    // drain the microtask queue rather than wait for async DB work.
    await Promise.resolve();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("issue.assigned → notification.create called with kind=assignment, excludes actor if self-assign", async () => {
    const event = makeIssueAssignedEvent({
      actorId: "actor-member-id",
      payload: {
        issueKey: "KAN-1",
        issueId: "issue-1",
        from: null,
        to: "assignee-member-id", // different from actor
      },
    });
    bus._emit(event);
    await vi.waitFor(() => expect(prisma.notification.create).toHaveBeenCalledOnce());
    const call = vi.mocked(prisma.notification.create).mock.calls[0]![0] as any;
    expect(call.data.kind).toBe("assignment");
    expect(call.data.recipientId).toBe("assignee-member-id");
  });

  it("issue.assigned to self (actor === assignee) → no Notification row", async () => {
    const event = makeIssueAssignedEvent({
      actorId: "actor-member-id",
      payload: {
        issueKey: "KAN-1",
        issueId: "issue-1",
        from: null,
        to: "actor-member-id", // self-assign
      },
    });
    bus._emit(event);
    // Handler returns early synchronously — drain microtasks only
    await Promise.resolve();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });

  it("issue.assigned with to=null → no Notification row (unassigned)", async () => {
    const event = makeIssueAssignedEvent({
      payload: {
        issueKey: "KAN-1",
        issueId: "issue-1",
        from: "old-assignee",
        to: null,
      },
    });
    bus._emit(event);
    // Handler returns early synchronously — drain microtasks only
    await Promise.resolve();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

describe("3.1b — handler error does not propagate to emitter", () => {
  it("notification.create throws → bus.emit caller sees no error (fire-and-forget isolation)", async () => {
    const bus = makeEventBusStub();
    const mockLogger = { error: vi.fn(), info: vi.fn(), debug: vi.fn() };
    vi.mocked(prisma.notification.create).mockRejectedValue(new Error("DB down"));

    registerNotificationService(bus as unknown as IEventBus, { logger: mockLogger as any });

    const event = makeMentionCreatedEvent();

    // The sync wrapper must NOT throw even if the async handler rejects
    expect(() => bus._emit(event)).not.toThrow();

    // Wait for async handler to fail and error to be logged
    await vi.waitFor(() => expect(mockLogger.error).toHaveBeenCalled());
  });
});

describe("3.1c — mention delta: edit re-parse → no duplicate Notification", () => {
  it("two mention.created events with same mentionId → two notification.create calls (idempotency is caller's responsibility)", async () => {
    // parseAndUpsertMentions delta ensures mention.created is emitted ONLY for new mentions.
    // This test verifies the handler creates one row per event — dedup is handled upstream.
    vi.clearAllMocks();
    const bus = makeEventBusStub();
    const mockLogger = { error: vi.fn(), info: vi.fn(), debug: vi.fn() };
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);

    registerNotificationService(bus as unknown as IEventBus, { logger: mockLogger as any });

    const event1 = makeMentionCreatedEvent({ id: 1 });
    const event2 = makeMentionCreatedEvent({ id: 2 }); // same payload, second event

    bus._emit(event1);
    bus._emit(event2);
    // Wait until both notification rows are created
    await vi.waitFor(() => expect(prisma.notification.create).toHaveBeenCalledTimes(2));

    // Each event produces one call — NotificationService doesn't deduplicate
    // (delta handled by parseAndUpsertMentions returning only new mentions)
  });
});

describe("3.1e — issue.assigned handler isolation: handleIssueAssigned DB failure does not suppress subscribed_activity", () => {
  it("if handleIssueAssigned throws, handleSubscribedActivity still runs for subscribers", async () => {
    vi.clearAllMocks();
    const bus = makeEventBusStub();
    const mockLogger = { error: vi.fn(), info: vi.fn(), debug: vi.fn() };

    // notification.create rejects (simulates assignment write failure)
    vi.mocked(prisma.notification.create).mockRejectedValue(new Error("DB down for assignment"));
    // notification.createMany resolves (subscriber fan-out)
    vi.mocked(prisma.notification as any).createMany = vi.fn().mockResolvedValue({ count: 1 });

    // issueSubscription.findMany must return a subscriber so fan-out runs
    (prisma as any).issueSubscription = {
      findMany: vi.fn().mockResolvedValue([{ memberId: "subscriber-member-id" }]),
    };

    registerNotificationService(bus as unknown as IEventBus, { logger: mockLogger as any });

    // Use the shared factory; override only what the test needs to control
    // (id and payload fields — actor exclusion is satisfied by factory defaults).
    const event = makeIssueAssignedEvent({
      id: 10,
      payload: {
        issueKey: "KAN-99",
        issueId: "issue-99",
        from: null,
        to: "assignee-member-id", // different from actor (actor-member-id)
      },
    });
    bus._emit(event);
    // Allow async handlers to run
    await new Promise((r) => setTimeout(r, 20));

    // notification.create was attempted (and failed), error logged
    expect(prisma.notification.create).toHaveBeenCalledOnce();
    expect(mockLogger.error).toHaveBeenCalled();

    // subscribed_activity fan-out (createMany) MUST still have been called
    expect((prisma.notification as any).createMany).toHaveBeenCalled();
  });
});

describe("3.1d — cycle.closed → no in-app Notification row (D5: email-only this wave)", () => {
  it("cycle.closed event → notification.create NOT called", async () => {
    vi.clearAllMocks();
    const bus = makeEventBusStub();
    const mockLogger = { error: vi.fn(), info: vi.fn(), debug: vi.fn() };
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);

    registerNotificationService(bus as unknown as IEventBus, { logger: mockLogger as any });

    const event: DomainEvent = {
      id: 3,
      type: "cycle.closed",
      workspaceId: "ws-1",
      actorId: "actor-1",
      payload: { cycleId: "cycle-1", projectId: "proj-1" },
      timestamp: new Date().toISOString(),
    };
    bus._emit(event);
    // cycle.closed handler has no in-app row path — it returns early if no emailProvider.
    // Drain microtasks only (no async DB work to wait for).
    await Promise.resolve();
    expect(prisma.notification.create).not.toHaveBeenCalled();
  });
});

// ─── FIX 1: issue.batch_transitioned handler-level tests ─────────────────────

describe("4.1a — issue.batch_transitioned handler: createMany rows carry correct per-issue issueKey", () => {
  const WS = "ws-batch";
  const ACTOR = "actor-batch";
  const I1 = "issue-id-1";
  const I2 = "issue-id-2";
  const K1 = "KAN-10";
  const K2 = "KAN-20";
  const SUB1 = "sub-member-1";
  const SUB2 = "sub-member-2";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("2-issue batch: createMany rows carry the correct key per issueId (K1→I1, K2→I2, no swap)", async () => {
    // issueSubscription.findMany returns sub1 for I1 and sub2 for I2
    vi.mocked(prisma.issueSubscription.findMany).mockResolvedValue([
      { issueId: I1, memberId: SUB1 } as any,
      { issueId: I2, memberId: SUB2 } as any,
    ]);
    vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 2 });

    const event: DomainEvent = {
      id: 100,
      type: "issue.batch_transitioned",
      workspaceId: WS,
      actorId: ACTOR,
      payload: {
        issues: [
          { id: I1, key: K1 },
          { id: I2, key: K2 },
        ],
        to: "done",
      },
      timestamp: new Date().toISOString(),
      via: null,
    };

    await routeEvent(event);

    expect(prisma.notification.createMany).toHaveBeenCalledOnce();
    const { data } = vi.mocked(prisma.notification.createMany).mock.calls[0]![0] as any;

    // Exactly 2 rows
    expect(data).toHaveLength(2);

    const rowForI1 = data.find((r: any) => r.issueId === I1);
    const rowForI2 = data.find((r: any) => r.issueId === I2);

    // Each row carries the correct key — not null, not swapped
    expect(rowForI1?.payload?.issueKey).toBe(K1);
    expect(rowForI2?.payload?.issueKey).toBe(K2);

    // Recipients are correct
    expect(rowForI1?.recipientId).toBe(SUB1);
    expect(rowForI2?.recipientId).toBe(SUB2);
  });

  it("2-issue batch: actor is excluded from all rows even if actor is a subscriber", async () => {
    // ACTOR subscribes to both issues
    vi.mocked(prisma.issueSubscription.findMany).mockResolvedValue([
      { issueId: I1, memberId: ACTOR } as any,
      { issueId: I1, memberId: SUB1 } as any,
    ]);
    vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 1 });

    const event: DomainEvent = {
      id: 101,
      type: "issue.batch_transitioned",
      workspaceId: WS,
      actorId: ACTOR,
      payload: {
        issues: [{ id: I1, key: K1 }],
        to: "done",
      },
      timestamp: new Date().toISOString(),
      via: null,
    };

    await routeEvent(event);

    const { data } = vi.mocked(prisma.notification.createMany).mock.calls[0]![0] as any;
    // Only SUB1 — ACTOR excluded
    expect(data).toHaveLength(1);
    expect(data[0].recipientId).toBe(SUB1);
  });

  it("empty-batch event (issues: []) → createMany NOT called", async () => {
    const event: DomainEvent = {
      id: 102,
      type: "issue.batch_transitioned",
      workspaceId: WS,
      actorId: ACTOR,
      payload: {
        issues: [],
        to: "done",
      },
      timestamp: new Date().toISOString(),
      via: null,
    };

    await routeEvent(event);

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });

  it("batch where no subscribers exist → createMany NOT called", async () => {
    vi.mocked(prisma.issueSubscription.findMany).mockResolvedValue([]);

    const event: DomainEvent = {
      id: 103,
      type: "issue.batch_transitioned",
      workspaceId: WS,
      actorId: ACTOR,
      payload: {
        issues: [{ id: I1, key: K1 }],
        to: "done",
      },
      timestamp: new Date().toISOString(),
      via: null,
    };

    await routeEvent(event);

    expect(prisma.notification.createMany).not.toHaveBeenCalled();
  });
});

// ─── FIX 2: comment.created double-notification when mention emit partially fails ─

describe("4.1b — comment.created: members who received mention.created are excluded from subscribed_activity even if emit later throws", () => {
  const WS = "ws-comment";
  const ACTOR = "actor-comment";
  const ISSUE_ID = "issue-comment-1";
  const MEMBER_X = "member-x"; // will receive mention.created emit, then parse throws

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("when mentionedMemberIds includes member X, the comment.created handler excludes X from subscribed_activity", async () => {
    // member X is a subscriber
    vi.mocked(prisma.issueSubscription.findMany).mockResolvedValue([
      { issueId: ISSUE_ID, memberId: MEMBER_X } as any,
    ]);
    vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 0 });

    // Emit comment.created with MEMBER_X in mentionedMemberIds
    // (simulates: emit was called for MEMBER_X before/during mention loop)
    const event: DomainEvent = {
      id: 200,
      type: "comment.created",
      workspaceId: WS,
      actorId: ACTOR,
      payload: {
        commentId: "comment-1",
        issueId: ISSUE_ID,
        issueKey: "KAN-5",
        mentionedMemberIds: [MEMBER_X],
      },
      timestamp: new Date().toISOString(),
      via: null,
    };

    await routeEvent(event);

    // createMany should NOT be called because MEMBER_X is excluded via alreadyNotifiedByMention
    // (they already received kind=mention for this event)
    if (vi.mocked(prisma.notification.createMany).mock.calls.length > 0) {
      const { data } = vi.mocked(prisma.notification.createMany).mock.calls[0]![0] as any;
      const memberXRow = data.find((r: any) => r.recipientId === MEMBER_X);
      expect(memberXRow).toBeUndefined();
    } else {
      // createMany was not called at all — also correct (no recipients after exclusion)
      expect(prisma.notification.createMany).not.toHaveBeenCalled();
    }
  });

  it("when mentionedMemberIds is empty, member X IS included in subscribed_activity fan-out", async () => {
    // member X is a subscriber but NOT in mentionedMemberIds (emit didn't happen for them)
    vi.mocked(prisma.issueSubscription.findMany).mockResolvedValue([
      { issueId: ISSUE_ID, memberId: MEMBER_X } as any,
    ]);
    vi.mocked(prisma.notification.createMany).mockResolvedValue({ count: 1 });

    const event: DomainEvent = {
      id: 201,
      type: "comment.created",
      workspaceId: WS,
      actorId: ACTOR,
      payload: {
        commentId: "comment-2",
        issueId: ISSUE_ID,
        issueKey: "KAN-5",
        mentionedMemberIds: [], // empty — no mention emits happened
      },
      timestamp: new Date().toISOString(),
      via: null,
    };

    await routeEvent(event);

    expect(prisma.notification.createMany).toHaveBeenCalled();
    const { data } = vi.mocked(prisma.notification.createMany).mock.calls[0]![0] as any;
    const memberXRow = data.find((r: any) => r.recipientId === MEMBER_X);
    expect(memberXRow).toBeDefined();
  });
});
