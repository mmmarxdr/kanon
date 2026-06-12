/**
 * Unit tests for computeStatus (KAN-84 slice 3).
 *
 * These are fast NO-DB tests targeting the pure logic so StrykerJS mutation
 * testing can kill every reachable mutant in computeStatus:
 *   - the `length === 0` guard (returns null)
 *   - the `every` combinator
 *   - the `=== "done"` comparator
 *   - the ternary branches ("done" vs "in_progress")
 *
 * Each test asserts an exact return value so string-literal and boolean-logic
 * mutants are caught.
 */
import type { PrismaClient } from "@prisma/client";
import { describe, it, expect } from "vitest";
import { computeStatus, syncRoadmapItemStatus } from "./roadmap-sync.js";

describe("computeStatus", () => {
  it("returns null for an empty array", () => {
    expect(computeStatus([])).toBeNull();
  });

  it("returns 'done' for a single issue with state 'done'", () => {
    expect(computeStatus([{ state: "done" }])).toBe("done");
  });

  it("returns 'in_progress' for a single issue with state 'backlog'", () => {
    expect(computeStatus([{ state: "backlog" }])).toBe("in_progress");
  });

  it("returns 'in_progress' for a single issue with state 'todo'", () => {
    expect(computeStatus([{ state: "todo" }])).toBe("in_progress");
  });

  it("returns 'in_progress' for a single issue with state 'in_progress'", () => {
    expect(computeStatus([{ state: "in_progress" }])).toBe("in_progress");
  });

  it("returns 'in_progress' for a single issue with state 'review'", () => {
    expect(computeStatus([{ state: "review" }])).toBe("in_progress");
  });

  it("returns 'in_progress' for a mix of done and non-done issues", () => {
    expect(
      computeStatus([{ state: "done" }, { state: "backlog" }]),
    ).toBe("in_progress");
  });

  it("returns 'in_progress' when non-done comes first", () => {
    expect(
      computeStatus([{ state: "todo" }, { state: "done" }]),
    ).toBe("in_progress");
  });

  it("returns 'done' for multiple issues all with state 'done'", () => {
    expect(
      computeStatus([
        { state: "done" },
        { state: "done" },
        { state: "done" },
      ]),
    ).toBe("done");
  });

  it("returns 'in_progress' when only the last issue is not done", () => {
    expect(
      computeStatus([
        { state: "done" },
        { state: "done" },
        { state: "review" },
      ]),
    ).toBe("in_progress");
  });

  it("returns 'in_progress' for a large all-non-done set", () => {
    const issues = Array.from({ length: 5 }, () => ({ state: "todo" as const }));
    expect(computeStatus(issues)).toBe("in_progress");
  });

  it("returns 'done' for a large all-done set", () => {
    const issues = Array.from({ length: 5 }, () => ({ state: "done" as const }));
    expect(computeStatus(issues)).toBe("done");
  });

  // Explicit NOT-null assertions — kill any mutant that always returns null
  it("return value is not null when array is non-empty and all done", () => {
    const result = computeStatus([{ state: "done" }]);
    expect(result).not.toBeNull();
    expect(result).toBe("done");
  });

  it("return value is not null when array is non-empty and some not done", () => {
    const result = computeStatus([{ state: "backlog" }]);
    expect(result).not.toBeNull();
    expect(result).toBe("in_progress");
  });
});

/**
 * Unit tests for syncRoadmapItemStatus's defensive bail branches.
 *
 * syncRoadmapItemStatus takes the PrismaClient by dependency injection, so we
 * drive its early-return guards with a hand-rolled stub — deterministic, no DB,
 * no privileges, no FK-trigger hacks. `roadmapItem.update` throws if reached so
 * that any mutant which removes a guard is killed by an unexpected write.
 */
describe("syncRoadmapItemStatus — defensive guards (stubbed prisma)", () => {
  type Stub = {
    issueRoadmapItemId?: string | null;
    issueExists?: boolean;
    siblingStates?: { state: string }[];
    roadmapItem?: { status: string } | null;
  };

  function makePrisma(s: Stub) {
    return {
      issue: {
        findUnique: async () =>
          s.issueExists === false
            ? null
            : { roadmapItemId: s.issueRoadmapItemId ?? null },
        findMany: async () => s.siblingStates ?? [],
      },
      roadmapItem: {
        findUnique: async () => s.roadmapItem ?? null,
        update: async () => {
          throw new Error("roadmapItem.update must NOT be called");
        },
      },
    } as unknown as PrismaClient;
  }

  it("bails when the issue does not exist (findUnique → null)", async () => {
    const prisma = makePrisma({ issueExists: false });
    await expect(syncRoadmapItemStatus(prisma, "ghost")).resolves.toBeUndefined();
  });

  it("bails when the issue has no roadmapItemId", async () => {
    const prisma = makePrisma({ issueRoadmapItemId: null });
    await expect(syncRoadmapItemStatus(prisma, "issue-1")).resolves.toBeUndefined();
  });

  it("bails when no sibling issues exist (computeStatus → null)", async () => {
    // Exercises the `newStatus === null` guard: a roadmapItemId is present but
    // findMany returns no siblings, so computeStatus returns null and we return
    // before ever loading/updating the roadmapItem.
    const prisma = makePrisma({
      issueRoadmapItemId: "rm-1",
      siblingStates: [],
    });
    await expect(syncRoadmapItemStatus(prisma, "issue-1")).resolves.toBeUndefined();
  });

  it("bails without writing when the roadmapItem row is missing (race guard)", async () => {
    // computeStatus returns a non-null status, but the roadmapItem was deleted
    // between the sibling query and the final findUnique → `!roadmapItem` fires.
    const prisma = makePrisma({
      issueRoadmapItemId: "rm-1",
      siblingStates: [{ state: "done" }],
      roadmapItem: null,
    });
    await expect(syncRoadmapItemStatus(prisma, "issue-1")).resolves.toBeUndefined();
  });
});
