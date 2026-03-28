import { describe, it, expect } from "vitest";
import { groupByColumn } from "@/features/board/use-issues-query";
import type { Issue } from "@/types/issue";
import type { BoardColumn, IssueState } from "@/stores/board-store";
import {
  BOARD_COLUMNS,
  COLUMN_STATE_MAP,
  COLUMN_DEFAULT_STATE,
} from "@/stores/board-store";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  IssueState -> BoardColumn mapping                                  */
/* ------------------------------------------------------------------ */

describe("IssueState to BoardColumn mapping", () => {
  it.each<[IssueState, BoardColumn]>([
    ["backlog", "backlog"],
    ["explore", "backlog"],
    ["propose", "analysis"],
    ["design", "analysis"],
    ["spec", "analysis"],
    ["tasks", "in_progress"],
    ["apply", "in_progress"],
    ["verify", "testing"],
    ["archived", "finished"],
  ])("maps %s to %s column", (issueState, expectedColumn) => {
    const issues = [makeIssue({ key: "KAN-1", state: issueState })];
    const grouped = groupByColumn(issues);

    expect(grouped.get(expectedColumn)).toHaveLength(1);
    expect(grouped.get(expectedColumn)![0]!.state).toBe(issueState);
  });

  it("covers all 9 IssueStates across all columns", () => {
    const allStates = BOARD_COLUMNS.flatMap(
      (col) => COLUMN_STATE_MAP[col] as readonly IssueState[],
    );

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

    expect(allStates).toHaveLength(expectedStates.length);
    for (const state of expectedStates) {
      expect(allStates).toContain(state);
    }
  });
});

/* ------------------------------------------------------------------ */
/*  groupByColumn                                                      */
/* ------------------------------------------------------------------ */

describe("groupByColumn", () => {
  it("returns all 5 columns even with empty input", () => {
    const grouped = groupByColumn([]);

    expect(grouped.size).toBe(5);
    for (const col of BOARD_COLUMNS) {
      expect(grouped.get(col)).toEqual([]);
    }
  });

  it("distributes issues into the correct columns", () => {
    const issues: Issue[] = [
      makeIssue({ id: "1", key: "KAN-1", state: "backlog" }),
      makeIssue({ id: "2", key: "KAN-2", state: "explore" }),
      makeIssue({ id: "3", key: "KAN-3", state: "propose" }),
      makeIssue({ id: "4", key: "KAN-4", state: "design" }),
      makeIssue({ id: "5", key: "KAN-5", state: "spec" }),
      makeIssue({ id: "6", key: "KAN-6", state: "tasks" }),
      makeIssue({ id: "7", key: "KAN-7", state: "apply" }),
      makeIssue({ id: "8", key: "KAN-8", state: "verify" }),
      makeIssue({ id: "9", key: "KAN-9", state: "archived" }),
    ];

    const grouped = groupByColumn(issues);

    // backlog: backlog + explore
    expect(grouped.get("backlog")).toHaveLength(2);
    expect(grouped.get("backlog")!.map((i) => i.key)).toEqual([
      "KAN-1",
      "KAN-2",
    ]);

    // analysis: propose + design + spec
    expect(grouped.get("analysis")).toHaveLength(3);
    expect(grouped.get("analysis")!.map((i) => i.key)).toEqual([
      "KAN-3",
      "KAN-4",
      "KAN-5",
    ]);

    // in_progress: tasks + apply
    expect(grouped.get("in_progress")).toHaveLength(2);
    expect(grouped.get("in_progress")!.map((i) => i.key)).toEqual([
      "KAN-6",
      "KAN-7",
    ]);

    // testing: verify
    expect(grouped.get("testing")).toHaveLength(1);
    expect(grouped.get("testing")![0]!.key).toBe("KAN-8");

    // finished: archived
    expect(grouped.get("finished")).toHaveLength(1);
    expect(grouped.get("finished")![0]!.key).toBe("KAN-9");
  });

  it("leaves other columns empty when issues only belong to some columns", () => {
    const issues: Issue[] = [
      makeIssue({ key: "KAN-1", state: "verify" }),
    ];

    const grouped = groupByColumn(issues);

    expect(grouped.get("testing")).toHaveLength(1);
    expect(grouped.get("backlog")).toEqual([]);
    expect(grouped.get("analysis")).toEqual([]);
    expect(grouped.get("in_progress")).toEqual([]);
    expect(grouped.get("finished")).toEqual([]);
  });

  it("preserves issue order within a column", () => {
    const issues: Issue[] = [
      makeIssue({ id: "1", key: "KAN-A", state: "propose", title: "First" }),
      makeIssue({ id: "2", key: "KAN-B", state: "design", title: "Second" }),
      makeIssue({ id: "3", key: "KAN-C", state: "spec", title: "Third" }),
    ];

    const grouped = groupByColumn(issues);
    const analysisKeys = grouped.get("analysis")!.map((i) => i.key);

    expect(analysisKeys).toEqual(["KAN-A", "KAN-B", "KAN-C"]);
  });
});

/* ------------------------------------------------------------------ */
/*  COLUMN_DEFAULT_STATE                                               */
/* ------------------------------------------------------------------ */

describe("COLUMN_DEFAULT_STATE", () => {
  it.each<[BoardColumn, IssueState]>([
    ["backlog", "backlog"],
    ["analysis", "propose"],
    ["in_progress", "tasks"],
    ["testing", "verify"],
    ["finished", "archived"],
  ])("maps %s column to %s default state", (column, expectedState) => {
    expect(COLUMN_DEFAULT_STATE[column]).toBe(expectedState);
  });

  it("has an entry for every board column", () => {
    for (const col of BOARD_COLUMNS) {
      expect(COLUMN_DEFAULT_STATE[col]).toBeDefined();
    }
  });

  it("each default state is contained in the column's COLUMN_STATE_MAP", () => {
    for (const col of BOARD_COLUMNS) {
      const defaultState = COLUMN_DEFAULT_STATE[col];
      const allowedStates = COLUMN_STATE_MAP[col];
      expect(allowedStates).toContain(defaultState);
    }
  });
});
