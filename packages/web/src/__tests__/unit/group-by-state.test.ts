import { describe, it, expect } from "vitest";
import { groupByState } from "@/features/board/use-issues-query";
import type { Issue } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";

function makeIssue(overrides: Partial<Issue> & { state: IssueState }): Issue {
  return {
    id: "id-1",
    key: "KAN-1",
    title: "Test issue",
    type: "task",
    priority: "medium",
    labels: [],
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("groupByState", () => {
  it("initializes every state with an empty array when given no issues", () => {
    const grouped = groupByState([]);

    const expectedStates: IssueState[] = [
      "backlog",
      "explore",
      "propose",
      "design",
      "spec",
      "tasks",
      "apply",
      "verify",
      "archived",
    ];

    expect(grouped.size).toBe(expectedStates.length);
    for (const state of expectedStates) {
      expect(grouped.get(state)).toEqual([]);
    }
  });

  it("places issues into the correct state bucket", () => {
    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "apply" }),
      makeIssue({ key: "KAN-2", state: "apply" }),
      makeIssue({ key: "KAN-3", state: "verify" }),
    ];

    const grouped = groupByState(issues);

    expect(grouped.get("apply")).toHaveLength(2);
    expect(grouped.get("apply")!.map((i) => i.key)).toEqual([
      "KAN-1",
      "KAN-2",
    ]);
    expect(grouped.get("verify")).toHaveLength(1);
    expect(grouped.get("verify")![0]!.key).toBe("KAN-3");
  });

  it("leaves other states empty when issues only belong to some states", () => {
    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "backlog" }),
    ];

    const grouped = groupByState(issues);

    expect(grouped.get("backlog")).toHaveLength(1);
    expect(grouped.get("explore")).toEqual([]);
    expect(grouped.get("archived")).toEqual([]);
  });

  it("distributes issues across all states correctly", () => {
    const states: IssueState[] = [
      "backlog",
      "explore",
      "propose",
      "design",
      "spec",
      "tasks",
      "apply",
      "verify",
      "archived",
    ];

    const issues = states.map((state, idx) =>
      makeIssue({ key: `KAN-${idx}`, state }),
    );

    const grouped = groupByState(issues);

    for (const state of states) {
      expect(grouped.get(state)).toHaveLength(1);
    }
  });

  it("preserves issue order within a bucket", () => {
    const issues: Issue[] = [
      makeIssue({ key: "KAN-A", state: "design", title: "First" }),
      makeIssue({ key: "KAN-B", state: "design", title: "Second" }),
      makeIssue({ key: "KAN-C", state: "design", title: "Third" }),
    ];

    const grouped = groupByState(issues);
    const designKeys = grouped.get("design")!.map((i) => i.key);

    expect(designKeys).toEqual(["KAN-A", "KAN-B", "KAN-C"]);
  });
});
