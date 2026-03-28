import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { DndContext } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { GroupCard } from "@/features/board/group-card";
import type { GroupSummary } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";

function makeGroup(
  overrides?: Partial<GroupSummary> & { latestState?: IssueState },
): GroupSummary {
  return {
    groupKey: "sdd/auth-model",
    count: 4,
    latestState: "apply",
    title: "Auth Model Implementation",
    updatedAt: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

function renderGroupCard(
  group: GroupSummary,
  onClick?: (groupKey: string, element: HTMLElement) => void,
) {
  return render(
    <DndContext>
      <SortableContext
        items={[`group:${group.groupKey}`]}
        strategy={verticalListSortingStrategy}
      >
        <GroupCard group={group} onClick={onClick} />
      </SortableContext>
    </DndContext>,
  );
}

describe("GroupCard", () => {
  it("renders the group title", () => {
    const group = makeGroup();
    renderGroupCard(group);
    expect(screen.getByText("Auth Model Implementation")).toBeInTheDocument();
  });

  it("renders the count badge", () => {
    const group = makeGroup({ count: 7 });
    renderGroupCard(group);
    expect(screen.getByText("7")).toBeInTheDocument();
  });

  it("renders the latest state label", () => {
    const group = makeGroup({ latestState: "verify" });
    renderGroupCard(group);
    expect(screen.getByText("Verify")).toBeInTheDocument();
  });

  it("renders the groupKey as mono text", () => {
    const group = makeGroup({ groupKey: "sdd/my-feature" });
    renderGroupCard(group);
    expect(screen.getByText("sdd/my-feature")).toBeInTheDocument();
  });

  it("falls back to humanized groupKey when title is empty", () => {
    const group = makeGroup({ title: "", groupKey: "sdd/auth-model" });
    renderGroupCard(group);
    expect(screen.getByText("Auth Model")).toBeInTheDocument();
  });

  it("has correct test ID", () => {
    const group = makeGroup({ groupKey: "sdd/test-group" });
    renderGroupCard(group);
    expect(
      screen.getByTestId("group-card-sdd/test-group"),
    ).toBeInTheDocument();
  });

  it("calls onClick with groupKey when clicked", () => {
    const group = makeGroup();
    const handleClick = vi.fn();
    renderGroupCard(group, handleClick);

    fireEvent.click(screen.getByTestId(`group-card-${group.groupKey}`));
    expect(handleClick).toHaveBeenCalledWith(
      group.groupKey,
      expect.any(HTMLElement),
    );
  });
});
