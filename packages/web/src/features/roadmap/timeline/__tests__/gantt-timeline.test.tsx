import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { GanttTimeline } from "../gantt-timeline";

// Recharts uses ResizeObserver which jsdom doesn't have
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

// Mock the roadmap store to capture setSelectedItemId calls
const mockSetSelectedItemId = vi.fn();
vi.mock("@/stores/roadmap-store", async () => {
  const actual = await vi.importActual<typeof import("@/stores/roadmap-store")>(
    "@/stores/roadmap-store",
  );
  return {
    ...actual,
    useRoadmapStore: (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ setSelectedItemId: mockSetSelectedItemId }),
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
    createdAt: "2026-01-15T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

describe("GanttTimeline", () => {
  it("shows empty state when no items", () => {
    render(<GanttTimeline items={[]} />);
    expect(screen.getByText("No roadmap items yet")).toBeInTheDocument();
  });

  it("renders one ChartCard section per non-empty horizon", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha" }),
      makeItem({ id: "2", horizon: "now", title: "Beta" }),
      makeItem({ id: "3", horizon: "later", title: "Gamma" }),
    ];
    render(<GanttTimeline items={items} />);

    // ChartCard renders an h3 with the horizon label
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Later")).toBeInTheDocument();

    // Should not render sections for empty horizons
    expect(screen.queryByText("Someday")).not.toBeInTheDocument();
    expect(screen.queryByText("Next")).not.toBeInTheDocument();
  });

  it("shows encouraging message when fewer than 3 items", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Solo item" }),
    ];
    render(<GanttTimeline items={items} />);
    expect(
      screen.getByText("Add more items to see a richer timeline view."),
    ).toBeInTheDocument();
  });

  it("does not show encouraging message when 3 or more items", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "One" }),
      makeItem({ id: "2", horizon: "now", title: "Two" }),
      makeItem({ id: "3", horizon: "now", title: "Three" }),
    ];
    render(<GanttTimeline items={items} />);
    expect(
      screen.queryByText("Add more items to see a richer timeline view."),
    ).not.toBeInTheDocument();
  });

  it("renders subtitle with item count per horizon section", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "A" }),
      makeItem({ id: "2", horizon: "now", title: "B" }),
    ];
    render(<GanttTimeline items={items} />);
    expect(screen.getByText("2 items")).toBeInTheDocument();
  });

  it("renders singular 'item' for single-item horizons", () => {
    const items = [
      makeItem({ id: "1", horizon: "later", title: "Solo" }),
    ];
    render(<GanttTimeline items={items} />);
    expect(screen.getByText("1 item")).toBeInTheDocument();
  });
});
