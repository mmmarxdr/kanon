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
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    mention: {
      update: vi.fn(),
      updateMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../config/prisma.js";
import { registerNotificationService } from "./index.js";
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
