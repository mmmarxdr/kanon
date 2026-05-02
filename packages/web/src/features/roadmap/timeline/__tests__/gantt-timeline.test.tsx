import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { RoadmapItem, RoadmapDependency } from "@/types/roadmap";
import { GanttTimeline } from "../gantt-timeline";

// jsdom doesn't have ResizeObserver — a no-op mock is enough because the
// hook also reads getBoundingClientRect on mount; we make that report a
// realistic width below so the canvas renders bars synchronously.
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  const rect = realGetBoundingClientRect.call(this);
  return {
    ...rect,
    width: rect.width || 1200,
    height: rect.height || 600,
  } as DOMRect;
};

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

beforeEach(() => {
  mockSetSelectedItemId.mockClear();
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
    createdAt: "2026-04-26T00:00:00Z",
    updatedAt: "2026-04-26T00:00:00Z",
    effort: 3,
    impact: 5,
    ...overrides,
  };
}

describe("GanttTimeline — empty state", () => {
  it("shows empty state when no items", () => {
    render(<GanttTimeline items={[]} />);
    expect(screen.getByText("No roadmap items yet")).toBeInTheDocument();
  });
});

describe("GanttTimeline — sticky header", () => {
  it("renders quarter labels in the top header row", () => {
    const items = [makeItem({ id: "1", title: "Alpha" })];
    render(<GanttTimeline items={items} />);
    expect(screen.getByText(/Q2\s*·\s*2026/)).toBeInTheDocument();
    expect(screen.getByText(/Q3\s*·\s*2026/)).toBeInTheDocument();
    expect(screen.getByText(/Q4\s*·\s*2026/)).toBeInTheDocument();
    expect(screen.getByText(/Q1\s*·\s*2027/)).toBeInTheDocument();
  });

  it("renders month labels in the bottom header row", () => {
    const items = [makeItem({ id: "1", title: "Alpha" })];
    render(<GanttTimeline items={items} />);
    expect(screen.getByText("Apr")).toBeInTheDocument();
    expect(screen.getByText("May")).toBeInTheDocument();
    expect(screen.getByText("Dec")).toBeInTheDocument();
  });

  it("renders a 'Track' label in the left fixed column", () => {
    const items = [makeItem({ id: "1", title: "Alpha" })];
    render(<GanttTimeline items={items} />);
    expect(screen.getByText(/^Track$/i)).toBeInTheDocument();
  });

  it("makes the header sticky with position:sticky", () => {
    const items = [makeItem({ id: "1", title: "Alpha" })];
    const { container } = render(<GanttTimeline items={items} />);
    const header = container.querySelector(
      "[data-testid='timeline-header']",
    ) as HTMLElement | null;
    expect(header).toBeTruthy();
    expect(header?.style.position).toBe("sticky");
  });
});

describe("GanttTimeline — today line", () => {
  it("renders a today indicator line", () => {
    const items = [makeItem({ id: "1", title: "Alpha" })];
    const { container } = render(<GanttTimeline items={items} />);
    expect(
      container.querySelector("[data-testid='timeline-today-line']"),
    ).toBeTruthy();
  });

  it("renders a 'now · w0' label next to the today line", () => {
    const items = [makeItem({ id: "1", title: "Alpha" })];
    render(<GanttTimeline items={items} />);
    expect(screen.getByText(/now\s*·\s*w0/)).toBeInTheDocument();
  });
});

describe("GanttTimeline — month grid", () => {
  it("renders month grid lines (one per month boundary except the first)", () => {
    const items = [makeItem({ id: "1", title: "Alpha" })];
    const { container } = render(<GanttTimeline items={items} />);
    const grids = container.querySelectorAll(
      "[data-testid='timeline-month-grid']",
    );
    // 9 months → 8 interior grid lines
    expect(grids.length).toBe(8);
  });
});

describe("GanttTimeline — legend", () => {
  it("renders 4 legend entries with their labels", () => {
    const items = [makeItem({ id: "1", title: "Alpha" })];
    render(<GanttTimeline items={items} />);
    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Planned")).toBeInTheDocument();
    expect(screen.getByText("Done")).toBeInTheDocument();
    expect(screen.getByText("Idea")).toBeInTheDocument();
  });

  it("renders 4 legend swatches", () => {
    const items = [makeItem({ id: "1", title: "Alpha" })];
    const { container } = render(<GanttTimeline items={items} />);
    const swatches = container.querySelectorAll(
      "[data-testid='legend-swatch']",
    );
    expect(swatches.length).toBe(4);
  });
});

describe("GanttTimeline — grouped rows", () => {
  it("renders a group header per non-empty horizon", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha" }),
      makeItem({ id: "2", horizon: "later", title: "Beta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const headers = container.querySelectorAll(
      "[data-testid='timeline-group-header']",
    );
    expect(headers.length).toBe(2);
    // Group titles ("Now", "Later") appear as group header text
    const headerTexts = Array.from(headers).map((h) => h.textContent ?? "");
    expect(headerTexts.some((t) => t.includes("Now"))).toBe(true);
    expect(headerTexts.some((t) => t.includes("Later"))).toBe(true);
  });

  it("does not render group headers for empty horizons", () => {
    const items = [makeItem({ id: "1", horizon: "now", title: "Alpha" })];
    const { container } = render(<GanttTimeline items={items} />);
    const headers = container.querySelectorAll(
      "[data-testid='timeline-group-header']",
    );
    expect(headers.length).toBe(1);
  });

  it("renders one bar per item with the correct status data attribute", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha", status: "in_progress" }),
      makeItem({ id: "2", horizon: "now", title: "Beta", status: "done" }),
      makeItem({ id: "3", horizon: "later", title: "Gamma", status: "idea" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const bars = container.querySelectorAll("[data-testid='timeline-bar']");
    expect(bars.length).toBe(3);

    const statuses = Array.from(bars).map((b) => b.getAttribute("data-status"));
    expect(statuses).toContain("in_progress");
    expect(statuses).toContain("done");
    expect(statuses).toContain("idea");
  });
});

describe("GanttTimeline — sparse hint", () => {
  it("shows encouraging hint when fewer than 3 items", () => {
    render(<GanttTimeline items={[makeItem({ id: "1" })]} />);
    expect(
      screen.getByText("Add more items to see a richer timeline view."),
    ).toBeInTheDocument();
  });

  it("does not show the hint when 3+ items are present", () => {
    const items = [
      makeItem({ id: "1", title: "One" }),
      makeItem({ id: "2", title: "Two" }),
      makeItem({ id: "3", title: "Three" }),
    ];
    render(<GanttTimeline items={items} />);
    expect(
      screen.queryByText("Add more items to see a richer timeline view."),
    ).not.toBeInTheDocument();
  });
});

// ─── KAN-31 — group by toggle + counter strip ──────────────────────────

const GROUP_BY_STORAGE_KEY = "kanon.timeline.groupBy";

describe("GanttTimeline — group by toggle (KAN-31)", () => {
  beforeEach(() => {
    try {
      window.localStorage.removeItem(GROUP_BY_STORAGE_KEY);
    } catch {
      // ignore
    }
  });

  it("renders the group-by segmented control with Horizon and Owner options", () => {
    const items = [makeItem({ id: "1", horizon: "now" })];
    render(<GanttTimeline items={items} />);
    expect(screen.getByText(/group by/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Horizon" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Owner" })).toBeInTheDocument();
  });

  it("groups by horizon by default", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha" }),
      makeItem({ id: "2", horizon: "later", title: "Beta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const headers = container.querySelectorAll(
      "[data-testid='timeline-group-header']",
    );
    const headerTexts = Array.from(headers).map((h) => h.textContent ?? "");
    expect(headerTexts.some((t) => t.includes("Now"))).toBe(true);
    expect(headerTexts.some((t) => t.includes("Later"))).toBe(true);
  });

  it("switching to 'Owner' renders an Unassigned group when no owners are present", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha" }),
      makeItem({ id: "2", horizon: "later", title: "Beta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Owner" }));
    const headers = container.querySelectorAll(
      "[data-testid='timeline-group-header']",
    );
    expect(headers.length).toBe(1);
    expect(headers[0]?.textContent ?? "").toMatch(/Unassigned/i);
  });

  it("persists the chosen groupBy to localStorage", () => {
    const items = [makeItem({ id: "1", horizon: "now" })];
    render(<GanttTimeline items={items} />);
    fireEvent.click(screen.getByRole("button", { name: "Owner" }));
    expect(window.localStorage.getItem(GROUP_BY_STORAGE_KEY)).toBe("owner");
  });

  it("hydrates groupBy from localStorage on mount", () => {
    window.localStorage.setItem(GROUP_BY_STORAGE_KEY, "owner");
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha" }),
      makeItem({ id: "2", horizon: "later", title: "Beta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const headers = container.querySelectorAll(
      "[data-testid='timeline-group-header']",
    );
    expect(headers.length).toBe(1);
    expect(headers[0]?.textContent ?? "").toMatch(/Unassigned/i);
  });
});

describe("GanttTimeline — counter strip (KAN-31)", () => {
  it("shows item / edge / month counts in the toolbar", () => {
    const dep: RoadmapDependency = {
      id: "d-1",
      type: "blocks",
      sourceId: "1",
      targetId: "2",
      createdAt: "2026-04-26T00:00:00Z",
    };
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha", blocks: [dep] }),
      makeItem({ id: "2", horizon: "next", title: "Beta" }),
    ];
    render(<GanttTimeline items={items} />);
    const counter = screen.getByTestId("timeline-counter");
    expect(counter.textContent ?? "").toMatch(/2\s*items/);
    expect(counter.textContent ?? "").toMatch(/1\s*edges/);
    expect(counter.textContent ?? "").toMatch(/9\s*months/);
  });

  it("shows zero edges when items have no blocks", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha" }),
      makeItem({ id: "2", horizon: "next", title: "Beta" }),
    ];
    render(<GanttTimeline items={items} />);
    const counter = screen.getByTestId("timeline-counter");
    expect(counter.textContent ?? "").toMatch(/0\s*edges/);
  });
});

// ─── KAN-32 — dependency edges ─────────────────────────────────────────

describe("GanttTimeline — dependency edges (KAN-32)", () => {
  function dep(sourceId: string, targetId: string): RoadmapDependency {
    return {
      id: `d-${sourceId}-${targetId}`,
      type: "blocks",
      sourceId,
      targetId,
      createdAt: "2026-04-26T00:00:00Z",
    };
  }

  it("renders an SVG overlay with arrow markers", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha", blocks: [dep("1", "2")] }),
      makeItem({ id: "2", horizon: "next", title: "Beta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const overlay = container.querySelector(
      "[data-testid='timeline-edges-overlay']",
    );
    expect(overlay).toBeTruthy();
    expect(overlay?.querySelector("marker#kanonArrow")).toBeTruthy();
    expect(overlay?.querySelector("marker#kanonArrowMuted")).toBeTruthy();
  });

  it("hides edges by default and renders them only on hover", () => {
    const items = [
      makeItem({
        id: "1",
        horizon: "now",
        title: "Alpha",
        blocks: [dep("1", "2"), dep("1", "3")],
      }),
      makeItem({ id: "2", horizon: "next", title: "Beta" }),
      makeItem({ id: "3", horizon: "later", title: "Gamma" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const overlay = container.querySelector(
      "[data-testid='timeline-edges-overlay']",
    ) as SVGElement | null;
    expect(overlay).toBeTruthy();
    // No bar hovered → no edge paths visible (less visual noise).
    expect(
      overlay!.querySelectorAll("path[data-testid='timeline-edge']").length,
    ).toBe(0);

    // Hover Alpha → both of its outgoing edges become visible.
    const alphaBar = container.querySelector(
      "[data-testid='timeline-bar'][data-id='1']",
    ) as HTMLElement | null;
    fireEvent.mouseEnter(alphaBar!);
    expect(
      overlay!.querySelectorAll("path[data-testid='timeline-edge']").length,
    ).toBe(2);
  });

  it("ignores edges whose target is not in the items list", () => {
    const items = [
      makeItem({
        id: "1",
        horizon: "now",
        title: "Alpha",
        blocks: [dep("1", "missing")],
      }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const overlay = container.querySelector(
      "[data-testid='timeline-edges-overlay']",
    ) as SVGElement | null;
    const paths = overlay?.querySelectorAll("path[data-testid='timeline-edge']");
    expect(paths?.length ?? 0).toBe(0);
  });

  it("svg overlay does not block pointer events", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha", blocks: [dep("1", "2")] }),
      makeItem({ id: "2", horizon: "next", title: "Beta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const overlay = container.querySelector(
      "[data-testid='timeline-edges-overlay']",
    ) as SVGElement | null;
    expect(overlay).toBeTruthy();
    expect((overlay as unknown as HTMLElement).style.pointerEvents).toBe("none");
  });

  it("renders only the edges connected to the hovered item, hiding unrelated ones", () => {
    const items = [
      makeItem({
        id: "1",
        horizon: "now",
        title: "Alpha",
        blocks: [dep("1", "2")],
      }),
      makeItem({
        id: "2",
        horizon: "next",
        title: "Beta",
      }),
      makeItem({
        id: "3",
        horizon: "later",
        title: "Gamma",
        blocks: [dep("3", "4")],
      }),
      makeItem({ id: "4", horizon: "someday", title: "Delta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);

    // Hover the 'Alpha' bar → edge 3→4 is unrelated and should NOT render.
    const alphaBar = container.querySelector(
      "[data-testid='timeline-bar'][data-id='1']",
    ) as HTMLElement | null;
    expect(alphaBar).toBeTruthy();
    fireEvent.mouseEnter(alphaBar!);

    const overlay = container.querySelector(
      "[data-testid='timeline-edges-overlay']",
    ) as SVGElement | null;
    const edges = overlay!.querySelectorAll<SVGElement>(
      "[data-testid='timeline-edge-group']",
    );
    // Only the 1→2 edge is rendered while Alpha is hovered.
    expect(edges.length).toBe(1);
    expect(edges[0]?.getAttribute("data-related")).toBe("true");
  });
});

// ─── KAN-33 — bar hover glow ───────────────────────────────────────────

describe("GanttTimeline — bar hover glow (KAN-33)", () => {
  it("applies a glow boxShadow to the hovered bar", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha" }),
      makeItem({ id: "2", horizon: "next", title: "Beta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const bar = container.querySelector(
      "[data-testid='timeline-bar'][data-id='1']",
    ) as HTMLElement | null;
    expect(bar).toBeTruthy();
    fireEvent.mouseEnter(bar!);
    expect(bar!.style.boxShadow).toMatch(/var\(--accent\)/);
  });

  it("dims non-hovered bars to 0.4 opacity while hovering", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha" }),
      makeItem({ id: "2", horizon: "next", title: "Beta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const alpha = container.querySelector(
      "[data-testid='timeline-bar'][data-id='1']",
    ) as HTMLElement | null;
    const beta = container.querySelector(
      "[data-testid='timeline-bar'][data-id='2']",
    ) as HTMLElement | null;
    fireEvent.mouseEnter(alpha!);
    expect(beta!.style.opacity).toBe("0.4");
    expect(alpha!.style.opacity).not.toBe("0.4");
  });

  it("clears hover styling when the mouse leaves the bar", () => {
    const items = [
      makeItem({ id: "1", horizon: "now", title: "Alpha" }),
      makeItem({ id: "2", horizon: "next", title: "Beta" }),
    ];
    const { container } = render(<GanttTimeline items={items} />);
    const alpha = container.querySelector(
      "[data-testid='timeline-bar'][data-id='1']",
    ) as HTMLElement | null;
    const beta = container.querySelector(
      "[data-testid='timeline-bar'][data-id='2']",
    ) as HTMLElement | null;
    fireEvent.mouseEnter(alpha!);
    fireEvent.mouseLeave(alpha!);
    expect(beta!.style.opacity).not.toBe("0.4");
    expect(alpha!.style.boxShadow === "" || alpha!.style.boxShadow === "none").toBe(
      true,
    );
  });
});
