import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { HierarchyIssueBlock } from "../hierarchy-issue-block";
import { buildIssueForest } from "@/lib/build-issue-forest";
import type { Issue } from "@kanon/shared";

vi.mock("@/components/ui/icons", () => ({
  Icon: {
    ChevR: () => <span data-testid="chev">›</span>,
  },
}));

vi.mock("@/components/ui/primitives", () => ({
  Avatar: () => <span />,
  Prio: () => <span />,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TypeGlyph: () => <span />,
  avatarInitials: () => "X",
}));

function issue(
  id: string,
  key: string,
  parentId: string | null = null,
  state: Issue["state"] = "todo",
): Issue {
  return {
    id,
    key,
    title: `Title ${key}`,
    type: "task",
    priority: "medium",
    state,
    labels: [],
    parentId,
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function renderBlock(node: ReturnType<typeof buildIssueForest>["roots"][0], onSelect?: (k: string) => void) {
  return render(
    <DndContext>
      <SortableContext items={[node.key]} strategy={verticalListSortingStrategy}>
        <HierarchyIssueBlock node={node} onSelectIssue={onSelect} />
      </SortableContext>
    </DndContext>,
  );
}

describe("HierarchyIssueBlock", () => {
  it("shows disclosure on root with descendants", () => {
    const forest = buildIssueForest([
      issue("r", "R"),
      issue("c", "C", "r"),
    ]);
    renderBlock(forest.roots[0]!);

    expect(screen.getByTestId("hierarchy-toggle-R")).toBeTruthy();
    expect(screen.getByTestId("hierarchy-toggle-R").textContent).toContain("1");
    expect(screen.queryByTestId("hierarchy-child-C")).toBeNull();
  });

  it("leaf root has no disclosure", () => {
    const forest = buildIssueForest([issue("r", "R")]);
    renderBlock(forest.roots[0]!);

    expect(screen.queryByTestId("hierarchy-toggle-R")).toBeNull();
  });

  it("expand reveals child once; click navigates", () => {
    const onSelect = vi.fn();
    const forest = buildIssueForest([
      issue("r", "R", null, "in_progress"),
      issue("c", "C", "r", "todo"),
    ]);
    renderBlock(forest.roots[0]!, onSelect);

    fireEvent.click(screen.getByTestId("hierarchy-toggle-R"));
    expect(screen.getByTestId("hierarchy-child-C")).toBeTruthy();
    expect(screen.getByText("Title C")).toBeTruthy();

    fireEvent.click(screen.getByTestId("hierarchy-child-C"));
    expect(onSelect).toHaveBeenCalledWith("C");
  });

  it("nested expand reveals grandchild", () => {
    const forest = buildIssueForest([
      issue("r", "R"),
      issue("c", "C", "r"),
      issue("g", "G", "c"),
    ]);
    renderBlock(forest.roots[0]!);

    fireEvent.click(screen.getByTestId("hierarchy-toggle-R"));
    fireEvent.click(screen.getByTestId("hierarchy-toggle-C"));
    expect(screen.getByTestId("hierarchy-child-G")).toBeTruthy();
  });
});
