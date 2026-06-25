import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAndAdvanceParent } from "../auto-transition.js";
import { validateTransition } from "../state-machine.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../activity/service.js", () => ({
  createActivityLog: vi.fn().mockResolvedValue({}),
}));

// KAN-157 added a reconciliation gate to the auto-done path. It uses the
// module-level real prisma (not the injected client), so without this mock the
// "done" case (AT-1) hits the DB with a fake non-UUID id. The gate has its own
// coverage in reconcile.test.ts — here we isolate checkAndAdvanceParent's logic.
vi.mock("../reconcile.js", () => ({
  checkReconciliation: vi.fn().mockResolvedValue({ needed: false }),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makePrisma(overrides: Record<string, unknown> = {}) {
  return {
    issue: {
      findUnique: vi.fn(),
      update: vi.fn().mockResolvedValue({}),
      ...overrides,
    },
  } as unknown as import("@prisma/client").PrismaClient;
}

// ---------------------------------------------------------------------------
// KAN-99 PR1 — analysis state machine transitions (RED phase)
// validateTransition is position-based; analysis is at index 1 (after backlog).
// ---------------------------------------------------------------------------

describe("analysis state — validateTransition (KAN-99 PR1)", () => {
  it("SM-1: backlog→analysis is a forward transition (not a regression)", () => {
    const result = validateTransition("backlog", "analysis");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.isRegression).toBe(false);
    }
  });

  it("SM-2: analysis→todo is a forward transition (not a regression)", () => {
    const result = validateTransition("analysis", "todo");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.isRegression).toBe(false);
    }
  });

  it("SM-3: analysis→backlog is a backward transition (regression)", () => {
    const result = validateTransition("analysis", "backlog");
    expect(result.allowed).toBe(true);
    if (result.allowed) {
      expect(result.isRegression).toBe(true);
    }
  });

  it("SM-4: analysis→analysis is not allowed (same state)", () => {
    const result = validateTransition("analysis", "analysis");
    expect(result.allowed).toBe(false);
  });

  it("SM-5: backlog→analysis→todo chain is valid (two forward steps)", () => {
    const step1 = validateTransition("backlog", "analysis");
    const step2 = validateTransition("analysis", "todo");
    expect(step1.allowed).toBe(true);
    expect(step2.allowed).toBe(true);
    if (step1.allowed) expect(step1.isRegression).toBe(false);
    if (step2.allowed) expect(step2.isRegression).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CRITICAL 1 — analysis column index (RED: must fail before auto-transition.ts is fixed)
// A parent whose children are ALL in "analysis" must compute column index 1
// (not fall back to 0/backlog) and auto-advance to analysis correctly.
// ---------------------------------------------------------------------------

describe("checkAndAdvanceParent — analysis column (CRITICAL-1)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AT-A1: parent in backlog auto-advances to analysis when all children are in analysis (index 1, not 0)", async () => {
    const prisma = makePrisma();

    // Parent is in 'backlog' (should be column 0); all children in 'analysis' (should be column 1)
    (prisma.issue.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "parent-a1",
      state: "backlog",
      children: [
        { id: "child-a1", state: "analysis" },
        { id: "child-a2", state: "analysis" },
      ],
    });

    await checkAndAdvanceParent(
      prisma,
      { parentId: "parent-a1" },
      "member-1",
    );

    // Must have advanced — parent moves from backlog → analysis
    expect(prisma.issue.update).toHaveBeenCalledOnce();
    const updateCall = (prisma.issue.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(updateCall.data.state).toBe("analysis");
    // completedAt must be null (not done)
    expect(updateCall.data.completedAt).toBeNull();
  });

  it("AT-A2: mixed children (analysis + backlog) — parent does NOT advance (min col is backlog=0)", async () => {
    const prisma = makePrisma();

    // Parent in backlog; children split between analysis (col 1) and backlog (col 0)
    // min column = 0 (backlog) so no advance
    (prisma.issue.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "parent-a2",
      state: "backlog",
      children: [
        { id: "child-a3", state: "analysis" },
        { id: "child-a4", state: "backlog" },
      ],
    });

    await checkAndAdvanceParent(
      prisma,
      { parentId: "parent-a2" },
      "member-1",
    );

    expect(prisma.issue.update).not.toHaveBeenCalled();
  });

  it("AT-A3: parent in analysis does NOT advance when children are all in analysis (same column, no forward progress)", async () => {
    const prisma = makePrisma();

    // Parent already in analysis; children also in analysis — no forward progress
    (prisma.issue.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "parent-a3",
      state: "analysis",
      children: [{ id: "child-a5", state: "analysis" }],
    });

    await checkAndAdvanceParent(
      prisma,
      { parentId: "parent-a3" },
      "member-1",
    );

    expect(prisma.issue.update).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// KAN-35 — checkAndAdvanceParent must stamp completedAt on parent → done
// ---------------------------------------------------------------------------

describe("checkAndAdvanceParent — KAN-35 completedAt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("AT-1: stamps completedAt (non-null) when parent auto-advances to done", async () => {
    const prisma = makePrisma();

    // Parent is in 'review' (column 3); single child moves to 'done' (column 4)
    (prisma.issue.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "parent-1",
      state: "review",
      children: [{ id: "child-1", state: "done" }],
    });

    await checkAndAdvanceParent(
      prisma,
      { parentId: "parent-1" },
      "member-1",
    );

    expect(prisma.issue.update).toHaveBeenCalledOnce();

    const updateCall = (prisma.issue.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];

    expect(updateCall.data.state).toBe("done");
    // KAN-35 contract: completedAt MUST be set when transitioning to done
    expect(updateCall.data.completedAt).toBeInstanceOf(Date);
  });

  it("AT-2: does NOT set completedAt (sets null) when parent auto-advances to non-done state", async () => {
    const prisma = makePrisma();

    // Parent is in 'backlog' (column 0); single child moves to 'in_progress' (column 2)
    (prisma.issue.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "parent-2",
      state: "backlog",
      children: [{ id: "child-2", state: "in_progress" }],
    });

    await checkAndAdvanceParent(
      prisma,
      { parentId: "parent-2" },
      "member-1",
    );

    expect(prisma.issue.update).toHaveBeenCalledOnce();

    const updateCall = (prisma.issue.update as ReturnType<typeof vi.fn>).mock
      .calls[0][0];

    expect(updateCall.data.state).toBe("in_progress");
    // KAN-35 contract: completedAt MUST be cleared (null) for non-done transitions
    expect(updateCall.data.completedAt).toBeNull();
  });

  it("AT-3: does not call update when no advancement is needed", async () => {
    const prisma = makePrisma();

    // Parent already at 'done'; child also done — no forward progress
    (prisma.issue.findUnique as ReturnType<typeof vi.fn>).mockResolvedValue({
      id: "parent-3",
      state: "done",
      children: [{ id: "child-3", state: "done" }],
    });

    await checkAndAdvanceParent(
      prisma,
      { parentId: "parent-3" },
      "member-1",
    );

    expect(prisma.issue.update).not.toHaveBeenCalled();
  });
});
