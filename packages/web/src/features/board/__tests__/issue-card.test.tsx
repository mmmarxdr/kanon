import { DndContext } from "@dnd-kit/core";
import { SortableContext } from "@dnd-kit/sortable";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { IssueCard } from "../issue-card";

vi.mock("@/components/ui/icons", () => ({ Icon: { ChevR: () => null } }));
vi.mock("@/components/ui/primitives", () => ({
  Avatar: () => null,
  Prio: () => null,
  Tag: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
  TypeGlyph: () => null,
  avatarInitials: () => "K",
}));

const issue = {
  id: "issue-1",
  key: "KAN-7",
  title: "Owner safe capture",
  type: "task" as const,
  priority: "medium" as const,
  state: "todo" as const,
  labels: [],
  projectId: "project-1",
  createdAt: "2026-08-19T00:00:00.000Z",
  updatedAt: "2026-08-19T00:00:00.000Z",
};

describe("IssueCard capture marker", () => {
  it("marks the exact issue key on the interactive card root", () => {
    render(
      <DndContext>
        <SortableContext items={[issue.key]}>
          <IssueCard issue={issue} />
        </SortableContext>
      </DndContext>,
    );
    expect(screen.getByTestId("issue-card-KAN-7")).toHaveAttribute("data-issue-key", "KAN-7");
  });
});
