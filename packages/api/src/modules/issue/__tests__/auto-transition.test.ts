import { describe, it, expect, vi, beforeEach } from "vitest";
import { checkAndAdvanceParent } from "../auto-transition.js";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("../../activity/service.js", () => ({
  createActivityLog: vi.fn().mockResolvedValue({}),
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
