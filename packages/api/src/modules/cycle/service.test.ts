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

vi.mock("../../config/engram.js", () => ({
  getEngramClient: vi.fn().mockReturnValue(null),
}));

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
    project: {
      findFirst: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { createCycle, getCycle, closeCycle } from "./service.js";

const PROJECT = { id: "project-1", key: "ENG", workspaceId: "ws-1" };

/**
 * Build a tx stub that records calls to the methods exercised by createCycle
 * (with optional attachIssueKeys). The stub returns sensible defaults so the
 * production code can chain calls without throwing.
 */
function makeTxMock(overrides?: {
  cycleCreateResult?: unknown;
  shouldThrow?: boolean;
}) {
  const cycleCreateResult = overrides?.cycleCreateResult ?? {
    id: "cycle-new",
    name: "Sprint",
    state: "upcoming",
    projectId: PROJECT.id,
    startDate: new Date("2026-04-20"),
    endDate: new Date("2026-05-04"),
  };

  const tx = {
    cycle: {
      create: vi.fn().mockImplementation(async () => {
        if (overrides?.shouldThrow) throw new Error("tx-fail");
        return cycleCreateResult;
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    issue: {
      updateMany: vi.fn().mockResolvedValue({ count: 0 }),
    },
    cycleScopeEvent: {
      createMany: vi.fn().mockResolvedValue({ count: 0 }),
      create: vi.fn().mockResolvedValue({}),
    },
  };
  return tx;
}

describe("createCycle() — Batch B4 (atomic attachIssueKeys)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.findFirst).mockResolvedValue(PROJECT as any);
  });

  it("B4.1 — without attachIssueKeys, just creates cycle (no tx)", async () => {
    vi.mocked(prisma.cycle.create).mockResolvedValue({
      id: "cycle-1",
      name: "Sprint",
      state: "upcoming",
      projectId: PROJECT.id,
    } as any);

    await createCycle("ENG", {
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

    await createCycle("ENG", {
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
        "ENG",
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
        "ENG",
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
        "ENG",
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
    // 30 events, all ADDs; risk rule "scope-creep" triggers at scopeNet >= 4.
    // If risk math saw only the capped 20, it would still trigger — but if we
    // construct a case where all events are removes (net = -30), risk should
    // not include scope-creep regardless of cap.
    const events = Array.from({ length: 30 }, (_, i) => ({
      id: `evt-${i + 1}`,
      cycleId: "cycle-1",
      day: i + 1,
      kind: "remove" as const,
      issueKey: `ENG-${i + 1}`,
      reason: null,
      authorId: null,
      createdAt: new Date("2026-04-20"),
      author: null,
    }));
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(buildCycleRow(30) as any);
    vi.mocked(prisma.cycleScopeEvent.findMany).mockResolvedValue(events as any);

    const result = await getCycle("cycle-1");

    expect(result.scopeEvents).toHaveLength(20);
    expect((result as any).totalScopeEvents).toBe(30);
    // scopeAdded/scopeRemoved counts come from the FULL set
    expect((result as any).scopeAdded).toBe(0);
    expect((result as any).scopeRemoved).toBe(30);
    // No scope-creep risk despite capped slice
    const risks = (result as any).risks as Array<{ id: string }>;
    expect(risks.find((r) => r.id === "scope-creep")).toBeUndefined();
  });
});

describe("closeCycle() — Batch B9 (minimal ack default)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("B9.1 — default returns minimal ack { id, state, velocity, closedAt }", async () => {
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
    vi.mocked(prisma.cycle.update).mockResolvedValue({
      id: "cycle-1",
      state: "done",
      velocity: 5,
      updatedAt,
    } as any);

    const result = await closeCycle("cycle-1");

    expect(result).toEqual({
      id: "cycle-1",
      state: "done",
      velocity: 5,
      // closedAt is sourced from the row's updatedAt (no closedAt column on schema)
      closedAt: updatedAt,
    });
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
