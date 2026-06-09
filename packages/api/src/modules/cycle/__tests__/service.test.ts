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

describe("A7.2 — computeAvgLeadDays: 1 done issue with completedAt → returns days (KAN-35 reader)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 5.5 when issue was created 10 days ago and completedAt 4.5 days ago", async () => {
    // createdAt = 10 days ago, completedAt = 4.5 days ago → delta = 5.5 days
    const now = new Date();
    const createdAt = new Date(now.getTime() - 10 * 86_400_000);
    const completedAt = new Date(now.getTime() - 4.5 * 86_400_000);

    // KAN-35: issue row now carries completedAt; no activityLog query
    mockIssueFindMany.mockResolvedValue([{ id: "iss-1", createdAt, completedAt }] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeCloseTo(5.5, 4);
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
  });

  it("passes cycleId correctly in the issue query (no activityLog batch query)", async () => {
    const now = new Date();
    const completedAt = now;
    mockIssueFindMany.mockResolvedValue([{ id: "iss-abc", createdAt: now, completedAt }] as any);

    await computeAvgLeadDays("cycle-x");

    expect(mockIssueFindMany).toHaveBeenCalledOnce();
    const callArgs = mockIssueFindMany.mock.calls[0]![0] as any;
    expect(callArgs.where.cycleId).toBe("cycle-x");
    // KAN-35: no activityLog fan-out
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
  });
});

describe("A7.3 — computeAvgLeadDays: 3 issues, 2 with completedAt → average over 2 (KAN-35 reader)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 3.0 when two issues took 2 and 4 days (third has completedAt=null)", async () => {
    const now = new Date();
    const iss1Created = new Date(now.getTime() - 5 * 86_400_000);
    const iss2Created = new Date(now.getTime() - 8 * 86_400_000);
    const iss3Created = new Date(now.getTime() - 3 * 86_400_000);

    const iss1CompletedAt = new Date(now.getTime() - 3 * 86_400_000); // 5-3=2 days lead
    const iss2CompletedAt = new Date(now.getTime() - 4 * 86_400_000); // 8-4=4 days lead

    // KAN-35: completedAt on issue row; iss-3 excluded because completedAt=null
    mockIssueFindMany.mockResolvedValue([
      { id: "iss-1", createdAt: iss1Created, completedAt: iss1CompletedAt },
      { id: "iss-2", createdAt: iss2Created, completedAt: iss2CompletedAt },
      { id: "iss-3", createdAt: iss3Created, completedAt: null }, // excluded
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeCloseTo(3.0, 4);
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
  });

  it("returns exact lead days — non-done issues excluded via completedAt=null", async () => {
    const now = new Date();
    const created = new Date(now.getTime() - 10 * 86_400_000);
    const completedAt = new Date(now.getTime() - 5 * 86_400_000); // 5 days lead

    // KAN-35: completedAt captures only done transitions; null = not done
    mockIssueFindMany.mockResolvedValue([
      { id: "iss-1", createdAt: created, completedAt }, // contributes
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeCloseTo(5.0, 4);
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
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

describe("A7.5 (was A7.4 in tasks) — computeAvgLeadDays: completedAt = createdAt → returns 0.0 (KAN-35 reader)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns 0.0 (not null) when issue was created and completed at the same instant", async () => {
    const sameTime = new Date("2026-01-15T10:00:00.000Z");

    // KAN-35: completedAt = createdAt → delta of 0 is valid, not null
    mockIssueFindMany.mockResolvedValue([
      { id: "iss-1", createdAt: sameTime, completedAt: sameTime },
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    // Must be 0 (zero), NOT null — delta of 0 is valid
    expect(result).toBe(0);
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
  });
});

describe("A7.5 — computeAvgLeadDays: anti N+1 — 50 issues → exactly 1 issue query, 0 activityLog queries (KAN-35 reader)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("issues exactly 1 issue query and 0 activityLog queries regardless of issue count", async () => {
    const now = new Date();
    const issues = Array.from({ length: 50 }, (_, i) => ({
      id: `iss-${i}`,
      createdAt: new Date(now.getTime() - 10 * 86_400_000),
      completedAt: null, // no completedAt — result will be null
    }));

    mockIssueFindMany.mockResolvedValue(issues as any);

    await computeAvgLeadDays("cycle-big");

    // Exactly 1 issue query (no activityLog fan-out at all — KAN-35 reader switch)
    expect(mockIssueFindMany).toHaveBeenCalledOnce();
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
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
// B2 — Legacy-done backward-compat: NEUTRALIZED (KAN-35 reader switch)
//
// The original B2 test verified that activityLog rows with { newValue: "done" }
// were counted by the burnup/lead-time reader via isDoneTransition. After the
// KAN-35 reader switch, computeAvgLeadDays and computeBurnup no longer scan
// ActivityLog at all — they read Issue.completedAt directly.
//
// The legacy-OR guarantee is now upheld by the in-migration backfill SQL which
// matches BOTH shapes: `details->>'to'='done' OR details->>'newValue'='done'`.
// That guarantee is verified by the backfill data-integrity test in Phase 5.
// ---------------------------------------------------------------------------

describe("B2 — legacy done shape { newValue: 'done' } — NEUTRALIZED after KAN-35 reader switch", () => {
  beforeEach(() => vi.clearAllMocks());

  it("SKIPPED — legacy-OR guarantee moved to backfill SQL (see Phase 5 data-integrity test)", () => {
    // This test is intentionally vacuous. The runtime reader no longer scans
    // ActivityLog, so there is nothing to assert here. The backfill SQL covers
    // the legacy shape guarantee at migration time.
    expect(true).toBe(true);
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

    // KAN-35: computeBurnup's own issue query reads completedAt, no activityLogs join
    mockIssueFindMany.mockResolvedValue([
      {
        id: "iss-done",
        estimate: 3,
        state: "done",
        completedAt: doneAt, // KAN-35: completion timestamp on the issue row
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

    // Discriminating assertion: points must FIRST appear at day 1, not at the
    // cycle end. Under the KAN-39 bug every done issue landed at the last index,
    // so indexOf(3) would have been burnup.length - 1, not 1.
    expect(burnup.indexOf(3)).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// KAN-35 Reader Switch — computeAvgLeadDays reads Issue.completedAt directly
// ---------------------------------------------------------------------------

describe("KAN-35 R1 — computeAvgLeadDays reads Issue.completedAt (no activityLog scan)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("R1.1 — returns correct lead days from completedAt field, no activityLog query", async () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 10 * 86_400_000);
    const completedAt = new Date(now.getTime() - 4.5 * 86_400_000); // 5.5-day lead

    mockIssueFindMany.mockResolvedValue([
      { id: "iss-1", createdAt, completedAt },
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeCloseTo(5.5, 4);
    // Must NOT call activityLog after KAN-35 reader switch
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
  });

  it("R1.2 — excludes issues with completedAt=null from lead-time average", async () => {
    const now = new Date();
    const createdAt = new Date(now.getTime() - 10 * 86_400_000);
    const completedAt = new Date(now.getTime() - 5 * 86_400_000); // 5-day lead

    mockIssueFindMany.mockResolvedValue([
      { id: "iss-1", createdAt, completedAt },        // contributes: 5 days
      { id: "iss-2", createdAt, completedAt: null },  // excluded (not yet completed)
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeCloseTo(5.0, 4);
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
  });

  it("R1.3 — returns null when all issues have completedAt=null", async () => {
    const now = new Date();
    mockIssueFindMany.mockResolvedValue([
      { id: "iss-1", createdAt: now, completedAt: null },
      { id: "iss-2", createdAt: now, completedAt: null },
    ] as any);

    const result = await computeAvgLeadDays("cycle-1");

    expect(result).toBeNull();
    expect(mockActivityLogFindMany).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KAN-35 R2 — computeBurnup reads Issue.completedAt with cycle.endDate fallback
// ---------------------------------------------------------------------------

describe("KAN-35 R2 — computeBurnup reads Issue.completedAt (no activityLog join)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("R2.1 — done issue with completedAt set buckets on its completion day, no activityLogs include", async () => {
    const start = new Date("2026-06-01T00:00:00.000Z");
    const end = new Date("2026-06-08T00:00:00.000Z");
    const completedAt = new Date("2026-06-02T00:00:00.000Z"); // day 1 of cycle

    mockCycleFindUnique.mockResolvedValue({
      id: "cycle-burnup-kan35",
      name: "Sprint KAN-35",
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
          updatedAt: completedAt,
          assignee: null,
        },
      ],
    } as any);

    mockCycleScopeEventFindMany.mockResolvedValue([] as any);

    // After KAN-35 reader switch: issue rows have completedAt, NO activityLogs include
    mockIssueFindMany.mockResolvedValue([
      {
        id: "iss-done",
        estimate: 3,
        state: "done",
        completedAt, // KAN-35: read from column
        // no activityLogs key — should not be accessed
      },
    ] as any);

    const result = await getCycle("cycle-burnup-kan35");

    const burnup = result.burnup;
    // Day 0 (start): no completions yet
    expect(burnup[0]).toBe(0);
    // Day 1: completedAt lands here → 3 points cumulative
    expect(burnup[1]).toBe(3);
    // Subsequent days remain at 3 (cumulative)
    for (let d = 2; d < burnup.length; d++) {
      expect(burnup[d]).toBe(3);
    }
    expect(burnup.indexOf(3)).toBe(1);
  });

  it("R2.2 — done issue with completedAt=null falls back to cycle.endDate", async () => {
    const start = new Date("2026-06-01T00:00:00.000Z");
    const end = new Date("2026-06-08T00:00:00.000Z");

    mockCycleFindUnique.mockResolvedValue({
      id: "cycle-fallback",
      name: "Sprint Fallback",
      startDate: start,
      endDate: end,
      state: "active",
      goal: null,
      projectId: "proj-1",
      createdAt: start,
      updatedAt: start,
      issues: [
        {
          id: "iss-done-no-ts",
          key: "KAN-2",
          title: "Historical done",
          type: "task",
          priority: "medium",
          state: "done",
          estimate: 2,
          updatedAt: start,
          assignee: null,
        },
      ],
    } as any);

    mockCycleScopeEventFindMany.mockResolvedValue([] as any);

    // completedAt=null → should fall back to end date (day 7)
    mockIssueFindMany.mockResolvedValue([
      {
        id: "iss-done-no-ts",
        estimate: 2,
        state: "done",
        completedAt: null, // no timestamp — historical issue
      },
    ] as any);

    const result = await getCycle("cycle-fallback");

    const burnup = result.burnup;
    // With endDate fallback, issue lands on day 7 (last day)
    // burnup[7] should be 2 (cumulative from day 7 onward)
    expect(burnup[7]).toBe(2);
    // Days 0-6 should all be 0
    for (let d = 0; d < 7; d++) {
      expect(burnup[d]).toBe(0);
    }
  });
});
