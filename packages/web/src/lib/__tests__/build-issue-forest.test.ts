import { describe, it, expect } from "vitest";
import {
  ISSUE_FOREST_MAX_DEPTH,
  buildIssueForest,
  type IssueNode,
} from "../build-issue-forest";
import type { Issue } from "@kanon/shared";

function issue(
  id: string,
  key: string,
  parentId: string | null = null,
): Issue {
  return {
    id,
    key,
    title: key,
    type: "task",
    priority: "medium",
    state: "todo",
    labels: [],
    parentId,
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function keys(nodes: IssueNode[]): string[] {
  return nodes.map((n) => n.key);
}

describe("buildIssueForest", () => {
  it("returns empty forest for empty input", () => {
    const forest = buildIssueForest([]);
    expect(forest.roots).toEqual([]);
    expect(forest.total).toBe(0);
    expect(forest.rootCount).toBe(0);
  });

  it("nests root → child → grandchild and counts descendants", () => {
    const forest = buildIssueForest([
      issue("r", "R"),
      issue("c", "C", "r"),
      issue("g", "G", "c"),
    ]);

    expect(keys(forest.roots)).toEqual(["R"]);
    expect(keys(forest.roots[0]!.children)).toEqual(["C"]);
    expect(keys(forest.roots[0]!.children[0]!.children)).toEqual(["G"]);
    expect(forest.roots[0]!.descendantCount).toBe(2);
    expect(forest.roots[0]!.children[0]!.descendantCount).toBe(1);
    expect(forest.total).toBe(3);
    expect(forest.rootCount).toBe(1);
  });

  it("promotes orphans (missing parent) to roots", () => {
    const forest = buildIssueForest([
      issue("r", "R"),
      issue("o", "O", "missing-parent"),
    ]);

    expect(keys(forest.roots).sort()).toEqual(["O", "R"]);
    expect(forest.rootCount).toBe(2);
  });

  it("treats self-parent as root", () => {
    const forest = buildIssueForest([issue("a", "A", "a")]);
    expect(keys(forest.roots)).toEqual(["A"]);
    expect(forest.roots[0]!.children).toEqual([]);
  });

  it("breaks cycles without infinite recursion", () => {
    const forest = buildIssueForest([
      issue("a", "A", "b"),
      issue("b", "B", "a"),
    ]);

    expect(forest.rootCount).toBe(2);
    expect(keys(forest.roots).sort()).toEqual(["A", "B"]);
    // Neither should nest the other (cycle skipped)
    expect(forest.roots.every((r) => r.children.length === 0)).toBe(true);
  });

  it("keeps non-cyclic child attached when ancestry hits a separate cycle", () => {
    // A → B, and B ↔ C. Attaching A under B must succeed.
    const forest = buildIssueForest([
      issue("a", "A", "b"),
      issue("b", "B", "c"),
      issue("c", "C", "b"),
    ]);

    const a = forest.byId.get("a");
    expect(a).toBeTruthy();
    // B and C form a cycle → both roots; A should nest under B if B is a root
    const bRoot = forest.roots.find((r) => r.key === "B");
    expect(bRoot).toBeTruthy();
    expect(keys(bRoot!.children)).toContain("A");
    expect(forest.roots.some((r) => r.key === "A")).toBe(false);
  });

  it("caps nesting at ISSUE_FOREST_MAX_DEPTH", () => {
    const chain: Issue[] = [];
    for (let i = 0; i <= ISSUE_FOREST_MAX_DEPTH + 2; i++) {
      const id = `n${i}`;
      const parentId = i === 0 ? null : `n${i - 1}`;
      chain.push(issue(id, `N${i}`, parentId));
    }

    const forest = buildIssueForest(chain);
    // Walk deepest nested path from primary root N0
    const root = forest.roots.find((r) => r.key === "N0");
    expect(root).toBeTruthy();

    let node = root!;
    let depth = 0;
    while (node.children.length === 1) {
      node = node.children[0]!;
      depth += 1;
      expect(depth).toBeLessThanOrEqual(ISSUE_FOREST_MAX_DEPTH);
    }

    // Overflow nodes must still be present as roots (promoted)
    expect(forest.total).toBe(chain.length);
    expect(forest.rootCount).toBeGreaterThan(1);
  });

  it("sorts siblings by key", () => {
    const forest = buildIssueForest([
      issue("r", "R"),
      issue("b", "B", "r"),
      issue("a", "A", "r"),
    ]);
    expect(keys(forest.roots[0]!.children)).toEqual(["A", "B"]);
  });
});
