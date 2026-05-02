import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { EffortImpactChart } from "../effort-impact-chart";

// Recharts uses ResizeObserver which jsdom doesn't have
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  // Force a positive container width so the chart actually renders
  // (jsdom returns 0 for getBoundingClientRect by default).
  Element.prototype.getBoundingClientRect = function () {
    return {
      width: 600,
      height: 320,
      top: 0,
      left: 0,
      right: 600,
      bottom: 320,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };
});

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

describe("EffortImpactChart — quadrant labels (KAN-37)", () => {
  it("renders all four quadrant labels when data is present", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "1", effort: 1, impact: 5 }),
      makeItem({ id: "2", effort: 5, impact: 5 }),
      makeItem({ id: "3", effort: 1, impact: 1 }),
      makeItem({ id: "4", effort: 5, impact: 1 }),
    ];

    render(<EffortImpactChart items={items} />);

    expect(screen.getByText("QUICK WINS")).toBeInTheDocument();
    expect(screen.getByText("BIG BETS")).toBeInTheDocument();
    expect(screen.getByText("FILLER")).toBeInTheDocument();
    expect(screen.getByText("MONEY PITS")).toBeInTheDocument();
  });
});
