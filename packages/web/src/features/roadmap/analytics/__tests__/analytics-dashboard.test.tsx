import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { AnalyticsDashboard } from "../analytics-dashboard";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

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

const SAMPLE_ITEMS: RoadmapItem[] = [
  makeItem({ id: "1", horizon: "now", status: "idea", effort: 3, impact: 4 }),
  makeItem({ id: "2", horizon: "next", status: "planned", effort: 2, impact: 5 }),
  makeItem({ id: "3", horizon: "later", status: "in_progress", effort: 4, impact: 2 }),
  makeItem({ id: "4", horizon: "now", status: "done" }),
  makeItem({ id: "5", horizon: "someday", status: "idea" }),
];

describe("AnalyticsDashboard", () => {
  it("renders the six chart cards from the redesign layout", () => {
    render(<AnalyticsDashboard items={SAMPLE_ITEMS} />);

    expect(screen.getByText("Effort vs Impact")).toBeInTheDocument();
    expect(screen.getByText("Pipeline")).toBeInTheDocument();
    expect(screen.getByText("Dependency hotspots")).toBeInTheDocument();
    expect(screen.getByText("Throughput")).toBeInTheDocument();
    expect(screen.getByText("Horizon distribution")).toBeInTheDocument();
    expect(screen.getByText("Predicted ship dates")).toBeInTheDocument();
  });

  it("does NOT render the legacy Promotion Rate or Aging Ideas cards", () => {
    render(<AnalyticsDashboard items={SAMPLE_ITEMS} />);

    expect(screen.queryByText("Promotion Rate")).not.toBeInTheDocument();
    expect(screen.queryByText("Aging Ideas")).not.toBeInTheDocument();
  });

  it("renders with empty items without crashing", () => {
    render(<AnalyticsDashboard items={[]} />);

    expect(screen.getByText("Effort vs Impact")).toBeInTheDocument();
    expect(screen.getByText("Throughput")).toBeInTheDocument();
    expect(screen.getByText("Predicted ship dates")).toBeInTheDocument();
  });
});
