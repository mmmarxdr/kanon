/**
 * KAN-105 PR2 — Integration tests for ScheduleGantt container.
 * RED phase: fail until schedule-gantt.tsx is implemented.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import type { ScheduleTimelineRow } from "../use-project-schedule-timeline";

// ── ResizeObserver + getBoundingClientRect mocks (mirror gantt-timeline.test.tsx) ──

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;

const realGetBoundingClientRect = Element.prototype.getBoundingClientRect;
Element.prototype.getBoundingClientRect = function () {
  const rect = realGetBoundingClientRect.call(this);
  return { ...rect, width: rect.width || 1200, height: rect.height || 600 } as DOMRect;
};

// ── Mock the hooks ───────────────────────────────────────────────────────────

const mockUseProjectScheduleTimeline = vi.fn();

vi.mock("../use-project-schedule-timeline", async () => {
  const actual = await vi.importActual<
    typeof import("../use-project-schedule-timeline")
  >("../use-project-schedule-timeline");
  return {
    ...actual,
    // KAN-153: the hook now returns an envelope { rows, total, truncated }.
    // Tests still set `data` as a bare row array for brevity — normalize here so
    // both shapes work.
    useProjectScheduleTimeline: (key: string) => {
      const r = mockUseProjectScheduleTimeline(key);
      if (r && Array.isArray(r.data)) {
        return { ...r, data: { rows: r.data, total: r.data.length, truncated: false } };
      }
      return r;
    },
  };
});

// KAN-105 PR3: mock useUpsertPlanMutation so ScheduleGantt renders without a QueryClient
vi.mock("../use-upsert-plan-mutation", () => ({
  useUpsertPlanMutation: () => ({ mutate: vi.fn() }),
}));

// KAN-153: the Gantt fetches the cycle list for its scope dropdown.
vi.mock("@/features/cycles/use-cycles-query", () => ({
  useCyclesQuery: () => ({ data: [] }),
}));

// ── Import AFTER mocks ───────────────────────────────────────────────────────

import { ScheduleGantt } from "../schedule-gantt";

// ── Fixtures ─────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ScheduleTimelineRow> = {}): ScheduleTimelineRow {
  return {
    issueId: "id-1",
    issueKey: "TST-1",
    title: "Default issue",
    state: "in_progress",
    type: "issue",
    cycleId: null,
    cycleName: null,
    isNeighbor: false,
    startDate: "2026-03-01T00:00:00Z",
    dueDate: "2026-05-01T00:00:00Z",
    progress: 40,
    baselineStart: "2026-02-15T00:00:00Z",
    baselineEnd: "2026-04-15T00:00:00Z",
    forecastStart: "2026-03-05T00:00:00Z",
    forecastEnd: "2026-05-10T00:00:00Z",
    slipDays: 9,
    critical: false,
    floatDays: 5,
    deps: [],
    ...overrides,
  };
}

beforeEach(() => {
  mockUseProjectScheduleTimeline.mockReset();
});

// ── Loading state ────────────────────────────────────────────────────────────

describe("ScheduleGantt — loading state", () => {
  it("renders a loading indicator while data is in-flight", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: undefined,
      isLoading: true,
      isError: false,
    });
    render(<ScheduleGantt projectKey="TST" />);
    expect(screen.getByTestId("schedule-gantt-loading")).toBeTruthy();
  });
});

// ── Error state ──────────────────────────────────────────────────────────────

describe("ScheduleGantt — error state", () => {
  it("renders an error message on query failure", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: undefined,
      isLoading: false,
      isError: true,
      error: new Error("Network error"),
    });
    render(<ScheduleGantt projectKey="TST" />);
    expect(screen.getByTestId("schedule-gantt-error")).toBeTruthy();
  });
});

// ── Empty state ──────────────────────────────────────────────────────────────

describe("ScheduleGantt — empty state", () => {
  it("renders a friendly empty state when data is []", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<ScheduleGantt projectKey="TST" />);
    expect(screen.getByTestId("schedule-gantt-empty")).toBeTruthy();
  });
});

// ── Data rendering ───────────────────────────────────────────────────────────

describe("ScheduleGantt — data rendering", () => {
  it("renders data-testid='schedule-gantt' root element", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow()],
      isLoading: false,
      isError: false,
    });
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    expect(container.querySelector("[data-testid='schedule-gantt']")).toBeTruthy();
  });

  it("renders one row per data item", () => {
    const rows = [
      makeRow({ issueId: "id-1", issueKey: "TST-1" }),
      makeRow({ issueId: "id-2", issueKey: "TST-2", title: "Second issue" }),
      makeRow({ issueId: "id-3", issueKey: "TST-3", title: "Third issue" }),
    ];
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: rows,
      isLoading: false,
      isError: false,
    });
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    const issueRows = container.querySelectorAll("[data-testid='gantt-issue-row']");
    expect(issueRows.length).toBe(3);
  });

  it("renders issueKey labels in the gutter", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow({ issueKey: "ABC-42" })],
      isLoading: false,
      isError: false,
    });
    render(<ScheduleGantt projectKey="TST" />);
    expect(screen.getByText("ABC-42")).toBeTruthy();
  });

  it("renders a month axis header", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow()],
      isLoading: false,
      isError: false,
    });
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    expect(container.querySelector("[data-testid='schedule-gantt-header']")).toBeTruthy();
  });

  it("renders a today line", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow()],
      isLoading: false,
      isError: false,
    });
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    expect(
      container.querySelector("[data-testid='schedule-gantt-today']"),
    ).toBeTruthy();
  });

  it("renders a legend block", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow()],
      isLoading: false,
      isError: false,
    });
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    expect(
      container.querySelector("[data-testid='schedule-gantt-legend']"),
    ).toBeTruthy();
  });
});

// ── Scroll-to-today (KAN-151) ──────────────────────────────────────────────────

describe("ScheduleGantt — scroll to today (KAN-151)", () => {
  it("renders a Today control", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow()],
      isLoading: false,
      isError: false,
    });
    render(<ScheduleGantt projectKey="TST" />);
    expect(screen.getByTestId("schedule-gantt-today-btn")).toBeTruthy();
  });

  it("clicking Today re-centers the scroll container on the today line", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow()],
      isLoading: false,
      isError: false,
    });
    render(<ScheduleGantt projectKey="TST" />);
    const scroll = screen.getByTestId("schedule-gantt-scroll");
    // today (2026-06-24) is past the fixture's domain → ratio clamps to 1 → target > 0
    expect(() => fireEvent.click(screen.getByTestId("schedule-gantt-today-btn"))).not.toThrow();
    expect(scroll.scrollLeft).toBeGreaterThan(0);
  });
});

// ── Timescale zoom (KAN-148) ───────────────────────────────────────────────────

function canvasWidthPx(container: HTMLElement): number {
  const el = container.querySelector<HTMLElement>("[data-testid='schedule-gantt-canvas']");
  return parseFloat(el?.style.width ?? "0");
}

describe("ScheduleGantt — timescale zoom (KAN-148)", () => {
  beforeEach(() => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow()],
      isLoading: false,
      isError: false,
    });
  });

  it("renders zoom controls with Fit active by default", () => {
    render(<ScheduleGantt projectKey="TST" />);
    expect(screen.getByTestId("schedule-gantt-zoom")).toBeTruthy();
    expect(screen.getByTestId("schedule-gantt-zoom-fit").getAttribute("data-active")).toBe("true");
    expect(screen.getByTestId("schedule-gantt-zoom-day").getAttribute("data-active")).toBeNull();
  });

  it("zooming to Day widens the canvas beyond the fit width and scrolls horizontally", () => {
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    const fitWidth = canvasWidthPx(container);
    fireEvent.click(screen.getByTestId("schedule-gantt-zoom-day"));
    const dayWidth = canvasWidthPx(container);
    expect(dayWidth).toBeGreaterThan(fitWidth);
    expect(screen.getByTestId("schedule-gantt-zoom-day").getAttribute("data-active")).toBe("true");
  });

  it("returning to Fit collapses the canvas back to the viewport width", () => {
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    fireEvent.click(screen.getByTestId("schedule-gantt-zoom-day"));
    const dayWidth = canvasWidthPx(container);
    fireEvent.click(screen.getByTestId("schedule-gantt-zoom-fit"));
    const fitWidth = canvasWidthPx(container);
    expect(fitWidth).toBeLessThan(dayWidth);
    // ...but never collapses below the canvas floor.
    expect(fitWidth).toBeGreaterThanOrEqual(1100);
  });
});

// ── Dependency arrows (KAN-149) ─────────────────────────────────────────────────

describe("ScheduleGantt — dependency arrows (KAN-149)", () => {
  it("renders no dependency overlay when there are no edges", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow()],
      isLoading: false,
      isError: false,
    });
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    expect(container.querySelector("[data-testid='schedule-gantt-deps']")).toBeNull();
  });

  it("draws one arrow per outgoing dependency edge", () => {
    const rows = [
      makeRow({
        issueId: "id-1",
        issueKey: "A-1",
        deps: [{ targetIssueId: "id-2", type: "FS", lagDays: 0 }],
      }),
      makeRow({ issueId: "id-2", issueKey: "A-2", title: "Second" }),
    ];
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: rows,
      isLoading: false,
      isError: false,
    });
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    const edges = container.querySelectorAll("[data-testid='dep-edge']");
    expect(edges.length).toBe(1);
  });

  it("FS and SS edges anchor the source at different endpoints (end vs start)", () => {
    const edgeStartX = (type: "FS" | "SS") => {
      mockUseProjectScheduleTimeline.mockReturnValue({
        data: [
          makeRow({ issueId: "id-1", issueKey: "A-1", deps: [{ targetIssueId: "id-2", type, lagDays: 0 }] }),
          makeRow({ issueId: "id-2", issueKey: "A-2" }),
        ],
        isLoading: false,
        isError: false,
      });
      const { container } = render(<ScheduleGantt projectKey="TST" />);
      const d = container.querySelector("[data-testid='dep-edge']")!.getAttribute("d")!;
      return parseFloat(d.split(" ")[1]!); // M <x1> <y1> ...
    };
    // FS starts at the source bar's right edge, SS at its left edge → FS x is larger.
    expect(edgeStartX("FS")).toBeGreaterThan(edgeStartX("SS"));
  });

  it("colors an edge between two critical issues as critical", () => {
    const rows = [
      makeRow({
        issueId: "id-1",
        issueKey: "A-1",
        critical: true,
        deps: [{ targetIssueId: "id-2", type: "FS", lagDays: 0 }],
      }),
      makeRow({ issueId: "id-2", issueKey: "A-2", critical: true }),
    ];
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: rows,
      isLoading: false,
      isError: false,
    });
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    const edge = container.querySelector("[data-testid='dep-edge']");
    expect(edge?.getAttribute("data-critical")).toBe("true");
  });

  it("skips edges whose target is absent from the data", () => {
    const rows = [
      makeRow({
        issueId: "id-1",
        issueKey: "A-1",
        deps: [{ targetIssueId: "ghost", type: "FS", lagDays: 0 }],
      }),
    ];
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: rows,
      isLoading: false,
      isError: false,
    });
    const { container } = render(<ScheduleGantt projectKey="TST" />);
    expect(container.querySelector("[data-testid='schedule-gantt-deps']")).toBeNull();
  });
});

// ── Hook wiring ──────────────────────────────────────────────────────────────

describe("ScheduleGantt — hook wiring", () => {
  it("calls useProjectScheduleTimeline with the projectKey prop", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [],
      isLoading: false,
      isError: false,
    });
    render(<ScheduleGantt projectKey="MYPROJ" />);
    expect(mockUseProjectScheduleTimeline).toHaveBeenCalledWith("MYPROJ");
  });
});

// ── KAN-153: scope selector + neighbor rows ──────────────────────────────────

describe("ScheduleGantt — scope + neighbors (KAN-153)", () => {
  it("scope selector offers the default scopes", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [makeRow()],
      isLoading: false,
      isError: false,
    });
    render(<ScheduleGantt projectKey="TST" />);
    const labels = Array.from(
      screen.getByTestId("schedule-gantt-scope").querySelectorAll("option"),
    ).map((o) => o.textContent);
    expect(labels).toContain("Active cycle");
    expect(labels).toContain("Around today");
  });

  it("shows 'N of M' when neighbor rows pad the scoped result", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [
        makeRow({ issueId: "a", issueKey: "A-1" }),
        makeRow({ issueId: "b", issueKey: "A-2", isNeighbor: true }),
      ],
      isLoading: false,
      isError: false,
    });
    render(<ScheduleGantt projectKey="TST" />);
    // shown (non-neighbor) = 1, total = 2 → "1 of 2"
    expect(screen.getByTestId("schedule-gantt-count").textContent).toContain("1 of 2");
  });

  it("renders a neighbor row, muted, with a context tag", () => {
    mockUseProjectScheduleTimeline.mockReturnValue({
      data: [
        makeRow({ issueId: "a", issueKey: "A-1" }),
        makeRow({ issueId: "b", issueKey: "A-2", isNeighbor: true }),
      ],
      isLoading: false,
      isError: false,
    });
    render(<ScheduleGantt projectKey="TST" />);
    expect(screen.getAllByTestId("gantt-issue-row")).toHaveLength(2);
    expect(screen.getByText("ctx")).toBeTruthy();
  });
});
