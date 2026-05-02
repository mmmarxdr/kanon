import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { ConfidenceTable } from "../confidence-table";

function makeItem(overrides: Partial<RoadmapItem> = {}): RoadmapItem {
  return {
    id: "i1",
    title: "Demo item",
    horizon: "now",
    status: "idea",
    labels: [],
    sortOrder: 0,
    promoted: false,
    projectId: "p1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("ConfidenceTable", () => {
  it("shows the empty state when there are no predictions", () => {
    render(<ConfidenceTable items={[makeItem()]} />);
    expect(screen.getByText("No predictions yet")).toBeInTheDocument();
    expect(screen.getByText(/Connect the Claude MCP forecaster/)).toBeInTheDocument();
    expect(screen.getByText("not connected")).toBeInTheDocument();
  });

  it("renders one row per prediction with item title and ETA", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "i1", title: "Alpha" }),
      makeItem({ id: "i2", title: "Beta", horizon: "next" }),
    ];
    render(
      <ConfidenceTable
        items={items}
        predictions={[
          { itemId: "i1", eta: "w 4", confidence: 0.92 },
          { itemId: "i2", eta: "w 8", confidence: 0.6 },
        ]}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("w 4")).toBeInTheDocument();
    expect(screen.getByText("w 8")).toBeInTheDocument();
    expect(screen.getByText(/top 2 earliest/)).toBeInTheDocument();
  });

  it("ignores predictions whose itemId doesn't match any item", () => {
    const items: RoadmapItem[] = [makeItem({ id: "i1", title: "Alpha" })];
    render(
      <ConfidenceTable
        items={items}
        predictions={[
          { itemId: "i1", eta: "w 4", confidence: 0.7 },
          { itemId: "ghost", eta: "w 99", confidence: 0.4 },
        ]}
      />,
    );
    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.queryByText("w 99")).not.toBeInTheDocument();
  });
});
