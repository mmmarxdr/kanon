/**
 * Failing tests for S5 review findings (KAN-29)
 *
 * Issue 1: emails render issueTitle = issueKey ("KAN-42 — KAN-42")
 *   - mention.created payload must carry issueTitle; handler must use it
 *   - issue.assigned payload must carry issueTitle; handler must use it
 *
 * Issue 2: email prep not isolated (D3 violation)
 *   - prefs DB query rejection after notification.create must NOT reject the handler
 *   - handler must resolve after the row write regardless of email dispatch errors
 *
 * Issue 3: cycle.closed email dispatch-verification coverage
 *   - opted-in member → send called with their email
 *   - opted-out member → send NOT called
 *   - pref row absent → send called (default ON)
 *   - provider reject → handler does not throw
 *
 * TDD: RED first — these tests must fail before fixes are applied.
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
      findMany: vi.fn(),
    },
    projectMember: {
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../config/prisma.js";
import { handleMentionCreated, handleIssueAssigned, handleCycleClosed } from "./handlers.js";
import type { DomainEvent } from "../event-bus/types.js";
import type { EmailProvider } from "../email/types.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeEmailProvider(): EmailProvider & { send: ReturnType<typeof vi.fn> } {
  return { send: vi.fn().mockResolvedValue(undefined) };
}

// vi.waitFor replaces fixed-delay flush — see per-test usage for positive vs negative strategy

function makeMentionEvent(overrides: Partial<DomainEvent["payload"]> = {}): DomainEvent {
  return {
    id: 100,
    type: "mention.created",
    workspaceId: "ws-1",
    actorId: "actor-id",
    payload: {
      mentionId: "mention-1",
      issueId: "issue-1",
      issueKey: "KAN-42",
      issueTitle: "Fix the login bug",
      commentId: "comment-1",
      mentionedMemberId: "member-A",
      mentionedByMemberId: "actor-id",
      context: "please review this",
      ...overrides,
    },
    timestamp: new Date().toISOString(),
    via: "web",
  };
}

function makeAssignmentEvent(overrides: Partial<DomainEvent["payload"]> = {}): DomainEvent {
  return {
    id: 101,
    type: "issue.assigned",
    workspaceId: "ws-1",
    actorId: "actor-id",
    payload: {
      issueKey: "KAN-42",
      issueId: "issue-1",
      issueTitle: "Fix the login bug",
      from: null,
      to: "member-B",
      ...overrides,
    },
    timestamp: new Date().toISOString(),
    via: null,
  };
}

function makeCycleClosedEvent(): DomainEvent {
  return {
    id: 102,
    type: "cycle.closed",
    workspaceId: "ws-1",
    actorId: "actor-id",
    payload: {
      cycleId: "cycle-1",
      cycleName: "Sprint 1",
      projectId: "project-1",
      projectKey: "KAN",
      projectName: "Kanon",
      workspaceId: "ws-1",
      velocity: 10,
      completed: 8,
      planned: 10,
      scopeAdded: 2,
      scopeRemoved: 0,
    },
    timestamp: new Date().toISOString(),
    via: null,
  };
}

// ── Fix (S5-R4-2): null actorId — no findUnique with empty-string id ──────────

describe("Fix S5-R4-2 — null actorId does not fire findUnique with empty-string id", () => {
  afterEach(() => vi.clearAllMocks());

  it("mention: null actorId → member.findUnique NOT called with id:'', email dispatched with 'Someone'", async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    vi.mocked(prisma.member.findUnique).mockImplementation((args: any) => {
      if (args?.where?.id === "member-A") {
        return Promise.resolve({ id: "member-A", user: { email: "a@test.com" } } as any);
      }
      return Promise.resolve(null);
    });

    const provider = makeEmailProvider();
    const event = { ...makeMentionEvent(), actorId: null } as unknown as DomainEvent;

    await handleMentionCreated(event, { emailProvider: provider });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());

    // Must NOT have been called with an empty-string id
    expect(prisma.member.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "" } }),
    );

    // Email still dispatched; actor name falls back to "Someone"
    const msg = provider.send.mock.calls[0]![0] as { text: string; html: string };
    expect(msg.text).toContain("Someone");
  });

  it("assignment: null actorId → member.findUnique NOT called with id:'', email dispatched with 'Someone'", async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    vi.mocked(prisma.member.findUnique).mockImplementation((args: any) => {
      if (args?.where?.id === "member-B") {
        return Promise.resolve({ id: "member-B", user: { email: "b@test.com" } } as any);
      }
      return Promise.resolve(null);
    });

    const provider = makeEmailProvider();
    const event = { ...makeAssignmentEvent(), actorId: null } as unknown as DomainEvent;

    await handleIssueAssigned(event, { emailProvider: provider });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());

    expect(prisma.member.findUnique).not.toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "" } }),
    );

    const msg = provider.send.mock.calls[0]![0] as { text: string; html: string };
    expect(msg.text).toContain("Someone");
  });
});

// ── Fix 6: issueKey URL-encoding ──────────────────────────────────────────────

describe("Fix 6 — issueKey with special chars is URL-encoded in CTA href", () => {
  afterEach(() => vi.clearAllMocks());

  it("mention: issueKey with special chars is percent-encoded in issueUrl", async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    vi.mocked(prisma.member.findUnique).mockImplementation((args: any) => {
      if (args?.where?.id === "member-A") {
        return Promise.resolve({ id: "member-A", user: { email: "a@test.com" } } as any);
      }
      return Promise.resolve({ id: "actor-id", user: { displayName: "Alice", email: "alice@test.com" } } as any);
    });

    const provider = makeEmailProvider();
    const event = makeMentionEvent({ issueKey: "KAN-42 special&key" });

    await handleMentionCreated(event, { emailProvider: provider });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());
    const msg = provider.send.mock.calls[0]![0] as { html: string };
    expect(msg.html).not.toContain("/issue/KAN-42 special&key");
    expect(msg.html).toContain("/issue/KAN-42%20special%26key");
  });

  it("assignment: issueKey with special chars is percent-encoded in issueUrl", async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    vi.mocked(prisma.member.findUnique).mockImplementation((args: any) => {
      if (args?.where?.id === "member-B") {
        return Promise.resolve({ id: "member-B", user: { email: "b@test.com" } } as any);
      }
      return Promise.resolve({ id: "actor-id", user: { displayName: "Bob" } } as any);
    });

    const provider = makeEmailProvider();
    const event = makeAssignmentEvent({ issueKey: "KAN-42 special&key" });

    await handleIssueAssigned(event, { emailProvider: provider });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());
    const msg = provider.send.mock.calls[0]![0] as { html: string };
    expect(msg.html).not.toContain("/issue/KAN-42 special&key");
    expect(msg.html).toContain("/issue/KAN-42%20special%26key");
  });
});

// ── Issue 1: issueTitle in mention email ──────────────────────────────────────

describe("Issue 1a — mention email uses issueTitle from payload, not issueKey", () => {
  beforeEach(() => {
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    vi.mocked(prisma.member.findUnique).mockImplementation((args: any) => {
      if (args?.where?.id === "member-A") {
        return Promise.resolve({ id: "member-A", user: { email: "a@test.com" } } as any);
      }
      // actor lookup
      return Promise.resolve({ id: "actor-id", user: { displayName: "Alice", email: "alice@test.com" } } as any);
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("email body/text contains the real issueTitle, not issueKey twice", async () => {
    const provider = makeEmailProvider();
    const event = makeMentionEvent({ issueTitle: "Fix the login bug" });

    await handleMentionCreated(event, { emailProvider: provider });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());
    const msg = provider.send.mock.calls[0]![0] as { subject: string; html: string; text: string; to: string };
    // The text must include the real title, not "KAN-42 — KAN-42"
    expect(msg.text).toContain("Fix the login bug");
    expect(msg.text).not.toMatch(/KAN-42.*KAN-42/);
    expect(msg.html).toContain("Fix the login bug");
  });
});

// ── Issue 1b: issueTitle in assignment email ──────────────────────────────────

describe("Issue 1b — assignment email uses issueTitle from payload, not issueKey", () => {
  beforeEach(() => {
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    vi.mocked(prisma.member.findUnique).mockImplementation((args: any) => {
      if (args?.where?.id === "member-B") {
        return Promise.resolve({ id: "member-B", user: { email: "b@test.com" } } as any);
      }
      return Promise.resolve({ id: "actor-id", user: { displayName: "Bob" } } as any);
    });
  });

  afterEach(() => vi.clearAllMocks());

  it("email body/text contains the real issueTitle, not issueKey twice", async () => {
    const provider = makeEmailProvider();
    const event = makeAssignmentEvent({ issueTitle: "Fix the login bug" });

    await handleIssueAssigned(event, { emailProvider: provider });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledOnce());
    const msg = provider.send.mock.calls[0]![0] as { subject: string; html: string; text: string; to: string };
    expect(msg.text).toContain("Fix the login bug");
    expect(msg.text).not.toMatch(/KAN-42.*KAN-42/);
    expect(msg.html).toContain("Fix the login bug");
  });
});

// ── Issue 2: email prep isolated (D3) ────────────────────────────────────────

describe("Issue 2 — email prep failure does NOT reject the handler", () => {
  afterEach(() => vi.clearAllMocks());

  it("mention handler: prefs query rejects after notification.create → handler resolves, row exists", async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    // prefs query rejects AFTER the row is created
    vi.mocked(prisma.notificationPreference.findMany).mockRejectedValue(
      new Error("DB connection lost"),
    );
    // member findUnique will also fail (after notification is written), but handler must still resolve
    vi.mocked(prisma.member.findUnique).mockRejectedValue(new Error("DB down"));

    const provider = makeEmailProvider();
    const logger = { error: vi.fn(), info: vi.fn() };

    // Handler must resolve without throwing
    await expect(
      handleMentionCreated(makeMentionEvent(), { emailProvider: provider, logger: logger as any }),
    ).resolves.toBeUndefined();

    // Notification row still created
    expect(prisma.notification.create).toHaveBeenCalledOnce();
  });

  it("assignment handler: prefs query rejects after notification.create → handler resolves, row exists", async () => {
    vi.mocked(prisma.notification.create).mockResolvedValue({} as any);
    vi.mocked(prisma.notificationPreference.findMany).mockRejectedValue(
      new Error("DB connection lost"),
    );
    vi.mocked(prisma.member.findUnique).mockRejectedValue(new Error("DB down"));

    const provider = makeEmailProvider();
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      handleIssueAssigned(makeAssignmentEvent(), { emailProvider: provider, logger: logger as any }),
    ).resolves.toBeUndefined();

    expect(prisma.notification.create).toHaveBeenCalledOnce();
  });
});

// ── Issue 3: cycle.closed coverage ───────────────────────────────────────────

describe("Issue 3 — handleCycleClosed dispatch verification", () => {
  const projectMembers = [{ userId: "user-1" }, { userId: "user-2" }];
  const members = [
    { id: "member-1", user: { email: "one@test.com" } },
    { id: "member-2", user: { email: "two@test.com" } },
  ];

  beforeEach(() => {
    vi.mocked(prisma.projectMember.findMany).mockResolvedValue(projectMembers as any);
    vi.mocked(prisma.member.findMany).mockResolvedValue(members as any);
  });

  afterEach(() => vi.clearAllMocks());

  it("opted-in member (no pref row → default ON) → provider.send called", async () => {
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    const provider = makeEmailProvider();

    await handleCycleClosed(makeCycleClosedEvent(), { emailProvider: provider });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledTimes(2)); // both members
    const calls = provider.send.mock.calls.map((c: any) => c[0].to);
    expect(calls).toContain("one@test.com");
    expect(calls).toContain("two@test.com");
  });

  it("opted-out member (emailCycleClosed=false) → send NOT called for that member", async () => {
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([
      {
        memberId: "member-1",
        emailMention: true,
        emailAssignment: true,
        emailCycleClosed: false,
      },
    ] as any);
    const provider = makeEmailProvider();

    await handleCycleClosed(makeCycleClosedEvent(), { emailProvider: provider });
    // Wait for the 1 opted-in send, then assert the opted-out member was not included
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledTimes(1));
    expect(provider.send.mock.calls[0]![0].to).toBe("two@test.com");
  });

  it("pref row absent → send called (default ON)", async () => {
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    const provider = makeEmailProvider();

    await handleCycleClosed(makeCycleClosedEvent(), { emailProvider: provider });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledTimes(2));
  });

  it("provider reject → handler does not throw", async () => {
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);
    const provider = makeEmailProvider();
    provider.send.mockRejectedValue(new Error("SMTP down"));
    const logger = { error: vi.fn(), info: vi.fn() };

    await expect(
      handleCycleClosed(makeCycleClosedEvent(), { emailProvider: provider, logger: logger as any }),
    ).resolves.toBeUndefined();

    // Wait for async work to complete and error to be logged
    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
  });

  // ── Fix 1: handleCycleClosed email body is fire-and-forget IIFE ──────────────

  it("fix-1: DB rejection in member resolution does NOT reject the handler", async () => {
    vi.mocked(prisma.projectMember.findMany).mockRejectedValue(new Error("DB down"));
    const provider = makeEmailProvider();
    const logger = { error: vi.fn(), info: vi.fn() };

    // Handler must resolve even when member resolution DB call rejects
    await expect(
      handleCycleClosed(makeCycleClosedEvent(), { emailProvider: provider, logger: logger as any }),
    ).resolves.toBeUndefined();

    await vi.waitFor(() => expect(logger.error).toHaveBeenCalled());
  });

  // ── Fix 2: email sends batched in chunks of 10 ───────────────────────────────

  it("fix-2: all recipients are emailed even with N>10 members", async () => {
    const N = 15;
    const bigProjectMembers = Array.from({ length: N }, (_, i) => ({ userId: `user-${i}` }));
    const bigMembers = Array.from({ length: N }, (_, i) => ({
      id: `member-${i}`,
      user: { email: `member${i}@test.com` },
    }));

    vi.mocked(prisma.projectMember.findMany).mockResolvedValue(bigProjectMembers as any);
    vi.mocked(prisma.member.findMany).mockResolvedValue(bigMembers as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);

    const provider = makeEmailProvider();

    await handleCycleClosed(makeCycleClosedEvent(), { emailProvider: provider });
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledTimes(N));
  });

  it("fix-2: a send rejection in one chunk does not stop subsequent recipients", async () => {
    const N = 12;
    const bigProjectMembers = Array.from({ length: N }, (_, i) => ({ userId: `user-${i}` }));
    const bigMembers = Array.from({ length: N }, (_, i) => ({
      id: `member-${i}`,
      user: { email: `member${i}@test.com` },
    }));

    vi.mocked(prisma.projectMember.findMany).mockResolvedValue(bigProjectMembers as any);
    vi.mocked(prisma.member.findMany).mockResolvedValue(bigMembers as any);
    vi.mocked(prisma.notificationPreference.findMany).mockResolvedValue([]);

    const provider = makeEmailProvider();
    const logger = { error: vi.fn(), info: vi.fn() };

    // Make 3rd send (index 2) fail
    provider.send.mockImplementation((msg: any) => {
      if (msg.to === "member2@test.com") return Promise.reject(new Error("429 rate limit"));
      return Promise.resolve();
    });

    await handleCycleClosed(makeCycleClosedEvent(), { emailProvider: provider, logger: logger as any });
    // All N sends attempted; failure logged; others proceeded
    await vi.waitFor(() => expect(provider.send).toHaveBeenCalledTimes(N));
    expect(logger.error).toHaveBeenCalled();
  });
});
