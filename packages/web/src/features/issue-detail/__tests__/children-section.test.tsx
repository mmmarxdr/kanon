import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ChildrenSection } from "@/features/issue-detail/children-section";
import type { Issue } from "@/types/issue";

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function makeChild(overrides: Partial<Issue> = {}): Issue {
  return {
    id: "child-1",
    key: "KAN-10",
    title: "Child task",
    type: "task",
    priority: "medium",
    state: "apply",
    labels: [],
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/* ------------------------------------------------------------------ */
/*  ChildrenSection                                                    */
/* ------------------------------------------------------------------ */

describe("ChildrenSection", () => {
  it("returns null when children array is empty", () => {
    const { container } = render(
      <ChildrenSection children={[]} onSelect={vi.fn()} />,
    );

    expect(container.innerHTML).toBe("");
  });

  it("renders children with key, title, state badge, and sdd labels", () => {
    const children: Issue[] = [
      makeChild({
        id: "c1",
        key: "KAN-10",
        title: "Implement auth",
        state: "apply",
        labels: ["sdd:design", "frontend"],
      }),
      makeChild({
        id: "c2",
        key: "KAN-11",
        title: "Write tests",
        state: "verify",
        labels: ["sdd:spec"],
      }),
    ];

    render(
      <ChildrenSection children={children} onSelect={vi.fn()} />,
    );

    // Section header
    expect(screen.getByText("Sub-tasks")).toBeInTheDocument();

    // Issue keys
    expect(screen.getByText("KAN-10")).toBeInTheDocument();
    expect(screen.getByText("KAN-11")).toBeInTheDocument();

    // Titles
    expect(screen.getByText("Implement auth")).toBeInTheDocument();
    expect(screen.getByText("Write tests")).toBeInTheDocument();

    // State badges
    expect(screen.getByText("Apply")).toBeInTheDocument();
    expect(screen.getByText("Verify")).toBeInTheDocument();

    // SDD labels (only sdd: prefixed labels are shown)
    expect(screen.getByText("sdd:design")).toBeInTheDocument();
    expect(screen.getByText("sdd:spec")).toBeInTheDocument();

    // Non-SDD labels should NOT appear as tags
    expect(screen.queryByText("frontend")).not.toBeInTheDocument();
  });

  it("calls onSelect with the child key when a child row is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();

    const children: Issue[] = [
      makeChild({ id: "c1", key: "KAN-10", title: "First child" }),
      makeChild({ id: "c2", key: "KAN-11", title: "Second child" }),
    ];

    render(
      <ChildrenSection children={children} onSelect={onSelect} />,
    );

    await user.click(screen.getByText("First child"));
    expect(onSelect).toHaveBeenCalledWith("KAN-10");

    await user.click(screen.getByText("Second child"));
    expect(onSelect).toHaveBeenCalledWith("KAN-11");
  });

  it("SDD labels have violet styling", () => {
    const children: Issue[] = [
      makeChild({
        id: "c1",
        key: "KAN-10",
        title: "With SDD label",
        labels: ["sdd:explore", "regular-label"],
      }),
    ];

    render(
      <ChildrenSection children={children} onSelect={vi.fn()} />,
    );

    const sddLabel = screen.getByText("sdd:explore");
    expect(sddLabel.className).toContain("bg-primary/10");
    expect(sddLabel.className).toContain("text-primary");
  });

  it("renders list with proper role attribute", () => {
    const children: Issue[] = [
      makeChild({ id: "c1", key: "KAN-10" }),
    ];

    render(
      <ChildrenSection children={children} onSelect={vi.fn()} />,
    );

    expect(screen.getByRole("list")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });
});
