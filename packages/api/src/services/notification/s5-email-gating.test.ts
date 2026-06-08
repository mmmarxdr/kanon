/**
 * Unit tests for S5 email preference gating — KAN-29
 *
 * 5.2 — pref row absent → email sent (default ON)
 * 5.2 — pref.emailMention=false → no email
 * 5.2 — provider rejects → handler does not throw
 *
 * TDD: RED first — tests reference updated handlers + email dispatch.
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
    notificationPreference: {
      findMany: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
    },
  },
}));

import { prisma } from "../../config/prisma.js";
import { registerNotificationService } from "./index.js";
import type { IEventBus } from "../event-bus/interface.js";
import type { DomainEvent } from "../event-bus/types.js";
import type { EmailProvider } from "../email/types.js";

// ── Mock email provider ──────────────────────────────────────────────────────

function makeEmailProviderMock(): EmailProvider & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

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
    _emit: (event: DomainEvent) => {
      if (_handler) _handler(event);
    },
    subscribeToWorkspace: vi.fn(),
    getEventsSince: vi.fn(() => []),
  } as unknown as IEventBus & { _emit: (e: DomainEvent) => void };
}

function makeMentionEvent(mentionedMemberId = "member-A"): DomainEvent {
  return {
    id: 1,
    type: "mention.created",
    workspaceId: "ws-1",
    actorId: "actor-id",
    payload: {
      mentionId: "mention-1",
      issueId: "issue-1",
      issueKey: "KAN-1",
      commentId: "comment-1",
      mentionedMemberId,
      mentionedByMemberId: "actor-id",
      context: "please review",
    },
    timestamp: new Date().toISOString(),
    via: "web",
  };
}

function makeAssignmentEvent(assigneeMemberId = "member-B"): DomainEvent {
  return {
    id: 2,
    type: "issue.assigned",
    workspaceId: "ws-1",
    actorId: "actor-id",
    payload: {
      issueKey: "KAN-1",
      issueId: "issue-1",
      from: null,
      to: assigneeMemberId,
    },
    timestamp: new Date().toISOString(),
    via: null,
  };
}

// ── Helper to flush micro-tasks ──────────────────────────────────────────────
const flush = () => new Promise((r) => setTimeout(r, 20));

describe("5.2a — mention email: pref absent → email sent (default ON)", () => {
  let bus: ReturnType<typeof makeEventBusStub>;
  let provider: ReturnType<typeof makeEmailProviderMock>;
  const logger = { error: vi.fn(), info: vi.fn() };

  beforeEach(() => {
    bus = makeEventBusStub();
    provider = makeEmailProviderMock();

    // Notification row created
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);

    // Member exists with email
    vi.mocked(prisma.member.findUnique).mockResolvedValue({
      id: "member-A",
      user: { email: "a@test.com" },
    } as any);

    // No preference row (absent → default ON)
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);

    registerNotificationService(bus as unknown as IEventBus, {
      logger: logger as any,
      emailProvider: provider,
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("mention.created with no pref row → provider.send called once", async () => {
    bus._emit(makeMentionEvent());
    await flush();

    expect(provider.send).toHaveBeenCalledOnce();
    const msg = provider.send.mock.calls[0]![0];
    expect(msg.to).toBe("a@test.com");
  });
});

describe("5.2b — mention email: pref.emailMention=false → no email", () => {
  let bus: ReturnType<typeof makeEventBusStub>;
  let provider: ReturnType<typeof makeEmailProviderMock>;
  const logger = { error: vi.fn(), info: vi.fn() };

  beforeEach(() => {
    bus = makeEventBusStub();
    provider = makeEmailProviderMock();

    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);

    vi.mocked(prisma.member.findUnique).mockResolvedValue({
      id: "member-A",
      user: { email: "a@test.com" },
    } as any);

    // Preference row with emailMention=false
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([
      {
        memberId: "member-A",
        emailMention: false,
        emailAssignment: true,
        emailCycleClosed: true,
      },
    ] as any);

    registerNotificationService(bus as unknown as IEventBus, {
      logger: logger as any,
      emailProvider: provider,
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("mention.created with emailMention=false → provider.send NOT called", async () => {
    bus._emit(makeMentionEvent());
    await flush();

    expect(provider.send).not.toHaveBeenCalled();
  });

  it("in-app Notification row STILL created even when email suppressed", async () => {
    bus._emit(makeMentionEvent());
    await flush();

    expect(prisma.notification.create).toHaveBeenCalledOnce();
  });
});

describe("5.2c — assignment email: pref row present", () => {
  let bus: ReturnType<typeof makeEventBusStub>;
  let provider: ReturnType<typeof makeEmailProviderMock>;
  const logger = { error: vi.fn(), info: vi.fn() };

  beforeEach(() => {
    bus = makeEventBusStub();
    provider = makeEmailProviderMock();

    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);

    vi.mocked(prisma.member.findUnique).mockResolvedValue({
      id: "member-B",
      user: { email: "b@test.com" },
    } as any);

    registerNotificationService(bus as unknown as IEventBus, {
      logger: logger as any,
      emailProvider: provider,
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("issue.assigned with emailAssignment=true (default) → provider.send called", async () => {
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([
      {
        memberId: "member-B",
        emailMention: true,
        emailAssignment: true,
        emailCycleClosed: true,
      },
    ] as any);

    bus._emit(makeAssignmentEvent("member-B"));
    await flush();

    expect(provider.send).toHaveBeenCalledOnce();
    const msg = provider.send.mock.calls[0]![0];
    expect(msg.to).toBe("b@test.com");
  });

  it("issue.assigned with emailAssignment=false → provider.send NOT called", async () => {
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([
      {
        memberId: "member-B",
        emailMention: true,
        emailAssignment: false,
        emailCycleClosed: true,
      },
    ] as any);

    bus._emit(makeAssignmentEvent("member-B"));
    await flush();

    expect(provider.send).not.toHaveBeenCalled();
  });
});

describe("5.2d — provider rejects → handler does not throw", () => {
  it("email provider throws → error logged, handler does not reject, notification row still created", async () => {
    const bus = makeEventBusStub();
    const provider = makeEmailProviderMock();
    const logger = { error: vi.fn(), info: vi.fn() };

    provider.send.mockRejectedValue(new Error("SMTP down"));

    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    vi.mocked(prisma.member.findUnique).mockResolvedValue({
      id: "member-A",
      user: { email: "a@test.com" },
    } as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);

    registerNotificationService(bus as unknown as IEventBus, {
      logger: logger as any,
      emailProvider: provider,
    });

    // Must not throw
    expect(() => bus._emit(makeMentionEvent())).not.toThrow();

    await flush();

    // Notification row still created
    expect(prisma.notification.create).toHaveBeenCalledOnce();
    // Error logged from email send failure
    expect(logger.error).toHaveBeenCalled();
  });
});
