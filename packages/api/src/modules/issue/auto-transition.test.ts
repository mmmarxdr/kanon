import { describe, it, expect, vi, beforeEach } from "vitest";

// KAN-157 BUG-1 (dual-judge consensus): checkAndAdvanceParent must NOT auto-advance
// a parent INTO done when the parent has unconfirmed captured time — otherwise the
// reconciliation gate is bypassed by the most common board gesture (last child → done).

vi.mock("./reconcile.js", () => ({ checkReconciliation: vi.fn() }));
vi.mock("../activity/service.js", () => ({ createActivityLog: vi.fn().mockResolvedValue(undefined) }));

import { checkAndAdvanceParent } from "./auto-transition.js";
import { checkReconciliation } from "./reconcile.js";

function makePrisma() {
  return {
    issue: {
      // parent at 'review' (col 4); its only child is 'done' (col 5) → would auto-advance to 'done'
      findUnique: vi.fn().mockResolvedValue({
        id: "parent-1",
        state: "review",
        timeConfirmedAt: null,
        children: [{ id: "child-1", state: "done" }],
      }),
      update: vi.fn().mockResolvedValue({}),
    },
  };
}

describe("checkAndAdvanceParent — reconciliation gate on auto-done (KAN-157 BUG-1)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("does NOT auto-advance the parent to done when it has unconfirmed captured time", async () => {
    vi.mocked(checkReconciliation).mockResolvedValue({
      needed: true,
      workLogs: [],
      timeEntries: [],
      totalHours: 5,
    });
    const prisma = makePrisma();

    await checkAndAdvanceParent(prisma as any, { parentId: "parent-1" } as any, "member-1");

    expect(checkReconciliation).toHaveBeenCalledWith("parent-1", null);
    expect(prisma.issue.update).not.toHaveBeenCalled(); // gate held — no silent auto-done
  });

  it("auto-advances the parent to done when reconciliation is satisfied", async () => {
    vi.mocked(checkReconciliation).mockResolvedValue({
      needed: false,
      workLogs: [],
      timeEntries: [],
      totalHours: 0,
    });
    const prisma = makePrisma();

    await checkAndAdvanceParent(prisma as any, { parentId: "parent-1" } as any, "member-1");

    expect(prisma.issue.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ state: "done" }) }),
    );
  });
});
