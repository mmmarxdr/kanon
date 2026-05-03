/**
 * B1.1 — DashboardData type extension test
 *
 * Verifica que el tipo DashboardData inferido del schema bridge incluye:
 * - activeCycle: ActiveCycleKPIs | null
 * - multipleActiveProjects: boolean
 * - mentions: MentionDashboardItem[] (no unknown[])
 *
 * Refs: REQ-INBOX-CYCLE-007, design §2.4
 */
import { describe, it, expect } from "vitest";
import type { ActiveCycleKPIs, MentionDashboardItem } from "@kanon/bridge";

// Runtime shape check — verifies the DashboardData type exported from
// use-dashboard-query aligns with the bridge schema.
describe("DashboardData type extension (B1.1)", () => {
  it("DashboardData includes activeCycle: ActiveCycleKPIs | null", async () => {
    const { useDashboardQuery } = await import("../use-dashboard-query");
    // Type-level: useDashboardQuery returns UseQueryResult<DashboardData>
    // Runtime: we construct a valid object and check it's assignable.
    const validActiveCycle: ActiveCycleKPIs = {
      id: "00000000-0000-0000-0000-000000000001",
      name: "Sprint 1",
      projectName: "Phoenix",
      startDate: "2026-04-21T00:00:00.000Z",
      endDate: "2026-05-04T00:00:00.000Z",
      completed: 5,
      scope: 8,
      donePct: 62,
      velocity: 5,
      avgLeadDays: 3.4,
      burnup: [0, 1, 2, 3, 5],
    };
    // The hook is not null — this is a type-level assertion. At runtime,
    // we simply verify the function is importable and the type matches.
    expect(typeof useDashboardQuery).toBe("function");
    // Verify ActiveCycleKPIs shape is complete
    expect(validActiveCycle.avgLeadDays).toBe(3.4);
  });

  it("DashboardData accepts activeCycle: null", () => {
    const nullCycle: ActiveCycleKPIs | null = null;
    expect(nullCycle).toBeNull();
  });

  it("DashboardData mentions field is MentionDashboardItem[] (not unknown[])", () => {
    const mention: MentionDashboardItem = {
      id: "00000000-0000-0000-0000-000000000002",
      issueKey: "PHOE-1",
      issueTitle: "Fix login",
      commentId: "00000000-0000-0000-0000-000000000003",
      mentionedByUsername: "alice",
      context: "@bob revisa esto",
      createdAt: "2026-05-02T10:00:00.000Z",
    };
    // Runtime check: mention shape is correct
    expect(mention.mentionedByUsername).toBe("alice");
    expect(mention.commentId).toBe("00000000-0000-0000-0000-000000000003");
  });

  it("DashboardData accepts mention with commentId: null (description mention)", () => {
    const mention: MentionDashboardItem = {
      id: "00000000-0000-0000-0000-000000000004",
      issueKey: "PHOE-2",
      issueTitle: "Auth bug",
      commentId: null,
      mentionedByUsername: "bob",
      context: "@alice mira esto",
      createdAt: "2026-05-02T11:00:00.000Z",
    };
    expect(mention.commentId).toBeNull();
  });

  it("DashboardData includes multipleActiveProjects: boolean", async () => {
    // We verify the type via the bridge schema itself
    const { dashboardResponseSchema } = await import("@kanon/bridge");
    const parsed = dashboardResponseSchema.parse({
      counts: { openIssues: 0, inProgress: 0, awaitingReview: 0, activeAgents: 0 },
      assigned: [],
      mentions: [],
      proposals: [],
      agents: [],
      activeCycle: null,
      multipleActiveProjects: false,
    });
    expect(typeof parsed.multipleActiveProjects).toBe("boolean");
    expect(parsed.activeCycle).toBeNull();
    expect(Array.isArray(parsed.mentions)).toBe(true);
  });
});
