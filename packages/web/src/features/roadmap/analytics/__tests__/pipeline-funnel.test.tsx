import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { PipelineFunnel } from "../pipeline-funnel";

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

describe("PipelineFunnel", () => {
  it("renders all four pipeline stages in order", () => {
    const items: RoadmapItem[] = [
      makeItem({ id: "1", status: "idea" }),
      makeItem({ id: "2", status: "idea" }),
      makeItem({ id: "3", status: "planned" }),
      makeItem({ id: "4", status: "in_progress" }),
      makeItem({ id: "5", status: "done" }),
    ];

    const { container } = render(<PipelineFunnel items={items} />);

    const stages = container.querySelectorAll<HTMLElement>(
      '[data-testid="pipeline-stage"]',
    );
    expect(stages.length).toBe(4);

    const stageStatuses = Array.from(stages).map((s) =>
      s.getAttribute("data-status"),
    );
    expect(stageStatuses).toEqual(["idea", "planned", "in_progress", "done"]);
  });

  it("shows the share-of-total percent for each stage", () => {
    // 4 items: 1 idea, 1 planned, 1 in_progress, 1 done → all 25%
    const items: RoadmapItem[] = [
      makeItem({ id: "1", status: "idea" }),
      makeItem({ id: "2", status: "planned" }),
      makeItem({ id: "3", status: "in_progress" }),
      makeItem({ id: "4", status: "done" }),
    ];
    render(<PipelineFunnel items={items} />);
    const pcts = screen.getAllByText(/25%/);
    expect(pcts.length).toBeGreaterThanOrEqual(4);
  });

  it("does NOT render fake conversion-between-stages percentages", () => {
    // Conversion-between-stage math is meaningless on a snapshot; ensure
    // the old "↳ X%" element is gone.
    const items: RoadmapItem[] = [
      ...Array.from({ length: 10 }, (_, i) =>
        makeItem({ id: `idea-${i}`, status: "idea" }),
      ),
      makeItem({ id: "dn-1", status: "done" }),
    ];
    const { container } = render(<PipelineFunnel items={items} />);
    expect(
      container.querySelectorAll('[data-testid="pipeline-conversion"]'),
    ).toHaveLength(0);
  });

  it("renders an honest insight describing where the work currently sits", () => {
    // 7 of 10 items are 'idea' → dominant share 70%
    const items: RoadmapItem[] = [
      ...Array.from({ length: 7 }, (_, i) =>
        makeItem({ id: `idea-${i}`, status: "idea" }),
      ),
      makeItem({ id: "pl-1", status: "planned" }),
      makeItem({ id: "ip-1", status: "in_progress" }),
      makeItem({ id: "dn-1", status: "done" }),
    ];
    const { container } = render(<PipelineFunnel items={items} />);
    const insight = container.querySelector<HTMLElement>(
      '[data-testid="pipeline-insight"]',
    );
    expect(insight).toBeTruthy();
    expect(insight?.textContent).toContain("70%");
    expect(insight?.textContent).toContain("idea");
  });

  it("renders empty state when no items", () => {
    render(<PipelineFunnel items={[]} />);
    expect(screen.getByRole("heading", { name: /Pipeline/i })).toBeInTheDocument();
  });
});
