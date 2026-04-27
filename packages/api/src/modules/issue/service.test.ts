import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for issue service — focused on getIssue() cycle include.
 * Uses mocked Prisma and mocked work-session service.
 */

// Mock work-session service (imported indirectly by issue service)
vi.mock("../work-session/service.js", () => ({
  getActiveWorkers: vi.fn().mockResolvedValue([]),
  getActiveWorkersForIssues: vi.fn().mockResolvedValue({}),
}));

// Mock engram client (imported at module level)
vi.mock("../../config/engram.js", () => ({
  getEngramClient: vi.fn().mockReturnValue(null),
}));

// Mock event bus
vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

// Mock prisma
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    issue: {
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      count: vi.fn(),
      aggregate: vi.fn(),
      groupBy: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
    issueDependency: {
      findMany: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
    member: {
      findUnique: vi.fn(),
    },
    activityLog: {
      create: vi.fn(),
    },
    cycle: {
      findUnique: vi.fn(),
    },
    cycleScopeEvent: {
      create: vi.fn(),
      createMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../config/prisma.js";
import {
  getIssue,
  createIssue,
  updateIssue,
  listIssues,
  batchTransitionByKeys,
} from "./service.js";

const mockIssueFindUnique = vi.mocked(prisma.issue.findUnique);

// Base minimal Prisma issue shape that getIssue spreads
function makeIssueRow(overrides?: Record<string, unknown>) {
  return {
    id: "issue-1",
    key: "TEST-1",
    sequenceNum: 1,
    title: "Test issue",
    description: null,
    type: "task",
    priority: "medium",
    state: "backlog",
    labels: [],
    dueDate: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    groupKey: null,
    engramContext: null,
    specArtifacts: null,
    estimate: null,
    cycleId: null,
    projectId: "project-1",
    assigneeId: null,
    parentId: null,
    assignee: null,
    project: { id: "project-1", key: "TEST", name: "Test Project" },
    children: [],
    blocks: [],
    blockedBy: [],
    cycle: null,
    ...overrides,
  };
}

describe("getIssue()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("queries Prisma with cycle: { select: { id, name } } in the include block", async () => {
    const cyclePayload = { id: "cycle-uuid-1", name: "Sprint Q2" };
    mockIssueFindUnique.mockResolvedValue(
      makeIssueRow({ cycleId: "cycle-uuid-1", cycle: cyclePayload }) as any,
    );

    await getIssue("TEST-1");

    expect(mockIssueFindUnique).toHaveBeenCalledOnce();
    const callArg = mockIssueFindUnique.mock.calls[0]![0] as any;
    // The include block MUST contain a cycle key so the relation is fetched
    expect(callArg.include).toHaveProperty("cycle");
    expect(callArg.include.cycle).toEqual({ select: { id: true, name: true } });
  });

  it("returns cycle: { id, name } when the issue has a cycleId", async () => {
    const cyclePayload = { id: "cycle-uuid-1", name: "Sprint Q2" };
    mockIssueFindUnique.mockResolvedValue(
      makeIssueRow({ cycleId: "cycle-uuid-1", cycle: cyclePayload }) as any,
    );

    const result = await getIssue("TEST-1");

    expect(result.cycle).toEqual(cyclePayload);
    expect(result.cycleId).toBe("cycle-uuid-1");
  });

  it("returns cycle: null when issue has no cycleId", async () => {
    mockIssueFindUnique.mockResolvedValue(
      makeIssueRow({ cycleId: null, cycle: null }) as any,
    );

    const result = await getIssue("TEST-1");

    expect(result.cycle).toBeNull();
    expect(result.cycleId).toBeNull();
  });

  it("throws 404 when issue does not exist", async () => {
    mockIssueFindUnique.mockResolvedValue(null);

    await expect(getIssue("MISSING-999")).rejects.toMatchObject({
      statusCode: 404,
      code: "ISSUE_NOT_FOUND",
    });
  });
});

// ── Cycle scope events: createIssue + updateIssue ───────────────────────────

const PROJECT = { id: "project-1", key: "TEST", workspaceId: "ws-1" };
const CYCLE_A = {
  id: "cycle-A",
  projectId: PROJECT.id,
  startDate: new Date("2026-04-20"),
  endDate: new Date("2026-05-04"),
};
const CYCLE_B = {
  id: "cycle-B",
  projectId: PROJECT.id,
  startDate: new Date("2026-04-20"),
  endDate: new Date("2026-05-04"),
};
const CYCLE_OTHER = {
  id: "cycle-OTHER",
  projectId: "project-OTHER",
  startDate: new Date("2026-04-20"),
  endDate: new Date("2026-05-04"),
};

function setupNextIssueKey(nextNum = 1) {
  vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
    if (typeof cb === "function") {
      return cb({
        issue: {
          aggregate: vi
            .fn()
            .mockResolvedValue({ _max: { sequenceNum: nextNum - 1 } }),
        },
      });
    }
    return undefined;
  });
}

describe("createIssue() — cycleId integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setupNextIssueKey(1);
    vi.mocked(prisma.activityLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.project.findFirst).mockResolvedValue(PROJECT as any);
  });

  it("TEST 1: createIssue with cycleId records a CycleScopeEvent (kind=add)", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(CYCLE_A as any);
    vi.mocked(prisma.issue.create).mockResolvedValue({
      id: "issue-new",
      key: "TEST-1",
      cycleId: CYCLE_A.id,
      projectId: PROJECT.id,
    } as any);

    await createIssue(
      "TEST",
      { title: "x", labels: [], cycleId: CYCLE_A.id } as any,
      "member-1",
    );

    expect(prisma.cycleScopeEvent.create).toHaveBeenCalledOnce();
    const callArg = vi.mocked(prisma.cycleScopeEvent.create).mock.calls[0]![0] as any;
    expect(callArg.data).toMatchObject({
      cycleId: CYCLE_A.id,
      kind: "add",
      issueKey: "TEST-1",
      authorId: "member-1",
    });
    expect(typeof callArg.data.day).toBe("number");
    expect(callArg.data.day).toBeGreaterThanOrEqual(1);
  });

  it("TEST 2: createIssue with cross-project cycleId throws CROSS_PROJECT_CYCLE and creates nothing", async () => {
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(CYCLE_OTHER as any);

    await expect(
      createIssue(
        "TEST",
        { title: "x", labels: [], cycleId: CYCLE_OTHER.id } as any,
        "member-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CROSS_PROJECT_CYCLE",
    });

    expect(prisma.issue.create).not.toHaveBeenCalled();
    expect(prisma.cycleScopeEvent.create).not.toHaveBeenCalled();
    // sequenceNum should not be burned — $transaction (nextIssueKey) should not run either
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("TEST 3: createIssue without cycleId does NOT create a scope event", async () => {
    vi.mocked(prisma.issue.create).mockResolvedValue({
      id: "issue-new",
      key: "TEST-1",
      cycleId: null,
      projectId: PROJECT.id,
    } as any);

    await createIssue("TEST", { title: "x", labels: [] } as any, "member-1");

    expect(prisma.cycleScopeEvent.create).not.toHaveBeenCalled();
    expect(prisma.cycle.findUnique).not.toHaveBeenCalled();
  });
});

describe("updateIssue() — cycleId scope events", () => {
  function makeUpdateIssueRow(overrides?: Record<string, unknown>) {
    return {
      id: "issue-1",
      key: "TEST-1",
      cycleId: null,
      projectId: PROJECT.id,
      assigneeId: null,
      project: { workspaceId: PROJECT.workspaceId, key: PROJECT.key },
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.activityLog.create).mockResolvedValue({} as any);
    vi.mocked(prisma.issue.update).mockResolvedValue({
      id: "issue-1",
      key: "TEST-1",
    } as any);
  });

  it("TEST 4: null → cycleId='B' records 1 add event for B", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeUpdateIssueRow({ cycleId: null }) as any,
    );
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(CYCLE_B as any);

    await updateIssue("TEST-1", { cycleId: CYCLE_B.id } as any, "member-1");

    expect(prisma.cycleScopeEvent.create).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.cycleScopeEvent.create).mock.calls[0]![0] as any;
    expect(arg.data).toMatchObject({
      cycleId: CYCLE_B.id,
      kind: "add",
      issueKey: "TEST-1",
      authorId: "member-1",
    });
  });

  it("TEST 5: 'A' → 'B' records remove(A) and add(B)", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeUpdateIssueRow({ cycleId: CYCLE_A.id }) as any,
    );
    vi.mocked(prisma.cycle.findUnique).mockImplementation((args: any) => {
      if (args?.where?.id === CYCLE_A.id) return Promise.resolve(CYCLE_A as any);
      if (args?.where?.id === CYCLE_B.id) return Promise.resolve(CYCLE_B as any);
      return Promise.resolve(null as any);
    });

    await updateIssue("TEST-1", { cycleId: CYCLE_B.id } as any, "member-1");

    expect(prisma.cycleScopeEvent.create).toHaveBeenCalledTimes(2);
    const calls = vi
      .mocked(prisma.cycleScopeEvent.create)
      .mock.calls.map((c) => (c[0] as any).data);
    const removeCall = calls.find((c) => c.kind === "remove");
    const addCall = calls.find((c) => c.kind === "add");
    expect(removeCall).toMatchObject({
      cycleId: CYCLE_A.id,
      issueKey: "TEST-1",
      authorId: "member-1",
    });
    expect(addCall).toMatchObject({
      cycleId: CYCLE_B.id,
      issueKey: "TEST-1",
      authorId: "member-1",
    });
  });

  it("TEST 6: 'A' → null records 1 remove event for A", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeUpdateIssueRow({ cycleId: CYCLE_A.id }) as any,
    );
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(CYCLE_A as any);

    await updateIssue("TEST-1", { cycleId: null } as any, "member-1");

    expect(prisma.cycleScopeEvent.create).toHaveBeenCalledTimes(1);
    const arg = vi.mocked(prisma.cycleScopeEvent.create).mock.calls[0]![0] as any;
    expect(arg.data).toMatchObject({
      cycleId: CYCLE_A.id,
      kind: "remove",
      issueKey: "TEST-1",
      authorId: "member-1",
    });
  });

  it("TEST 7: cycleId not in payload → no scope event", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeUpdateIssueRow({ cycleId: CYCLE_A.id }) as any,
    );

    await updateIssue("TEST-1", { title: "renamed" } as any, "member-1");

    expect(prisma.cycleScopeEvent.create).not.toHaveBeenCalled();
  });

  it("TEST 8: cross-project new cycleId throws CROSS_PROJECT_CYCLE before update", async () => {
    vi.mocked(prisma.issue.findUnique).mockResolvedValue(
      makeUpdateIssueRow({ cycleId: null }) as any,
    );
    vi.mocked(prisma.cycle.findUnique).mockResolvedValue(CYCLE_OTHER as any);

    await expect(
      updateIssue("TEST-1", { cycleId: CYCLE_OTHER.id } as any, "member-1"),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CROSS_PROJECT_CYCLE",
    });

    expect(prisma.issue.update).not.toHaveBeenCalled();
    expect(prisma.cycleScopeEvent.create).not.toHaveBeenCalled();
  });
});

// ── B1: listIssues keys CSV filter ─────────────────────────────────────────

describe("listIssues() — keys filter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.findFirst).mockResolvedValue(PROJECT as any);
    vi.mocked(prisma.issue.findMany).mockResolvedValue([] as any);
  });

  it("B1.1 — keys filter passes where.key = { in: [...] } to Prisma", async () => {
    await listIssues("TEST", { keys: "TEST-1,TEST-2,TEST-99" } as any);

    expect(prisma.issue.findMany).toHaveBeenCalledOnce();
    const arg = vi.mocked(prisma.issue.findMany).mock.calls[0]![0] as any;
    expect(arg.where).toMatchObject({ projectId: PROJECT.id });
    expect(arg.where.key).toEqual({ in: ["TEST-1", "TEST-2", "TEST-99"] });
  });

  it("B1.2 — more than 100 keys throws KEY_LIMIT_EXCEEDED 400", async () => {
    const manyKeys = Array.from({ length: 101 }, (_, i) => `TEST-${i + 1}`).join(",");

    await expect(listIssues("TEST", { keys: manyKeys } as any)).rejects.toMatchObject({
      statusCode: 400,
      code: "KEY_LIMIT_EXCEEDED",
    });

    expect(prisma.issue.findMany).not.toHaveBeenCalled();
  });

  it("B1.3 — empty keys CSV is treated as no-op (no key filter)", async () => {
    await listIssues("TEST", { keys: "" } as any);

    expect(prisma.issue.findMany).toHaveBeenCalledOnce();
    const arg = vi.mocked(prisma.issue.findMany).mock.calls[0]![0] as any;
    expect(arg.where.key).toBeUndefined();
  });

  it("B1.4 — keys + state combined apply AND semantics", async () => {
    await listIssues("TEST", { keys: "TEST-1,TEST-2", state: "todo" } as any);

    const arg = vi.mocked(prisma.issue.findMany).mock.calls[0]![0] as any;
    expect(arg.where.key).toEqual({ in: ["TEST-1", "TEST-2"] });
    expect(arg.where.state).toBe("todo");
    expect(arg.where.projectId).toBe(PROJECT.id);
  });

  it("B1.5 — whitespace and empty entries are stripped", async () => {
    await listIssues("TEST", { keys: " TEST-1 , ,TEST-2 ,," } as any);

    const arg = vi.mocked(prisma.issue.findMany).mock.calls[0]![0] as any;
    expect(arg.where.key).toEqual({ in: ["TEST-1", "TEST-2"] });
  });
});

// ── B7: batchTransitionByKeys ──────────────────────────────────────────────

describe("batchTransitionByKeys()", () => {
  function setupTxBatch() {
    vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => {
      if (typeof cb === "function") {
        return cb({
          issue: {
            updateMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
          activityLog: {
            createMany: vi.fn().mockResolvedValue({ count: 2 }),
          },
        });
      }
      return undefined;
    });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.project.findFirst).mockResolvedValue(PROJECT as any);
  });

  it("B7.1 — transitions all matched issues in one transaction", async () => {
    setupTxBatch();
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { id: "i1", key: "TEST-1", state: "todo", projectId: PROJECT.id, parentId: null, roadmapItemId: null },
      { id: "i2", key: "TEST-2", state: "todo", projectId: PROJECT.id, parentId: null, roadmapItemId: null },
    ] as any);

    const res = await batchTransitionByKeys(
      "TEST",
      { keys: ["TEST-1", "TEST-2"], to_state: "in_progress" } as any,
      "member-1",
    );

    expect(prisma.$transaction).toHaveBeenCalledOnce();
    expect(res).toMatchObject({ count: 2, state: "in_progress" });
    expect(res.keys.sort()).toEqual(["TEST-1", "TEST-2"]);
  });

  it("B7.2 — cross-project key throws CROSS_PROJECT_ISSUE 400 with no tx", async () => {
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { id: "i1", key: "TEST-1", state: "todo", projectId: PROJECT.id, parentId: null, roadmapItemId: null },
      { id: "i9", key: "OTHER-9", state: "todo", projectId: "project-OTHER", parentId: null, roadmapItemId: null },
    ] as any);

    await expect(
      batchTransitionByKeys(
        "TEST",
        { keys: ["TEST-1", "OTHER-9"], to_state: "in_progress" } as any,
        "member-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CROSS_PROJECT_ISSUE",
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("B7.3 — missing key throws CROSS_PROJECT_ISSUE 400 (atomic — no partial update)", async () => {
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { id: "i1", key: "TEST-1", state: "todo", projectId: PROJECT.id, parentId: null, roadmapItemId: null },
      // TEST-999 missing from result
    ] as any);

    await expect(
      batchTransitionByKeys(
        "TEST",
        { keys: ["TEST-1", "TEST-999"], to_state: "in_progress" } as any,
        "member-1",
      ),
    ).rejects.toMatchObject({
      statusCode: 400,
      code: "CROSS_PROJECT_ISSUE",
    });

    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it("B7.4 — same-state transition is a no-op (no tx, count=0)", async () => {
    // The current state-machine only rejects same-state transitions, which
    // we filter out before validation. With no other invalid transitions
    // possible (forward + backward both allowed), the no-op path is the
    // observable contract: we return count=0 without opening a tx.
    vi.mocked(prisma.issue.findMany).mockResolvedValue([
      { id: "i1", key: "TEST-1", state: "done", projectId: PROJECT.id, parentId: null, roadmapItemId: null },
    ] as any);

    const res = await batchTransitionByKeys(
      "TEST",
      { keys: ["TEST-1"], to_state: "done" } as any,
      "member-1",
    );

    expect(res).toMatchObject({ count: 0, state: "done" });
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });
});
