import { describe, it, expect } from "vitest";
import { groupSummariesByColumn } from "@/features/board/use-issues-query";
import type { GroupSummary } from "@/types/issue";
import type { IssueState, BoardColumn } from "@/stores/board-store";

function makeGroup(
  overrides: Partial<GroupSummary> & { groupKey: string; latestState: IssueState },
): GroupSummary {
  return {
    count: 3,
    title: "Test Group",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("groupSummariesByColumn", () => {
  it("initializes every column with an empty array when given no groups", () => {
    const grouped = groupSummariesByColumn([]);
    const expectedColumns: BoardColumn[] = [
      "backlog",
      "analysis",
      "in_progress",
      "testing",
      "finished",
    ];
    expect(grouped.size).toBe(expectedColumns.length);
    for (const col of expectedColumns) {
      expect(grouped.get(col)).toEqual([]);
    }
  });

  it("places groups into the correct column by latestState", () => {
    const groups: GroupSummary[] = [
      makeGroup({ groupKey: "sdd/auth", latestState: "apply" }), // in_progress
      makeGroup({ groupKey: "sdd/ui", latestState: "verify" }), // testing
      makeGroup({ groupKey: "sdd/db", latestState: "archived" }), // finished
    ];

    const grouped = groupSummariesByColumn(groups);

    const inProgress = grouped.get("in_progress")!;
    expect(inProgress).toHaveLength(1);
    expect(inProgress[0]!.groupKey).toBe("sdd/auth");

    const testing = grouped.get("testing")!;
    expect(testing).toHaveLength(1);
    expect(testing[0]!.groupKey).toBe("sdd/ui");

    const finished = grouped.get("finished")!;
    expect(finished).toHaveLength(1);
    expect(finished[0]!.groupKey).toBe("sdd/db");
  });

  it("places multiple groups in the same column", () => {
    const groups: GroupSummary[] = [
      makeGroup({ groupKey: "sdd/a", latestState: "propose" }), // analysis
      makeGroup({ groupKey: "sdd/b", latestState: "design" }), // analysis
      makeGroup({ groupKey: "sdd/c", latestState: "spec" }), // analysis
    ];

    const grouped = groupSummariesByColumn(groups);
    expect(grouped.get("analysis")).toHaveLength(3);
  });

  it("maps backlog states to backlog column", () => {
    const groups: GroupSummary[] = [
      makeGroup({ groupKey: "sdd/x", latestState: "backlog" }),
      makeGroup({ groupKey: "sdd/y", latestState: "explore" }),
    ];

    const grouped = groupSummariesByColumn(groups);
    expect(grouped.get("backlog")).toHaveLength(2);
  });
});
