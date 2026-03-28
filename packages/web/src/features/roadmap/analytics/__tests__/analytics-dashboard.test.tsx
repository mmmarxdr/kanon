import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { AnalyticsDashboard } from "../analytics-dashboard";

// Recharts uses ResizeObserver which jsdom doesn't have
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
  makeItem({ id: "1", horizon: "now", status: "idea", effort: 3, impact: 4, promoted: true }),
  makeItem({ id: "2", horizon: "next", status: "planned", effort: 2, impact: 5 }),
  makeItem({ id: "3", horizon: "later", status: "in_progress", effort: 4, impact: 2 }),
  makeItem({ id: "4", horizon: "now", status: "done", promoted: true }),
  makeItem({ id: "5", horizon: "someday", status: "idea", createdAt: "2025-01-01T00:00:00Z" }),
];

describe("AnalyticsDashboard", () => {
  it("renders all 5 chart card titles", () => {
    render(<AnalyticsDashboard items={SAMPLE_ITEMS} />);

    expect(screen.getByText("Effort vs Impact")).toBeInTheDocument();
    expect(screen.getByText("Horizon Distribution")).toBeInTheDocument();
    expect(screen.getByText("Status Breakdown")).toBeInTheDocument();
    expect(screen.getByText("Promotion Rate")).toBeInTheDocument();
    expect(screen.getByText("Aging Ideas")).toBeInTheDocument();
  });

  it("renders with empty items without crashing", () => {
    render(<AnalyticsDashboard items={[]} />);

    expect(screen.getByText("Effort vs Impact")).toBeInTheDocument();
    expect(screen.getByText("Promotion Rate")).toBeInTheDocument();
  });
});
