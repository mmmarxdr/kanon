import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for cycle service — focused on Batch B work:
 *   B3/B4: createCycle({ attachIssueKeys }) atomic transaction
 *   B5/B6: getCycle scopeEvents pagination + ?includeAllScopeEvents
 *   B9:    closeCycle minimal ack + verbose opt-in
 *
 * Uses mocked Prisma. The transaction mock invokes the callback with a tx
 * stub exposing only the methods the production code touches.
 */

vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    cycle: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    cycleScopeEvent: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    issue: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    issueSchedule: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
      update: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { createCycle, getCycle, closeCycle, activateCycle, setBaseline } from "./service.js";
import { makeTxMock } from "./__test-helpers__/tx-mock.js";

const PROJECT = { id: "project-1", key: "ENG", workspaceId: "ws-1" };

describe("createCycle() — Batch B4 (atomic attachIssueKeys)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.findUnique).mockResolvedValue(PROJECT as any);
  });

  it("B4.1 — without attachIssueKeys, just creates cycle (no tx)", async () => {
    vi.mocked(prisma.cycle.create).mockResolvedValue({
      id: "cycle-1",
      name: "Sprint",
      state: "upcoming",
      projectId: PROJECT.id,
    } as any);

    await createCycle(PROJECT.id, {
      name: "Sprint",
      startDate: new Date("2026-04-20"),
      endDate: new Date("2026-05-04"),
    } as any);

    expect(prisma.cycle.create).toHaveBeenCalledOnce();
    // No attach work required → no transaction needed
    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.issue.updateMany).not.toHaveBeenCalled();
    expect(prisma.cycleScopeEvent.createMany).not.toHaveBeenCalled();
  });

  it("B4.2 — with empty attachIssueKeys, no tx, no attach work", async () => {
    vi.mocked(prisma.cycle.create).mockResolvedValue({
      id: "cycle-1",
      name: "Sprint",
      state: "upcoming",
      projectId: PROJECT.id,
    } as any);

    await createCycle(PROJECT.id, {
      name: "Sprint",
      startDate: new Date("2026-04-20"),
      endDate: new Date("2026-05-04"),
      attachIssueKeys: [],
    } as any);

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cycle.create).toHaveBeenCalledOnce();
  });

  it("B4.3 — with attachIssueKeys, runs cycle + attach in single transaction and emits SSE post-commit", async () => {
    // Pre-validate: SELECT issues by key → both belong to project
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { key: "ENG-1", projectId: PROJECT.id },
      { key: "ENG-2", projectId: PROJECT.id },
    ] as any);

    const tx = makeTxMock();
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    const result = await createCycle(
      "ENG",
      {
        name: "Sprint",
        startDate: new Date("2026-04-20"),
        endDate: new Date("2026-05-04"),
        attachIssueKeys: ["ENG-1", "ENG-2"],
      } as any,
      "member-1",
    );

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(tx.cycle.create).toHaveBeenCalledOnce();
    expect(tx.issue.updateMany).toHaveBeenCalledOnce();
    expect(tx.cycleScopeEvent.createMany).toHaveBeenCalledOnce();

    const updArg = tx.issue.updateMany.mock.calls[0]![0] as any;
    expect(updArg.where).toMatchObject({
      key: { in: ["ENG-1", "ENG-2"] },
      projectId: PROJECT.id,
    });
    expect(updArg.data).toEqual({ cycleId: "cycle-new" });

    const evArg = tx.cycleScopeEvent.createMany.mock.calls[0]![0] as any;
    expect(evArg.data).toHaveLength(2);
    expect(evArg.data[0]).toMatchObject({
      cycleId: "cycle-new",
      kind: "add",
      issueKey: "ENG-1",
      authorId: "member-1",
    });

    // Post-commit SSE: issue.updated per attached key
    const calls = vi.mocked(eventBus.emit).mock.calls
      .map((c) => c[0])
      .filter((e: any) => e.type === "issue.updated");
    expect(calls.length).toBe(2);
    expect(calls.map((c: any) => c.payload.issueKey).sort()).toEqual([
      "ENG-1",
      "ENG-2",
    ]);

    expect(result).toMatchObject({ id: "cycle-new", name: "Sprint" });
  });

  it("B4.4 — cross-project key throws CROSS_PROJECT_ISSUE; no cycle created, no tx", async () => {
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { key: "ENG-1", projectId: PROJECT.id },
      { key: "OTHER-9", projectId: "project-OTHER" },
    ] as any);

    await expect(
      createCycle(
        PROJECT.id,
        {
          name: "Sprint",
          startDate: new Date("2026-04-20"),
          endDate: new Date("2026-05-04"),
          attachIssueKeys: ["ENG-1", "OTHER-9"],
        } as any,
        "member-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CROSS_PROJECT_ISSUE",
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cycle.create).not.toHaveBeenCalled();
  });

  it("B4.5 — missing key throws CROSS_PROJECT_ISSUE; no cycle created", async () => {
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { key: "ENG-1", projectId: PROJECT.id },
      // ENG-999 missing
    ] as any);

    await expect(
      createCycle(
        PROJECT.id,
        {
          name: "Sprint",
          startDate: new Date("2026-04-20"),
          endDate: new Date("2026-05-04"),
          attachIssueKeys: ["ENG-1", "ENG-999"],
        } as any,
        "member-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CROSS_PROJECT_ISSUE",
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
    expect(prisma.cycle.create).not.toHaveBeenCalled();
  });

  it("B4.6 — failure during attach inside tx propagates and rolls back", async () => {
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { key: "ENG-1", projectId: PROJECT.id },
    ] as any);

    // Simulate Prisma rolling back when the callback throws.
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      const tx = makeTxMock();
      tx.issue.updateMany.mockRejectedValue(new Error("FK violation"));
      // cycle.create succeeds but the SUBSEQUENT updateMany throws,
      // and Prisma's $transaction propagates the error → caller observes it.
      return cb(tx);
    });

    await expect(
      createCycle(
        PROJECT.id,
        {
          name: "Sprint",
          startDate: new Date("2026-04-20"),
          endDate: new Date("2026-05-04"),
          attachIssueKeys: ["ENG-1"],
        } as any,
        "member-1",
      ),
    ).rejects.toThrow("FK violation");

    // No SSE emitted on rollback
    const calls = vi.mocked(eventBus.emit).mock.calls
      .map((c) => c[0])
      .filter((e: any) => e.type === "issue.updated");
    expect(calls.length).toBe(0);
  });

  it("B4.7 — state=active with attachIssueKeys demotes other active cycle inside tx (atomic)", async () => {
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { key: "ENG-1", projectId: PROJECT.id },
    ] as any);

    const tx = makeTxMock({
      cycleCreateResult: {
        id: "cycle-new",
        name: "Sprint",
        state: "active",
        projectId: PROJECT.id,
        startDate: new Date("2026-04-20"),
        endDate: new Date("2026-05-04"),
      },
    });
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    await createCycle(
      "ENG",
      {
        name: "Sprint",
        state: "active",
        startDate: new Date("2026-04-20"),
        endDate: new Date("2026-05-04"),
        attachIssueKeys: ["ENG-1"],
      } as any,
      "member-1",
    );

    // Demotion must run on the tx — not the global prisma — for atomicity
    expect(tx.cycle.updateMany).toHaveBeenCalledOnce();
    expect(prisma.cycle.updateMany).not.toHaveBeenCalled();
  });
});

describe("getCycle() — Batch B6 (scopeEvents pagination)", () => {
  function buildCycleRow(scopeEventCount: number) {
    return {
      id: "cycle-1",
      name: "Sprint",
      state: "active",
      projectId: PROJECT.id,
      startDate: new Date("2026-04-20"),
      endDate: new Date("2026-05-04"),
      issues: [],
      // No scopeEvents in include — service now fetches them separately
    };
  }

  function buildScopeEvents(n: number) {
    return Array.from({ length: n }, (_, i) => ({
      id: `evt-${i + 1}`,
      cycleId: "cycle-1",
      day: i + 1,
      kind: i % 2 === 0 ? ("add" as const) : ("remove" as const),
      issueKey: `ENG-${i + 1}`,
      reason: null,
      authorId: null,
      createdAt: new Date("2026-04-20"),
      author: null,
    }));
  }

  beforeEach(() => {
    vi.clearAllMocks();
    // KAN-36: computeBurnup now calls issue.findMany for removedKeys when scope
    // events reference keys not in current members. Mock returns [] (all deleted
    // → fallback estimate 1) so pagination tests don't error.
    vi.mocked(prisma.issue.findMany).mockResolvedValue([] as any);
  });

  it("B6.1 — default caps response at 20 events while exposing totalScopeEvents", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(buildCycleRow(30) as any);
    vi.mocked(prisma.cycleScopeEvent.findMany).mockResolvedValue(buildScopeEvents(30) as any);

    const result = await getCycle("cycle-1");

    expect(result.scopeEvents).toHaveLength(20);
    expect((result as any).totalScopeEvents).toBe(30);
  });

  it("B6.2 — includeAllScopeEvents=true returns full array", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(buildCycleRow(30) as any);
    vi.mocked(prisma.cycleScopeEvent.findMany).mockResolvedValue(buildScopeEvents(30) as any);

    const result = await getCycle("cycle-1", { includeAllScopeEvents: true });

    expect(result.scopeEvents).toHaveLength(30);
    expect((result as any).totalScopeEvents).toBe(30);
  });

  it("B6.3 — under-cap (5 events) returns all + totalScopeEvents=5", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(buildCycleRow(5) as any);
    vi.mocked(prisma.cycleScopeEvent.findMany).mockResolvedValue(buildScopeEvents(5) as any);

    const result = await getCycle("cycle-1");

    expect(result.scopeEvents).toHaveLength(5);
    expect((result as any).totalScopeEvents).toBe(5);
  });

  it("B6.4 — burnup risk math uses ALL events, not the capped slice", async () => {
    // 30 remove events at days 1..30. All current-member keys are empty (issues=[]),
    // so ALL are removedKeys → second findMany returns [] → fallback est=1 each.
    //
    // KAN-36 semantics: scopeAdded/scopeRemoved are point-sums of mid-cycle
    // events (elapsed >= 1) only. Planning-baseline event (elapsed=0) excluded.
    // createdAt is set to cycleStart + i*ONE_DAY_MS so elapsed = i.
    // → i=0 (elapsed=0) excluded; i=1..29 = 29 remove events × est=1 = 29 pts.
    // scopeAdded=0, scopeRemoved=29.
    //
    // The test still validates its original invariant: risk math uses the FULL
    // event set (all 30 events visible), not just the response-capped 20.
    const cycleStart = new Date("2026-04-20");
    const ONE_DAY_MS = 24 * 60 * 60 * 1000;
    const events = Array.from({ length: 30 }, (_, i) => ({
      id: `evt-${i + 1}`,
      cycleId: "cycle-1",
      day: i + 1,
      kind: "remove" as const,
      issueKey: `ENG-${i + 1}`,
      reason: null,
      authorId: null,
      createdAt: new Date(cycleStart.getTime() + i * ONE_DAY_MS),
      author: null,
    }));
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(buildCycleRow(30) as any);
    vi.mocked(prisma.cycleScopeEvent.findMany).mockResolvedValue(events as any);
    // removedKeys lookup: all keys deleted → [] → fallback est=1
    vi.mocked(prisma.issue.findMany).mockResolvedValue([] as any);

    const result = await getCycle("cycle-1");

    expect(result.scopeEvents).toHaveLength(20);
    expect((result as any).totalScopeEvents).toBe(30);
    // KAN-36: point-sums from mid-cycle events (day>=2). Day-1 excluded.
    // 29 remove events × fallback est=1 = 29 pts removed.
    expect((result as any).scopeAdded).toBe(0);
    expect((result as any).scopeRemoved).toBe(29);
    // No scope-creep risk — all events are removes (net drift is negative)
    const risks = (result as any).risks as Array<{ id: string }>;
    expect(risks.find((r) => r.id === "scope-creep")).toBeUndefined();
  });
});

describe("closeCycle() — Batch B9 (minimal ack default)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("B9.1 — default returns minimal ack { id, state, velocity, closedAt } where closedAt is its own distinct column (KAN-35)", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      state: "active",
      issues: [
        { estimate: 3, state: "done" },
        { estimate: 2, state: "done" },
        { estimate: 1, state: "in_progress" },
      ],
    } as any);
    const updatedAt = new Date("2026-04-27T19:00:00Z");
    const closedAt = new Date("2026-04-27T19:00:01Z"); // distinct from updatedAt
    vi.mocked(prisma.cycle.update).mockResolvedValue({
      id: "cycle-1",
      state: "done",
      velocity: 5,
      updatedAt,
      closedAt,
    } as any);

    const result = await closeCycle("cycle-1");

    // KAN-35: closedAt must be its own distinct field, not derived from updatedAt
    expect(result).toMatchObject({
      id: "cycle-1",
      state: "done",
      velocity: 5,
    });
    expect((result as any).closedAt).not.toBeNull();
    expect((result as any).closedAt).toBeInstanceOf(Date);
    // closedAt must be distinct from updatedAt — it is its own column, not a proxy
    expect((result as any).closedAt).not.toEqual(updatedAt);
    // Ack does NOT include the issues array or scope events
    expect((result as any).issues).toBeUndefined();
    expect((result as any).scopeEvents).toBeUndefined();
  });

  it("B9.2 — verbose=true returns the full updated cycle row", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      state: "active",
      issues: [{ estimate: 4, state: "done" }],
    } as any);
    const fullCycle = {
      id: "cycle-1",
      name: "Sprint",
      state: "done",
      velocity: 4,
      goal: null,
      startDate: new Date("2026-04-20"),
      endDate: new Date("2026-05-04"),
      projectId: PROJECT.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    vi.mocked(prisma.cycle.update).mockResolvedValue(fullCycle as any);

    const result = await closeCycle("cycle-1", { verbose: true });

    expect(result).toEqual(fullCycle);
  });
});

// ── KAN-152: baseline snapshot on activation (ADR-0008 #1, #2, #3) ──────────

const NOW = new Date("2026-05-01T12:00:00.000Z");

describe("activateCycle() — baseline snapshot", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BSL-1: snapshots baselines for in-cycle issues with plan dates, inside one tx", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      state: "upcoming",
      projectId: PROJECT.id,
      project: { workspaceId: PROJECT.workspaceId },
    } as any);

    const tx = makeTxMock();
    // Two eligible schedules (baselineSetAt null, at least one plan date)
    vi.mocked(tx.issueSchedule.findMany).mockResolvedValue([
      {
        issueId: "i1",
        startDate: new Date("2026-04-20"),
        dueDate: new Date("2026-04-25"),
        baselineSetAt: null,
      },
      {
        issueId: "i2",
        startDate: null,
        dueDate: new Date("2026-04-28"),
        baselineSetAt: null,
      },
    ] as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    await activateCycle("cycle-1");

    // Cycle was transitioned to active inside the tx
    expect(tx.cycle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "cycle-1" },
        data: expect.objectContaining({ state: "active" }),
      }),
    );

    // Eligible-schedule query filters on this cycle, null baseline, and a date present
    expect(tx.issueSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issue: { cycleId: "cycle-1" },
          baselineSetAt: null,
        }),
      }),
    );

    // One per-row update copying startDate→baselineStart, dueDate→baselineEnd
    expect(tx.issueSchedule.update).toHaveBeenCalledTimes(2);
    expect(tx.issueSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId: "i1" },
        data: expect.objectContaining({
          baselineStart: new Date("2026-04-20"),
          baselineEnd: new Date("2026-04-25"),
          baselineSetAt: expect.any(Date),
        }),
      }),
    );
  });

  it("BSL-2: re-activating an already-baselined cycle does NOT overwrite (immutability)", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      state: "upcoming",
      projectId: PROJECT.id,
      project: { workspaceId: PROJECT.workspaceId },
    } as any);

    const tx = makeTxMock();
    // No eligible schedules — every row already has baselineSetAt set, so the
    // null-guarded findMany returns nothing.
    vi.mocked(tx.issueSchedule.findMany).mockResolvedValue([]);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    await activateCycle("cycle-1");

    expect(tx.issueSchedule.update).not.toHaveBeenCalled();
  });

  it("BSL-3: issues with no dueDate are skipped — WHERE filters dueDate NOT NULL (Fix 2)", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      state: "upcoming",
      projectId: PROJECT.id,
      project: { workspaceId: PROJECT.workspaceId },
    } as any);

    const tx = makeTxMock();
    // findMany already excludes no-dueDate schedules via the WHERE clause; assert
    // that the query uses dueDate NOT NULL (not the old OR condition).
    vi.mocked(tx.issueSchedule.findMany).mockResolvedValue([]);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    await activateCycle("cycle-1");

    const call = vi.mocked(tx.issueSchedule.findMany).mock.calls[0]![0] as any;
    expect(call.where.dueDate).toEqual({ not: null });
    expect(call.where.OR).toBeUndefined();
    expect(tx.issueSchedule.update).not.toHaveBeenCalled();
  });
});

// ── Fix 1 (CRITICAL): state guard ────────────────────────────────────────────

describe("activateCycle() — state guard (Fix 1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BSL-SG-1: throws 409 INVALID_CYCLE_STATE when cycle.state === 'done'", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-done",
      state: "done",
      projectId: PROJECT.id,
    } as any);

    await expect(activateCycle("cycle-done")).rejects.toMatchObject({
      statusCode: 409,
      code: "INVALID_CYCLE_STATE",
    });

    // The transaction must NOT be opened — no demotion of the live active cycle
    expect(prisma.$transaction).not.toHaveBeenCalled();
    // updateMany must also not be called directly (belt-and-suspenders)
    expect(prisma.cycle.updateMany).not.toHaveBeenCalled();
  });

  it("BSL-SG-2: returns a FULL cycle row idempotently when state === 'active' (no-op, no demotion)", async () => {
    // The initial findUnique must select enough fields to be a full row, or
    // the service must re-fetch. Either way the returned object must carry
    // the same shape as the tx.cycle.update result (name, startDate, etc.).
    const fullActiveRow = {
      id: "cycle-active",
      name: "Sprint 1",
      state: "active",
      projectId: PROJECT.id,
      goal: null,
      startDate: new Date("2026-05-01"),
      endDate: new Date("2026-05-14"),
      velocity: null,
      closedAt: null,
      createdAt: new Date("2026-04-28"),
      updatedAt: new Date("2026-04-29"),
    };
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(fullActiveRow as any);

    const result = await activateCycle("cycle-active");

    // Must contain the full cycle fields — not a truncated {id, state, projectId} slice
    expect((result as any).name).toBe("Sprint 1");
    expect((result as any).startDate).toEqual(new Date("2026-05-01"));
    expect((result as any).endDate).toEqual(new Date("2026-05-14"));
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ── Fix 2: dueDate-required guard ────────────────────────────────────────────

describe("activateCycle() — dueDate-required baseline guard (Fix 2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BSL-DG-1: start-only schedule (dueDate null) is NOT baselined; dueDate-present IS baselined", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      state: "upcoming",
      projectId: PROJECT.id,
    } as any);

    const tx = makeTxMock();
    // findMany returns only the dueDate-present row (WHERE clause enforces dueDate NOT NULL)
    vi.mocked(tx.issueSchedule.findMany).mockResolvedValue([
      {
        issueId: "i-with-due",
        startDate: new Date("2026-04-20"),
        dueDate: new Date("2026-04-25"),
        baselineSetAt: null,
      },
    ] as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    await activateCycle("cycle-1");

    // The WHERE must filter dueDate NOT null (not the old OR condition)
    const call = vi.mocked(tx.issueSchedule.findMany).mock.calls[0]![0] as any;
    expect(call.where.dueDate).toEqual({ not: null });
    // No OR on startDate/dueDate
    expect(call.where.OR).toBeUndefined();

    // Only the dueDate-present row is updated
    expect(tx.issueSchedule.update).toHaveBeenCalledTimes(1);
    expect(tx.issueSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { issueId: "i-with-due" } }),
    );
  });
});

// ── Fix 4: project-scoped issueIds in setBaseline ────────────────────────────

describe("setBaseline() — project-scoped issueIds (Fix 4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BSL-PS-1: issueIds are scoped to the cycle's projectId AND cycleId (cross-project excluded)", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      projectId: PROJECT.id,
    } as any);

    const tx = makeTxMock();
    // Return one matching row so the empty-result guard does not fire;
    // the test's purpose is to assert the WHERE filter shape.
    vi.mocked(tx.issueSchedule.findMany).mockResolvedValue([
      {
        issueId: "i1",
        startDate: new Date("2026-04-20"),
        dueDate: new Date("2026-04-25"),
        baselineStart: null,
        baselineEnd: null,
      },
    ] as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    await setBaseline({
      cycleId: "cycle-1",
      issueIds: ["issue-a", "issue-b"],
      authorId: "member-1",
    });

    const call = vi.mocked(tx.issueSchedule.findMany).mock.calls[0]![0] as any;
    // The issue filter must scope to the cycle's projectId
    expect(call.where.issue.projectId).toBe(PROJECT.id);
    // AND to the cycle itself
    expect(call.where.issue.cycleId).toBe("cycle-1");
    // AND restrict to the provided issueIds
    expect(call.where.issue.id).toEqual({ in: ["issue-a", "issue-b"] });
  });

  it("BSL-PS-2: throws 400 NO_MATCHING_ISSUES when issueIds are provided but none match (e.g. cross-project)", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      projectId: PROJECT.id,
    } as any);

    const tx = makeTxMock();
    // None of the provided issueIds belong to this cycle's project
    vi.mocked(tx.issueSchedule.findMany).mockResolvedValue([]);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    await expect(
      setBaseline({ cycleId: "cycle-1", issueIds: ["foreign-id"], authorId: "member-1" }),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "NO_MATCHING_ISSUES",
    });

    // No update or audit written
    expect(tx.issueSchedule.update).not.toHaveBeenCalled();
    expect(tx.activityLog.create).not.toHaveBeenCalled();
  });
});

// ── Fix 5: createCycle Path B snapshot assertion ──────────────────────────────

describe("createCycle() — Path B baseline snapshot when state=active (Fix 5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.findUnique).mockResolvedValue(PROJECT as any);
  });

  it("BSL-PB-1: snapshots baseline for an attached issue with dueDate inside the createCycle-active tx", async () => {
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { key: "ENG-1", projectId: PROJECT.id },
    ] as any);

    const tx = makeTxMock({
      cycleCreateResult: {
        id: "cycle-new",
        name: "Sprint",
        state: "active",
        projectId: PROJECT.id,
        startDate: new Date("2026-04-20"),
        endDate: new Date("2026-05-04"),
      },
    });

    // The attached issue has a dueDate → eligible for baseline
    vi.mocked(tx.issueSchedule.findMany).mockResolvedValue([
      {
        issueId: "i1",
        startDate: new Date("2026-04-20"),
        dueDate: new Date("2026-04-25"),
        baselineSetAt: null,
      },
    ] as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    await createCycle(
      PROJECT.id,
      {
        name: "Sprint",
        startDate: new Date("2026-04-20"),
        endDate: new Date("2026-05-04"),
        state: "active",
        attachIssueKeys: ["ENG-1"],
      },
      "author-1",
    );

    // Baseline snapshot was triggered inside the tx
    expect(tx.issueSchedule.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          issue: { cycleId: "cycle-new" },
          baselineSetAt: null,
          dueDate: { not: null },
        }),
      }),
    );
    expect(tx.issueSchedule.update).toHaveBeenCalledOnce();
    expect(tx.issueSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId: "i1" },
        data: expect.objectContaining({
          baselineEnd: new Date("2026-04-25"),
          baselineSetAt: expect.any(Date),
        }),
      }),
    );
  });
});

describe("setBaseline() — explicit re-baseline admin op (ADR-0008 #3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("BSL-4: overwrites an existing baseline AND writes an audit record with previous values", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue({
      id: "cycle-1",
      projectId: PROJECT.id,
    } as any);

    const tx = makeTxMock();
    // Schedule already has a baseline set — setBaseline overwrites it.
    vi.mocked(tx.issueSchedule.findMany).mockResolvedValue([
      {
        issueId: "i1",
        startDate: new Date("2026-04-22"),
        dueDate: new Date("2026-04-27"),
        baselineStart: new Date("2026-04-20"),
        baselineEnd: new Date("2026-04-25"),
        baselineSetAt: new Date("2026-04-19"),
      },
    ] as any);
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

    await setBaseline({ cycleId: "cycle-1", authorId: "member-1" });

    // Overwrites with current plan dates even though a baseline already existed
    expect(tx.issueSchedule.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { issueId: "i1" },
        data: expect.objectContaining({
          baselineStart: new Date("2026-04-22"),
          baselineEnd: new Date("2026-04-27"),
          baselineSetAt: expect.any(Date),
        }),
      }),
    );

    // Audit record captures who + previous baseline values
    expect(tx.activityLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          issueId: "i1",
          memberId: "member-1",
          action: "baseline_set",
          details: expect.objectContaining({
            previousBaselineStart: "2026-04-20T00:00:00.000Z",
            previousBaselineEnd: "2026-04-25T00:00:00.000Z",
          }),
        }),
      }),
    );
  });
});
