import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * KAN-53 — Issue key race condition fix
 *
 * RED phase (against MAX+1): all 10 concurrent creates read the same max → same
 * sequenceNum → duplicate keys. project.update is never called.
 *
 * GREEN phase (atomic increment): project.update({ lastSequenceNum: { increment: 1 } })
 * is called 10 times; each call returns a distinct counter value → 10 unique keys.
 */

// --- Mocks ---

vi.mock("../../../config/prisma.js", () => ({
  prisma: {
    project: {
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    issue: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      aggregate: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

vi.mock("../../mentions/service.js", () => ({
  parseAndUpsertMentions: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../activity/service.js", () => ({
  createActivityLog: vi.fn().mockResolvedValue({}),
}));

vi.mock("../../cycle/service.js", () => ({
  validateCycleBelongsToProject: vi.fn(),
  recordCycleScopeEvent: vi.fn().mockResolvedValue(undefined),
  dayIndex: vi.fn().mockReturnValue(1),
}));

vi.mock("../../work-session/service.js", () => ({
  getActiveWorkers: vi.fn().mockResolvedValue([]),
  getActiveWorkersForIssues: vi.fn().mockResolvedValue(new Map()),
}));

vi.mock("../../../services/event-bus/index.js", () => ({
  eventBus: { emit: vi.fn() },
}));

vi.mock("../../../shared/issue-templates.js", () => ({
  resolveTemplate: vi.fn().mockReturnValue(null),
}));

vi.mock("../../../config/engram.js", () => ({
  getEngramClient: vi.fn().mockReturnValue(null),
}));

vi.mock("../auto-transition.js", () => ({
  checkAndAdvanceParent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../roadmap/roadmap-sync.js", () => ({
  syncRoadmapItemStatus: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../shared/constants.js", () => ({
  ORDERED_STATES: ["backlog", "todo", "in_progress", "done"],
}));

vi.mock("../../issue-subscription/service.js", () => ({
  autoSubscribe: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockResolvedValue(null),
}));

import { prisma } from "../../../config/prisma.js";
import { createIssue } from "../service.js";

const mockProjectFindUnique = vi.mocked(prisma.project.findUnique);
const mockProjectUpdate = vi.mocked(prisma.project.update);
const mockIssueAggregate = vi.mocked(prisma.issue.aggregate);
const mockIssueCreate = vi.mocked(prisma.issue.create);
const mockTransaction = vi.mocked(prisma.$transaction);

function makeProject(id = "proj-race") {
  return {
    id,
    key: "RACE",
    name: "Race Project",
    workspaceId: "ws-race",
    archived: false,
    lastSequenceNum: 0,
  };
}

// ---------------------------------------------------------------------------
// KAN-53 T1 — Atomic counter: N=10 concurrent creates yield distinct keys
//
// Models the race: with MAX+1, aggregate always returns {_max:{sequenceNum:0}}
// (all reads see the same snapshot) → all calls compute nextNum=1 → duplicates.
//
// With atomic increment, project.update increments and returns a unique counter.
// ---------------------------------------------------------------------------

describe("KAN-53 T1 — atomic counter: 10 concurrent creates yield 10 distinct sequenceNums", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mockProjectFindUnique.mockResolvedValue(makeProject() as any);

    // Simulate MAX+1 race: all concurrent reads see the same max (0)
    // With old code this makes all calls produce sequenceNum=1 (duplicate).
    mockIssueAggregate.mockResolvedValue({ _max: { sequenceNum: 0 } } as any);

    // Old $transaction mock: just calls the callback with a fake tx
    mockTransaction.mockImplementation(async (fn: any) => {
      const fakeTx = {
        issue: {
          aggregate: vi.fn().mockResolvedValue({ _max: { sequenceNum: 0 } }),
        },
      };
      return fn(fakeTx);
    });

    // Atomic counter: each call to project.update gets a unique incrementing value
    let counter = 0;
    mockProjectUpdate.mockImplementation(async () => {
      counter += 1;
      return { lastSequenceNum: counter } as any;
    });

    // issue.create returns a minimal stub keyed by sequenceNum from the call
    mockIssueCreate.mockImplementation(async (args: any) => ({
      id: `iss-${args.data.sequenceNum}`,
      key: args.data.key,
      sequenceNum: args.data.sequenceNum,
      title: args.data.title,
      description: null,
      type: "task",
      priority: "medium",
      state: "backlog",
      labels: [],
      projectId: "proj-race",
      assigneeId: null,
      cycleId: null,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      project: { workspaceId: "ws-race", key: "RACE" },
    }));
  });

  it("produces 10 distinct sequenceNums and keys — zero rejections", async () => {
    const calls = Array.from({ length: 10 }, (_, i) =>
      createIssue("proj-race", { title: `Issue ${i + 1}` }, "m-alice"),
    );

    const results = await Promise.all(calls);

    const seqNums = results.map((r) => r.sequenceNum).sort((a, b) => a - b);
    const keys = results.map((r) => r.key);

    // All 10 must have distinct sequenceNums
    const distinctSeqNums = new Set(seqNums);
    expect(distinctSeqNums.size).toBe(10);

    // Must be contiguous 1..10
    expect(seqNums).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);

    // All keys distinct
    const distinctKeys = new Set(keys);
    expect(distinctKeys.size).toBe(10);
  });

  it("uses project.update with { lastSequenceNum: { increment: 1 } } — NOT issue.aggregate", async () => {
    await createIssue("proj-race", { title: "Single issue" }, "m-alice");

    // Structural: atomic increment must be called
    expect(mockProjectUpdate).toHaveBeenCalledOnce();
    expect(mockProjectUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "proj-race" },
        data: { lastSequenceNum: { increment: 1 } },
        select: { lastSequenceNum: true },
      }),
    );

    // Structural: aggregate MAX query must NOT be called (old pattern gone)
    expect(mockIssueAggregate).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KAN-53 T2 — Counter continuity: existing project (counter at K) → K+1
// ---------------------------------------------------------------------------

describe("KAN-53 T2 — counter continuity: existing project with counter at K yields K+1", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    // Project already has lastSequenceNum = 5 (from prior issues)
    mockProjectFindUnique.mockResolvedValue({
      ...makeProject(),
      lastSequenceNum: 5,
    } as any);

    // Atomic increment returns 6
    mockProjectUpdate.mockResolvedValue({ lastSequenceNum: 6 } as any);

    mockIssueCreate.mockImplementation(async (args: any) => ({
      id: `iss-${args.data.sequenceNum}`,
      key: args.data.key,
      sequenceNum: args.data.sequenceNum,
      title: args.data.title,
      description: null,
      type: "task",
      priority: "medium",
      state: "backlog",
      labels: [],
      projectId: "proj-race",
      assigneeId: null,
      cycleId: null,
      parentId: null,
      createdAt: new Date(),
      updatedAt: new Date(),
      project: { workspaceId: "ws-race", key: "RACE" },
    }));
  });

  it("assigns sequenceNum = 6 and key = RACE-6 when counter was at 5", async () => {
    const result = await createIssue(
      "proj-race",
      { title: "After K" },
      "m-alice",
    );

    expect(result.sequenceNum).toBe(6);
    expect(result.key).toBe("RACE-6");
  });
});

// ---------------------------------------------------------------------------
// KAN-53 T3 — Gap tolerance: failed create (cross-project cycle guard) does NOT
// burn a counter; next successful create is strictly increasing.
// ---------------------------------------------------------------------------

describe("KAN-53 T3 — gap tolerance: failed create before counter increment does not burn a number", () => {
  it("invalid cycleId throws before project.update — counter not incremented", async () => {
    vi.clearAllMocks();

    mockProjectFindUnique.mockResolvedValue(makeProject() as any);

    // validateCycleBelongsToProject will throw — import the mock
    const { validateCycleBelongsToProject } = await import(
      "../../cycle/service.js"
    );
    vi.mocked(validateCycleBelongsToProject).mockRejectedValueOnce(
      new Error("Cycle does not belong to this project"),
    );

    await expect(
      createIssue(
        "proj-race",
        { title: "Bad issue", cycleId: "wrong-cycle-id" },
        "m-alice",
      ),
    ).rejects.toThrow();

    // Counter must NOT have been touched — the guard fires before nextIssueKey
    expect(mockProjectUpdate).not.toHaveBeenCalled();
  });
});
