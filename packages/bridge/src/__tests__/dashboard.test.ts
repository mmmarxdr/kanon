/**
 * Bridge schema tests — dashboard schemas (inbox-redesign-cycle-c)
 *
 * Round-trip parse/serialize tests for:
 *   - activeCycleKPIsSchema   (A2.1)
 *   - mentionDashboardItemSchema (A2.2)
 *   - dashboardResponseSchema (A2.3)
 *
 * TDD flow:
 *  RED  — fails before dashboard.ts is created (imports fail)
 *  GREEN — passes after A2.4 IMPLEMENT
 *
 * Refs: REQ-INBOX-CYCLE-002, REQ-MENTION-007, REQ-API-DASHBOARD-002/005
 * Design §2.2, §2.3, §2.4
 */

import { describe, it, expect } from "vitest";
import {
  activeCycleKPIsSchema,
  mentionDashboardItemSchema,
  notificationDashboardItemSchema,
  dashboardResponseSchema,
} from "../dashboard.js";

// ─── A2.1 — activeCycleKPIsSchema ────────────────────────────────────────────

describe("activeCycleKPIsSchema", () => {
  const validKpis = {
    id: "00000000-0000-0000-0000-000000000001",
    name: "Sprint 1",
    projectName: "Atlas",
    startDate: "2026-04-21",
    endDate: "2026-05-05",
    completed: 5,
    scope: 8,
    donePct: 62,
    velocity: 3,
    avgLeadDays: 3.4,
    burnup: [0, 1, 2, 3, 3, 3, 4, 5],
  };

  it("parses a valid activeCycleKPIs object", () => {
    const result = activeCycleKPIsSchema.safeParse(validKpis);
    expect(result.success).toBe(true);
  });

  it("accepts avgLeadDays: null (no eligible issues)", () => {
    const result = activeCycleKPIsSchema.safeParse({
      ...validKpis,
      avgLeadDays: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.avgLeadDays).toBeNull();
  });

  it("accepts avgLeadDays: 0 (zero, not null)", () => {
    const result = activeCycleKPIsSchema.safeParse({
      ...validKpis,
      avgLeadDays: 0,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.avgLeadDays).toBe(0);
  });

  it("accepts avgLeadDays: 5.5 (decimal)", () => {
    const result = activeCycleKPIsSchema.safeParse({
      ...validKpis,
      avgLeadDays: 5.5,
    });
    expect(result.success).toBe(true);
  });

  it("accepts burnup: [] (empty array for new cycle)", () => {
    const result = activeCycleKPIsSchema.safeParse({
      ...validKpis,
      burnup: [],
    });
    expect(result.success).toBe(true);
  });

  it("accepts donePct: 0 (no issues done)", () => {
    const result = activeCycleKPIsSchema.safeParse({
      ...validKpis,
      donePct: 0,
      completed: 0,
    });
    expect(result.success).toBe(true);
  });

  it("accepts donePct: 100 (all done)", () => {
    const result = activeCycleKPIsSchema.safeParse({
      ...validKpis,
      donePct: 100,
      completed: 8,
    });
    expect(result.success).toBe(true);
  });

  it("rejects missing required field (name)", () => {
    const { name, ...rest } = validKpis;
    const result = activeCycleKPIsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects avgLeadDays: undefined (not nullable-undefined, must be null or number)", () => {
    const { avgLeadDays, ...rest } = validKpis;
    const result = activeCycleKPIsSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ─── A2.2 — mentionDashboardItemSchema ───────────────────────────────────────

describe("mentionDashboardItemSchema", () => {
  const validMention = {
    id: "00000000-0000-0000-0000-000000000002",
    issueKey: "KAN-42",
    issueTitle: "Fix login",
    commentId: "00000000-0000-0000-0000-000000000003",
    mentionedByUsername: "alice",
    context: "@bob revisa esto",
    createdAt: "2026-05-02T12:00:00.000Z",
  };

  it("parses a valid mentionDashboardItem with commentId", () => {
    const result = mentionDashboardItemSchema.safeParse(validMention);
    expect(result.success).toBe(true);
  });

  it("accepts commentId: null (mention from issue description)", () => {
    const result = mentionDashboardItemSchema.safeParse({
      ...validMention,
      commentId: null,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.commentId).toBeNull();
  });

  it("accepts commentId: valid uuid string", () => {
    const result = mentionDashboardItemSchema.safeParse({
      ...validMention,
      commentId: "00000000-0000-0000-0000-000000000099",
    });
    expect(result.success).toBe(true);
  });

  it("rejects commentId: empty string (must be uuid or null)", () => {
    const result = mentionDashboardItemSchema.safeParse({
      ...validMention,
      commentId: "",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const { id, ...rest } = validMention;
    const result = mentionDashboardItemSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects missing mentionedByUsername", () => {
    const { mentionedByUsername, ...rest } = validMention;
    const result = mentionDashboardItemSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("preserves all fields on successful parse", () => {
    const result = mentionDashboardItemSchema.safeParse(validMention);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.issueKey).toBe("KAN-42");
      expect(result.data.issueTitle).toBe("Fix login");
      expect(result.data.mentionedByUsername).toBe("alice");
      expect(result.data.context).toBe("@bob revisa esto");
    }
  });
});

// ─── A2.3 — dashboardResponseSchema ──────────────────────────────────────────

describe("dashboardResponseSchema", () => {
  const validCounts = {
    openIssues: 10,
    inProgress: 3,
    awaitingReview: 2,
    activeAgents: 1,
  };

  const validActiveCycle = {
    id: "00000000-0000-0000-0000-000000000010",
    name: "Sprint 1",
    projectName: "Atlas",
    startDate: "2026-04-21",
    endDate: "2026-05-05",
    completed: 5,
    scope: 8,
    donePct: 62,
    velocity: 3,
    avgLeadDays: 3.4,
    burnup: [0, 1, 2, 3, 4, 5],
  };

  const validMention = {
    id: "00000000-0000-0000-0000-000000000020",
    issueKey: "KAN-42",
    issueTitle: "Fix login",
    commentId: null,
    mentionedByUsername: "alice",
    context: "@bob check this",
    createdAt: "2026-05-02T12:00:00.000Z",
  };

  const baseResponse = {
    counts: validCounts,
    assigned: [],
    mentions: [],
    proposals: [],
    agents: [],
    activeCycle: null,
    multipleActiveProjects: false,
    notifications: [],
    unreadCount: 0,
  };

  it("parses a valid response with activeCycle: null", () => {
    const result = dashboardResponseSchema.safeParse(baseResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.activeCycle).toBeNull();
  });

  it("parses a valid response with activeCycle populated", () => {
    const result = dashboardResponseSchema.safeParse({
      ...baseResponse,
      activeCycle: validActiveCycle,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.activeCycle).not.toBeNull();
      expect(result.data.activeCycle?.name).toBe("Sprint 1");
    }
  });

  it("parses mentions: [] (empty array)", () => {
    const result = dashboardResponseSchema.safeParse(baseResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.mentions).toEqual([]);
  });

  it("parses mentions: [MentionDashboardItem]", () => {
    const result = dashboardResponseSchema.safeParse({
      ...baseResponse,
      mentions: [validMention],
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.mentions).toHaveLength(1);
      expect(result.data.mentions[0]?.issueKey).toBe("KAN-42");
    }
  });

  it("multipleActiveProjects: boolean is required", () => {
    const { multipleActiveProjects, ...rest } = baseResponse;
    const result = dashboardResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("multipleActiveProjects: true is accepted", () => {
    const result = dashboardResponseSchema.safeParse({
      ...baseResponse,
      activeCycle: validActiveCycle,
      multipleActiveProjects: true,
    });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.multipleActiveProjects).toBe(true);
  });

  it("multipleActiveProjects: false is accepted", () => {
    const result = dashboardResponseSchema.safeParse(baseResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.multipleActiveProjects).toBe(false);
  });

  it("notifications: [] is accepted", () => {
    const result = dashboardResponseSchema.safeParse(baseResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.notifications).toEqual([]);
  });

  it("unreadCount: 0 is accepted", () => {
    const result = dashboardResponseSchema.safeParse(baseResponse);
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unreadCount).toBe(0);
  });

  it("unreadCount: 5 is accepted", () => {
    const result = dashboardResponseSchema.safeParse({ ...baseResponse, unreadCount: 5 });
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.unreadCount).toBe(5);
  });

  it("notifications: populated with NotificationDashboardItem is accepted", () => {
    const validNotification = {
      id: "00000000-0000-0000-0000-000000000030",
      kind: "assignment" as const,
      issueId: "00000000-0000-0000-0000-000000000031",
      actorId: "00000000-0000-0000-0000-000000000032",
      mentionId: null,
      payload: { issueKey: "KAN-1" },
      read: false,
      via: "web",
      createdAt: "2026-06-07T12:00:00.000Z",
    };
    const result = dashboardResponseSchema.safeParse({
      ...baseResponse,
      notifications: [validNotification],
      unreadCount: 1,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.notifications).toHaveLength(1);
      expect(result.data.notifications[0]!.kind).toBe("assignment");
      expect(result.data.unreadCount).toBe(1);
    }
  });

  it("rejects response missing notifications field", () => {
    const { notifications, ...rest } = baseResponse;
    const result = dashboardResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it("rejects response missing unreadCount field", () => {
    const { unreadCount, ...rest } = baseResponse;
    const result = dashboardResponseSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});

// ─── S3 — notificationDashboardItemSchema ─────────────────────────────────────

describe("notificationDashboardItemSchema — S3 / KAN-27", () => {
  const validNotification = {
    id: "00000000-0000-0000-0000-000000000040",
    kind: "mention" as const,
    issueId: "00000000-0000-0000-0000-000000000041",
    actorId: "00000000-0000-0000-0000-000000000042",
    mentionId: "00000000-0000-0000-0000-000000000043",
    payload: { context: "@bob check this" },
    read: false,
    via: "claude-code",
    createdAt: "2026-06-07T15:00:00.000Z",
  };

  it("parses a valid notification item (kind=mention)", () => {
    const result = notificationDashboardItemSchema.safeParse(validNotification);
    expect(result.success).toBe(true);
  });

  it("parses a valid notification item with null fields (kind=assignment)", () => {
    const result = notificationDashboardItemSchema.safeParse({
      ...validNotification,
      kind: "assignment",
      mentionId: null,
      via: null,
      payload: null,
    });
    expect(result.success).toBe(true);
  });

  it("accepts all four kinds", () => {
    for (const kind of ["mention", "assignment", "subscribed_activity", "cycle_closed"] as const) {
      const result = notificationDashboardItemSchema.safeParse({
        ...validNotification,
        kind,
        mentionId: null,
        payload: null,
      });
      expect(result.success).toBe(true);
    }
  });

  it("rejects unknown kind", () => {
    const result = notificationDashboardItemSchema.safeParse({
      ...validNotification,
      kind: "unknown_kind",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing id", () => {
    const { id, ...rest } = validNotification;
    const result = notificationDashboardItemSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });
});
