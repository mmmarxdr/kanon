import { describe, it, expect, beforeAll } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { HorizonDistributionChart } from "../horizon-distribution-chart";

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}

beforeAll(() => {
  globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
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

describe("HorizonDistributionChart", () => {
  it("renders one segment per non-empty horizon, with proportional flex", () => {
    // 2 now, 1 next, 1 later, 0 someday → 3 segments rendered
    const items: RoadmapItem[] = [
      makeItem({ id: "1", horizon: "now" }),
      makeItem({ id: "2", horizon: "now" }),
      makeItem({ id: "3", horizon: "next" }),
      makeItem({ id: "4", horizon: "later" }),
    ];

    const { container } = render(<HorizonDistributionChart items={items} />);

    const segments = container.querySelectorAll<HTMLElement>(
      '[data-testid="horizon-segment"]',
    );
    expect(segments.length).toBe(3); // someday omitted because 0

    const flexValues = Array.from(segments).map((s) =>
      Number(s.style.flexGrow || s.style.flex.split(" ")[0] || 0),
    );
    // proportions: now=2, next=1, later=1
    expect(flexValues[0]).toBe(2);
    expect(flexValues[1]).toBe(1);
    expect(flexValues[2]).toBe(1);
  });

  it("uses design-system tokens for each horizon (var(--accent), var(--ai), var(--warn), var(--ink-4))", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "1", horizon: "now" }),
      makeItem({ id: "2", horizon: "next" }),
      makeItem({ id: "3", horizon: "later" }),
      makeItem({ id: "4", horizon: "someday" }),
    ];

    const { container } = render(<HorizonDistributionChart items={items} />);

    expect(
      container
        .querySelector<HTMLElement>('[data-horizon="now"]')
        ?.style.background,
    ).toContain("--accent");
    expect(
      container
        .querySelector<HTMLElement>('[data-horizon="next"]')
        ?.style.background,
    ).toContain("--ai");
    expect(
      container
        .querySelector<HTMLElement>('[data-horizon="later"]')
        ?.style.background,
    ).toContain("--warn");
    expect(
      container
        .querySelector<HTMLElement>('[data-horizon="someday"]')
        ?.style.background,
    ).toContain("--ink-4");
  });

  it("renders the count inside each segment", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "1", horizon: "now" }),
      makeItem({ id: "2", horizon: "now" }),
      makeItem({ id: "3", horizon: "next" }),
    ];

    const { container } = render(<HorizonDistributionChart items={items} />);

    const nowSeg = container.querySelector<HTMLElement>(
      '[data-horizon="now"]',
    );
    const nextSeg = container.querySelector<HTMLElement>(
      '[data-horizon="next"]',
    );
    expect(nowSeg?.textContent?.trim()).toBe("2");
    expect(nextSeg?.textContent?.trim()).toBe("1");
  });

  it("renders the legend rows with label, count, and percent", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "1", horizon: "now" }),
      makeItem({ id: "2", horizon: "next" }),
      makeItem({ id: "3", horizon: "later" }),
      makeItem({ id: "4", horizon: "someday" }),
    ];
    render(<HorizonDistributionChart items={items} />);
    expect(screen.getByText("Now")).toBeInTheDocument();
    expect(screen.getByText("Next")).toBeInTheDocument();
    expect(screen.getByText("Later")).toBeInTheDocument();
    expect(screen.getByText("Someday")).toBeInTheDocument();
    expect(screen.getAllByText("25%").length).toBeGreaterThanOrEqual(4);
  });

  it("renders the title and shows empty state when no items", () => {
    render(<HorizonDistributionChart items={[]} />);
    expect(screen.getByText("Horizon distribution")).toBeInTheDocument();
    expect(screen.getByText("No roadmap items yet.")).toBeInTheDocument();
  });
});
