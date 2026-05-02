import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem, RoadmapDependency } from "@/types/roadmap";
import { AnalyticsKPIStrip } from "../kpi-strip";

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

function makeDep(id: string): RoadmapDependency {
  return {
    id,
    type: "blocks",
    sourceId: "x",
    targetId: "y",
    createdAt: "2026-01-01T00:00:00Z",
  };
}

describe("AnalyticsKPIStrip (KAN-34)", () => {
  it("renders six KPI labels", () => {
    render(<AnalyticsKPIStrip items={[]} />);
    expect(screen.getByText(/Items/i)).toBeInTheDocument();
    expect(screen.getByText(/In progress/i)).toBeInTheDocument();
    expect(screen.getByText(/Dependency edges/i)).toBeInTheDocument();
    expect(screen.getByText(/Avg effort/i)).toBeInTheDocument();
    expect(screen.getByText(/Avg impact/i)).toBeInTheDocument();
    expect(screen.getByText(/Now \/ Next ratio/i)).toBeInTheDocument();
  });

  it("renders dashes for every value when there are zero items", () => {
    const { container } = render(<AnalyticsKPIStrip items={[]} />);
    const values = container.querySelectorAll<HTMLElement>(
      '[data-testid="kpi-value"]',
    );
    expect(values.length).toBe(6);
    for (const v of values) {
      expect(v.textContent).toBe("—");
    }
  });

  it("computes the right values for a known set of items", () => {
    // 4 items
    //  - 2 in_progress (50%)
    //  - efforts: 1, 3, 5, null → mean over present = 3.0
    //  - impacts: 2, 2, null, 4 → mean over present = 8/3 = 2.7
    //  - blocks edges: 1 + 2 + 0 + 0 = 3
    //  - horizons: now=2, next=1, later=1, someday=0 → ratio "2 : 1"
    const items: RoadmapItem[] = [
      makeItem({
        id: "1",
        horizon: "now",
        status: "in_progress",
        effort: 1,
        impact: 2,
        blocks: [makeDep("d1")],
      }),
      makeItem({
        id: "2",
        horizon: "now",
        status: "in_progress",
        effort: 3,
        impact: 2,
        blocks: [makeDep("d2"), makeDep("d3")],
      }),
      makeItem({
        id: "3",
        horizon: "next",
        status: "idea",
        effort: 5,
        impact: null,
      }),
      makeItem({
        id: "4",
        horizon: "later",
        status: "planned",
        effort: null,
        impact: 4,
      }),
    ];

    const { container } = render(<AnalyticsKPIStrip items={items} />);

    const get = (label: string) =>
      container
        .querySelector<HTMLElement>(`[data-kpi="${label}"] [data-testid="kpi-value"]`)
        ?.textContent ?? "";

    expect(get("items")).toBe("4");
    expect(get("in-progress")).toBe("50%");
    expect(get("dependency-edges")).toBe("3");
    expect(get("avg-effort")).toBe("3.0");
    expect(get("avg-impact")).toBe("2.7");
    expect(get("now-next-ratio")).toBe("2 : 1");
  });

  it("Now/Next ratio uses max(1, count(next)) so the divisor is never zero", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "1", horizon: "now" }),
      makeItem({ id: "2", horizon: "now" }),
      makeItem({ id: "3", horizon: "now" }),
      // no next
    ];

    const { container } = render(<AnalyticsKPIStrip items={items} />);
    const ratio = container.querySelector<HTMLElement>(
      '[data-kpi="now-next-ratio"] [data-testid="kpi-value"]',
    );
    expect(ratio?.textContent).toBe("3 : 1");
  });
});
