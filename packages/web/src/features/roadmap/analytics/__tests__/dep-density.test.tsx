import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem, RoadmapDependency } from "@/types/roadmap";
import { DepDensity } from "../dep-density";

function makeItem(overrides: Partial<RoadmapItem> = {}): RoadmapItem {
  return {
    id: "item-1",
    title: "Default item",
    horizon: "now",
    status: "idea",
    labels: [],
    sortOrder: 0,
    promoted: false,
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function dep(sourceId: string, targetId: string): RoadmapDependency {
  return {
    id: `${sourceId}-${targetId}`,
    type: "blocks",
    sourceId,
    targetId,
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("DepDensity", () => {
  it("renders empty state when there are no dependencies", () => {
    render(<DepDensity items={[makeItem()]} />);
    expect(screen.getByText("No dependencies recorded yet.")).toBeInTheDocument();
  });

  it("ranks blockers by number of items they block", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "a", title: "Alpha", blocks: [dep("a", "b"), dep("a", "c"), dep("a", "d")] }),
      makeItem({ id: "b", title: "Beta", blocks: [dep("b", "e")] }),
      makeItem({ id: "c", title: "Charlie" }),
      makeItem({ id: "d", title: "Delta" }),
      makeItem({ id: "e", title: "Echo" }),
    ];
    render(<DepDensity items={items} />);
    // "Alpha" appears in both the column row and the AI insight — scope to "blocks N" badges
    expect(screen.getByText("blocks 3")).toBeInTheDocument();
    expect(screen.getByText("blocks 1")).toBeInTheDocument();
    // Beta only appears in the column (not heaviest)
    expect(screen.getByText("Beta")).toBeInTheDocument();
  });

  it("ranks most-blocked items by incoming dependencies", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "a", title: "Alpha", dependsOn: [dep("x", "a"), dep("y", "a")] }),
      makeItem({ id: "b", title: "Beta", dependsOn: [dep("x", "b")] }),
    ];
    render(<DepDensity items={items} />);
    expect(screen.getByText("← 2")).toBeInTheDocument();
    expect(screen.getByText("← 1")).toBeInTheDocument();
  });

  it("surfaces the worst blocker in the AI insight callout", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "a", title: "Big Blocker", blocks: [dep("a", "b"), dep("a", "c")] }),
    ];
    render(<DepDensity items={items} />);
    expect(screen.getByText(/heaviest blocker/i)).toBeInTheDocument();
    expect(screen.getByText(/2 downstream items/i)).toBeInTheDocument();
  });
});
