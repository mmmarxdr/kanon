import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for cycle service — A7.x + A8.x (Batch 3)
 *
 * A7.x — computeAvgLeadDays(cycleId): Promise<number | null>
 * A8.x — resolveActiveCycleForWorkspace(workspaceId): Promise<{...} | null>
 */

// --- Mocks ---

vi.mock("../../../config/prisma.js", () => ({
  prisma: {
    issue: {
      findMany: vi.fn(),
    },
    activityLog: {
      findMany: vi.fn(),
    },
    cycle: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
    },
    cycleScopeEvent: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock("../../../services/event-bus/index.js", () => ({
  eventBus: { emit: vi.fn() },
}));

import { prisma } from "../../../config/prisma.js";
import { computeAvgLeadDays, getCycle, resolveActiveCycleForWorkspace } from "../service.js";

const mockIssueFindMany = vi.mocked(prisma.issue.findMany);
const mockActivityLogFindMany = vi.mocked(prisma.activityLog.findMany);
const mockCycleFindMany = vi.mocked(prisma.cycle.findMany);
const mockCycleFindUnique = vi.mocked(prisma.cycle.findUnique);
const mockCycleScopeEventFindMany = vi.mocked(prisma.cycleScopeEvent.findMany);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function daysAgo(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

function makeIssue(id: string, createdDaysAgo: number) {
  return {
    id,
    createdAt: daysAgo(createdDaysAgo),
  };
}

function makeActivityLog(issueId: string, doneDaysAgo: number) {
  return {
    issueId,
    createdAt: daysAgo(doneDaysAgo),
    details: { from: "in_progress", to: "done" },
  };
}

function makeActivityLogNotDone(issueId: string) {
  return {
    issueId,
    createdAt: new Date(),
    details: { from: "todo", to: "review" }, // NOT done
  };
}

// ---------------------------------------------------------------------------
// A7 Tests — computeAvgLeadDays
// ---------------------------------------------------------------------------

describe("A7.1 — computeAvgLeadDays: cycle with 0 done issues → null", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when no issues exist in the cycle", async () => {
    mockIssueFindMany.mockResolvedValue([]);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeNull();
  });

  it("does NOT query activityLogs when there are no issues", async () => {
    mockIssueFindMany.mockResolvedValue([]);

    await computeAvgLeadDays("cycle-1");

    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
  });
});

describe("A7.2 — computeAvgLeadDays: 1 done issue with log → returns days", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 5.5 when issue was created 10 days ago and done 4.5 days ago", async () => {
    // createdAt = 10 days ago, doneAt = 4.5 days ago → delta = 5.5 days
    const now = new Date();
    const createdAt = new Date(now.getTime() - 10 * 86_400_000);
    const doneAt = new Date(now.getTime() - 4.5 * 86_400_000);

    mockIssueFindMany.mockResolvedValue([{ id: "iss-1", createdAt }] as any);
    mockActivityLogFindMany.mockResolvedValue([
      { issueId: "iss-1", createdAt: doneAt, details: { from: "in_progress", to: "done" } },
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeCloseTo(5.5, 4);
  });

  it("passes issueIds correctly in the batch activityLog query", async () => {
    const now = new Date();
    mockIssueFindMany.mockResolvedValue([{ id: "iss-abc", createdAt: now }] as any);
    mockActivityLogFindMany.mockResolvedValue([
      { issueId: "iss-abc", createdAt: now, details: { from: "in_progress", to: "done" } },
    ] as any);

    await computeAvgLeadDays("cycle-x");

    expect(mockActivityLogFindMany).toHaveBeenCalledOnce();
    const callArgs = mockActivityLogFindMany.mock.calls[0]![0] as any;
    expect(callArgs.where.issueId).toMatchObject({ in: ["iss-abc"] });
    expect(callArgs.where.action).toBe("state_changed");
  });
});

describe("A7.3 — computeAvgLeadDays: 3 issues, 2 with log → average over 2", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 3.0 when two issues took 2 and 4 days (third has no log)", async () => {
    const now = new Date();
    const iss1Created = new Date(now.getTime() - 5 * 86_400_000);
    const iss2Created = new Date(now.getTime() - 8 * 86_400_000);
    const iss3Created = new Date(now.getTime() - 3 * 86_400_000);

    const iss1Done = new Date(now.getTime() - 3 * 86_400_000); // 5-3=2 days lead
    const iss2Done = new Date(now.getTime() - 4 * 86_400_000); // 8-4=4 days lead

    mockIssueFindMany.mockResolvedValue([
      { id: "iss-1", createdAt: iss1Created },
      { id: "iss-2", createdAt: iss2Created },
      { id: "iss-3", createdAt: iss3Created }, // no done log
    ] as any);

    mockActivityLogFindMany.mockResolvedValue([
      { issueId: "iss-1", createdAt: iss1Done, details: { from: "in_progress", to: "done" } },
      { issueId: "iss-2", createdAt: iss2Done, details: { from: "review", to: "done" } },
      // iss-3 has NO done log (missing entirely)
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeCloseTo(3.0, 4);
  });

  it("ignores non-done state_changed logs when computing average", async () => {
    const now = new Date();
    const created = new Date(now.getTime() - 10 * 86_400_000);
    const doneAt = new Date(now.getTime() - 5 * 86_400_000); // 5 days lead

    mockIssueFindMany.mockResolvedValue([{ id: "iss-1", createdAt: created }] as any);
    mockActivityLogFindMany.mockResolvedValue([
      { issueId: "iss-1", createdAt: new Date(), details: { from: "todo", to: "review" } }, // not done
      { issueId: "iss-1", createdAt: doneAt, details: { from: "review", to: "done" } },
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeCloseTo(5.0, 4);
  });
});

describe("A7.4 — computeAvgLeadDays: all done issues missing log → null", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when issues exist but none have a state_changed→done log", async () => {
    const now = new Date();
    mockIssueFindMany.mockResolvedValue([
      { id: "iss-1", createdAt: now },
      { id: "iss-2", createdAt: now },
    ] as any);

    // Only non-done logs
    mockActivityLogFindMany.mockResolvedValue([
      { issueId: "iss-1", createdAt: now, details: { from: "todo", to: "review" } },
      { issueId: "iss-2", createdAt: now, details: { from: "todo", to: "in_progress" } },
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeNull();
  });

  it("returns null when activityLog query returns empty array", async () => {
    mockIssueFindMany.mockResolvedValue([{ id: "iss-1", createdAt: new Date() }] as any);
    mockActivityLogFindMany.mockResolvedValue([] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeNull();
  });
});

describe("A7.5 (was A7.4 in tasks) — computeAvgLeadDays: done_at = createdAt → returns 0.0", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 0.0 (not null) when issue was created and done at the same instant", async () => {
    const sameTime = new Date("2026-01-15T10:00:00.000Z");

    mockIssueFindMany.mockResolvedValue([{ id: "iss-1", createdAt: sameTime }] as any);
    mockActivityLogFindMany.mockResolvedValue([
      { issueId: "iss-1", createdAt: sameTime, details: { from: "in_progress", to: "done" } },
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    // Must be 0 (zero), NOT null — delta of 0 is valid
    expect(result).toBe(0);
  });
});

describe("A7.5 — computeAvgLeadDays: anti N+1 — 50 issues → exactly 1 activityLog query", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues one batch activityLog query regardless of issue count", async () => {
    const now = new Date();
    const issues = Array.from({ length: 50 }, (_, i) => ({
      id: `iss-${i}`,
      createdAt: new Date(now.getTime() - 10 * 86_400_000),
    }));

    mockIssueFindMany.mockResolvedValue(issues as any);
    mockActivityLogFindMany.mockResolvedValue([]); // no done events — result will be null

    await computeAvgLeadDays("cycle-big");

    // Exactly 1 call regardless of how many issues
    expect(mockActivityLogFindMany).toHaveBeenCalledOnce();

    // And that one call uses the batch { in: [...] } pattern
    const callArgs = mockActivityLogFindMany.mock.calls[0]![0] as any;
    expect(callArgs.where.issueId.in).toHaveLength(50);
  });
});

// ---------------------------------------------------------------------------
// A8 Tests — resolveActiveCycleForWorkspace
// ---------------------------------------------------------------------------

describe("A8.1 — resolveActiveCycleForWorkspace: no active cycles → null", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns null when workspace has no active cycles", async () => {
    mockCycleFindMany.mockResolvedValue([]);

    const result = await resolveActiveCycleForWorkspace("ws-1");

    expect(result).toBeNull();
  });
});

describe("A8.2 — resolveActiveCycleForWorkspace: 1 active cycle → returns it, multipleActiveProjects=false", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the active cycle with multipleActiveProjects=false when only 1 project has an active cycle", async () => {
    const startDate = new Date("2026-05-01");
    const endDate = new Date("2026-05-14");

    mockCycleFindMany.mockResolvedValue([
      {
        id: "cycle-1",
        name: "Sprint 1",
        startDate,
        endDate,
        projectId: "proj-1",
        project: { name: "Phoenix" },
      },
    ] as any);

    const result = await resolveActiveCycleForWorkspace("ws-1");

    expect(result).not.toBeNull();
    expect(result!.cycle.id).toBe("cycle-1");
    expect(result!.cycle.name).toBe("Sprint 1");
    expect(result!.projectName).toBe("Phoenix");
    expect(result!.multipleActiveProjects).toBe(false);
  });
});

describe("A8.3 — resolveActiveCycleForWorkspace: multiple projects with active cycles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns the cycle with most recent startDate, multipleActiveProjects=true when 3 projects each have a cycle", async () => {
    // Three cycles in different projects, ordered by startDate DESC (most recent first)
    // The service relies on ORDER BY in the DB query — mock returns them in correct order
    const recentStart = new Date("2026-05-01");
    const olderStart = new Date("2026-04-21");
    const oldestStart = new Date("2026-04-14");

    mockCycleFindMany.mockResolvedValue([
      {
        id: "cycle-c",
        name: "Sprint C",
        startDate: recentStart,
        endDate: new Date("2026-05-14"),
        projectId: "proj-3",
        project: { name: "Gamma" },
      },
      {
        id: "cycle-b",
        name: "Sprint B",
        startDate: olderStart,
        endDate: new Date("2026-05-05"),
        projectId: "proj-2",
        project: { name: "Beta" },
      },
      {
        id: "cycle-a",
        name: "Sprint A",
        startDate: oldestStart,
        endDate: new Date("2026-04-28"),
        projectId: "proj-1",
        project: { name: "Alpha" },
      },
    ] as any);

    const result = await resolveActiveCycleForWorkspace("ws-1");

    expect(result).not.toBeNull();
    // Winner is cycle-c (most recent startDate — first in ORDER BY DESC)
    expect(result!.cycle.id).toBe("cycle-c");
    expect(result!.projectName).toBe("Gamma");
    expect(result!.multipleActiveProjects).toBe(true);
  });

  it("returns the cycle with lexicographically smaller id as tiebreaker when startDates are equal", async () => {
    const sameDate = new Date("2026-05-01");

    // Mock returns in id ASC order (as per ORDER BY startDate DESC, id ASC)
    // "a-cycle" comes before "b-cycle" lexicographically
    mockCycleFindMany.mockResolvedValue([
      {
        id: "a-cycle-001",
        name: "Sprint A",
        startDate: sameDate,
        endDate: new Date("2026-05-14"),
        projectId: "proj-1",
        project: { name: "Alpha" },
      },
      {
        id: "b-cycle-002",
        name: "Sprint B",
        startDate: sameDate,
        endDate: new Date("2026-05-14"),
        projectId: "proj-2",
        project: { name: "Beta" },
      },
    ] as any);

    const result = await resolveActiveCycleForWorkspace("ws-1");

    // Winner is the one with smaller id when startDate is tied
    expect(result!.cycle.id).toBe("a-cycle-001");
    expect(result!.multipleActiveProjects).toBe(true);
  });
});

describe("A8.4 — resolveActiveCycleForWorkspace: 2 cycles in same project → multipleActiveProjects=false", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns multipleActiveProjects=false when all active cycles belong to the same project", async () => {
    const startDate1 = new Date("2026-05-01");
    const startDate2 = new Date("2026-04-15");

    mockCycleFindMany.mockResolvedValue([
      {
        id: "cycle-2",
        name: "Sprint 2",
        startDate: startDate1,
        endDate: new Date("2026-05-14"),
        projectId: "proj-1", // same project
        project: { name: "Phoenix" },
      },
      {
        id: "cycle-1",
        name: "Sprint 1",
        startDate: startDate2,
        endDate: new Date("2026-04-28"),
        projectId: "proj-1", // same project
        project: { name: "Phoenix" },
      },
    ] as any);

    const result = await resolveActiveCycleForWorkspace("ws-1");

    expect(result).not.toBeNull();
    // Most recent startDate wins
    expect(result!.cycle.id).toBe("cycle-2");
    // Only 1 distinct projectId → multipleActiveProjects=false
    expect(result!.multipleActiveProjects).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// B1 Regression — computeBurnup: done issue with details.to=="done" on early
//                  day must bucket completion on THAT day, not the cycle end.
//                  KAN-39 root cause: reader was checking det?.newValue==="done"
//                  which never matched the {from,to} shape production writes.
// ---------------------------------------------------------------------------

describe("B1 — computeBurnup regression (KAN-39): done issue logged early buckets on its day, not cycle end", () => {
  beforeEach(() => vi.clearAllMocks());

  it("places the done issue's points on day 1 of a 7-day cycle, not day 7", async () => {
    // Cycle: 2026-06-01 (start) → 2026-06-08 (end) = 7 days
    const start = new Date("2026-06-01T00:00:00.000Z");
    const end = new Date("2026-06-08T00:00:00.000Z");

    // Issue done exactly 1 day after start → Math.round(1.0)=1 → day index 1
    const doneAt = new Date("2026-06-02T00:00:00.000Z");

    // getCycle calls prisma.cycle.findUnique then prisma.cycleScopeEvent.findMany
    // then prisma.issue.findMany (for burnup) then prisma.activityLog.findMany (for burnup).
    mockCycleFindUnique.mockResolvedValue({
      id: "cycle-burnup",
      name: "Sprint Burnup",
      startDate: start,
      endDate: end,
      state: "active",
      goal: null,
      projectId: "proj-1",
      createdAt: start,
      updatedAt: start,
      issues: [
        {
          id: "iss-done",
          key: "KAN-1",
          title: "Done early",
          type: "task",
          priority: "medium",
          state: "done",
          estimate: 3,
          updatedAt: doneAt,
          assignee: null,
        },
      ],
    } as any);

    mockCycleScopeEventFindMany.mockResolvedValue([] as any);

    // computeBurnup's own issue query (includes activityLogs)
    mockIssueFindMany.mockResolvedValue([
      {
        id: "iss-done",
        estimate: 3,
        state: "done",
        activityLogs: [
          // Production shape: { from, to } — NOT { newValue }
          { createdAt: doneAt, details: { from: "in_progress", to: "done" } },
        ],
      },
    ] as any);

    const result = await getCycle("cycle-burnup");

    // The burnup series must have risen BEFORE the last index.
    // With the bug (newValue check), every done issue falls back to `end`,
    // so all points land at the last index: [0,0,0,0,0,0,0,3].
    // With the fix (to check), day-1 gets the 3 points: [0,3,3,3,3,3,3,3].
    const burnup = result.burnup;

    // burnup[0] = day 0 (start day) — issue not yet done
    expect(burnup[0]).toBe(0);

    // burnup[1] = day 1 — done event fires here; cumulative must be 3
    expect(burnup[1]).toBe(3);

    // All subsequent days stay at 3 (cumulative, no regression)
    for (let d = 2; d < burnup.length; d++) {
      expect(burnup[d]).toBe(3);
    }

    // Specifically, the LAST day must NOT be where the points first appear.
    // This is the exact symptom of the KAN-39 bug.
    expect(burnup[burnup.length - 1]).toBe(3); // still 3, not "first 3"
    // And crucially: series rises on day 1, not only at the end
    expect(burnup[1]).toBeGreaterThan(burnup[0]);
  });
});
