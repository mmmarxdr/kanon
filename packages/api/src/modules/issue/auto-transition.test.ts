import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  checkAndAdvanceParent,
  STATE_TO_COLUMN_INDEX,
  COLUMN_DEFAULT_STATES,
} from "./auto-transition.js";

// ---------------------------------------------------------------------------
// Mock activity service
// ---------------------------------------------------------------------------
vi.mock("../activity/service.js", () => ({
  createActivityLog: vi.fn().mockResolvedValue({}),
}));

import { createActivityLog } from "../activity/service.js";

// ---------------------------------------------------------------------------
// Prisma mock helpers
// ---------------------------------------------------------------------------

function makePrisma(parentData: any) {
  return {
    issue: {
      findUnique: vi.fn().mockResolvedValue(parentData),
      update: vi.fn().mockResolvedValue({ ...parentData, state: "updated" }),
    },
  } as any;
}

const MEMBER_ID = "member-1";

function makeParent(state: string, children: { id: string; state: string }[]) {
  return {
    id: "parent-1",
    key: "P-1",
    state,
    children,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("checkAndAdvanceParent", () => {
  // ── No-op cases ──────────────────────────────────────────────────────

  it("does nothing when issue has no parent", async () => {
    const prisma = makePrisma(null);
    await checkAndAdvanceParent(prisma, { parentId: null }, MEMBER_ID);
    expect(prisma.issue.findUnique).not.toHaveBeenCalled();
  });

  it("does nothing when parent is not found", async () => {
    const prisma = makePrisma(null);
    await checkAndAdvanceParent(prisma, { parentId: "parent-1" }, MEMBER_ID);
    expect(prisma.issue.update).not.toHaveBeenCalled();
  });

  it("does nothing when not all children have advanced past parent column", async () => {
    // Parent in analysis (column 1), one child in analysis, one in in_progress
    const parent = makeParent("propose", [
      { id: "c1", state: "spec" },       // column 1 (analysis)
      { id: "c2", state: "tasks" },      // column 2 (in_progress)
    ]);
    const prisma = makePrisma(parent);

    await checkAndAdvanceParent(prisma, { parentId: "parent-1" }, MEMBER_ID);
    expect(prisma.issue.update).not.toHaveBeenCalled();
  });

  // ── Advance cases ────────────────────────────────────────────────────

  it("advances parent when all children are in the next column", async () => {
    // Parent in analysis (column 1), both children in in_progress (column 2)
    const parent = makeParent("propose", [
      { id: "c1", state: "tasks" },  // column 2
      { id: "c2", state: "apply" },  // column 2
    ]);
    const prisma = makePrisma(parent);

    await checkAndAdvanceParent(prisma, { parentId: "parent-1" }, MEMBER_ID);

    expect(prisma.issue.update).toHaveBeenCalledWith({
      where: { id: "parent-1" },
      data: { state: "tasks" },  // default state for column 2
    });
  });

  it("advances parent multiple columns if children skip ahead", async () => {
    // Parent in backlog (column 0), all children in testing (column 3)
    const parent = makeParent("backlog", [
      { id: "c1", state: "verify" },  // column 3
      { id: "c2", state: "verify" },  // column 3
    ]);
    const prisma = makePrisma(parent);

    await checkAndAdvanceParent(prisma, { parentId: "parent-1" }, MEMBER_ID);

    expect(prisma.issue.update).toHaveBeenCalledWith({
      where: { id: "parent-1" },
      data: { state: "verify" },  // default state for column 3
    });
  });

  it("never moves parent backward", async () => {
    // Parent in in_progress (column 2), children in analysis (column 1)
    const parent = makeParent("tasks", [
      { id: "c1", state: "propose" },  // column 1
      { id: "c2", state: "spec" },     // column 1
    ]);
    const prisma = makePrisma(parent);

    await checkAndAdvanceParent(prisma, { parentId: "parent-1" }, MEMBER_ID);
    expect(prisma.issue.update).not.toHaveBeenCalled();
  });

  it("does not advance when parent is already in the same column as children", async () => {
    // Parent in in_progress (column 2), children also in in_progress
    const parent = makeParent("tasks", [
      { id: "c1", state: "tasks" },   // column 2
      { id: "c2", state: "apply" },   // column 2
    ]);
    const prisma = makePrisma(parent);

    await checkAndAdvanceParent(prisma, { parentId: "parent-1" }, MEMBER_ID);
    expect(prisma.issue.update).not.toHaveBeenCalled();
  });

  // ── Activity log ─────────────────────────────────────────────────────

  it("creates activity log for auto-transition", async () => {
    const parent = makeParent("propose", [
      { id: "c1", state: "tasks" },
      { id: "c2", state: "apply" },
    ]);
    const prisma = makePrisma(parent);

    await checkAndAdvanceParent(prisma, { parentId: "parent-1" }, MEMBER_ID);

    expect(createActivityLog).toHaveBeenCalledWith({
      issueId: "parent-1",
      memberId: MEMBER_ID,
      action: "state_changed",
      details: {
        from: "propose",
        to: "tasks",
        automatic: true,
        reason: "All children advanced past current column",
      },
    });
  });

  // ── Single child ─────────────────────────────────────────────────────

  it("works with a single child", async () => {
    // Parent in backlog (column 0), single child in analysis (column 1)
    const parent = makeParent("backlog", [
      { id: "c1", state: "propose" },  // column 1
    ]);
    const prisma = makePrisma(parent);

    await checkAndAdvanceParent(prisma, { parentId: "parent-1" }, MEMBER_ID);

    expect(prisma.issue.update).toHaveBeenCalledWith({
      where: { id: "parent-1" },
      data: { state: "propose" },  // default state for column 1
    });
  });

  // ── Edge: child in finished (archived) ───────────────────────────────

  it("advances parent to finished when all children are archived", async () => {
    const parent = makeParent("verify", [
      { id: "c1", state: "archived" },  // column 4
      { id: "c2", state: "archived" },  // column 4
    ]);
    const prisma = makePrisma(parent);

    await checkAndAdvanceParent(prisma, { parentId: "parent-1" }, MEMBER_ID);

    expect(prisma.issue.update).toHaveBeenCalledWith({
      where: { id: "parent-1" },
      data: { state: "archived" },
    });
  });
});

// ---------------------------------------------------------------------------
// Mapping sanity checks
// ---------------------------------------------------------------------------

describe("STATE_TO_COLUMN_INDEX", () => {
  it("maps all states to valid column indices", () => {
    const states = [
      "backlog", "explore", "propose", "design", "spec",
      "tasks", "apply", "verify", "archived",
    ];
    for (const s of states) {
      expect(STATE_TO_COLUMN_INDEX[s]).toBeGreaterThanOrEqual(0);
      expect(STATE_TO_COLUMN_INDEX[s]).toBeLessThanOrEqual(4);
    }
  });

  it("groups states into correct columns", () => {
    expect(STATE_TO_COLUMN_INDEX["backlog"]).toBe(0);
    expect(STATE_TO_COLUMN_INDEX["explore"]).toBe(0);
    expect(STATE_TO_COLUMN_INDEX["propose"]).toBe(1);
    expect(STATE_TO_COLUMN_INDEX["design"]).toBe(1);
    expect(STATE_TO_COLUMN_INDEX["spec"]).toBe(1);
    expect(STATE_TO_COLUMN_INDEX["tasks"]).toBe(2);
    expect(STATE_TO_COLUMN_INDEX["apply"]).toBe(2);
    expect(STATE_TO_COLUMN_INDEX["verify"]).toBe(3);
    expect(STATE_TO_COLUMN_INDEX["archived"]).toBe(4);
  });
});

describe("COLUMN_DEFAULT_STATES", () => {
  it("has one default state per column", () => {
    expect(COLUMN_DEFAULT_STATES).toHaveLength(5);
  });

  it("default states match expected values", () => {
    expect(COLUMN_DEFAULT_STATES[0]).toBe("backlog");
    expect(COLUMN_DEFAULT_STATES[1]).toBe("propose");
    expect(COLUMN_DEFAULT_STATES[2]).toBe("tasks");
    expect(COLUMN_DEFAULT_STATES[3]).toBe("verify");
    expect(COLUMN_DEFAULT_STATES[4]).toBe("archived");
  });
});
