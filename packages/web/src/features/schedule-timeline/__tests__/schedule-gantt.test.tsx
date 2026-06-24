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
    useProjectScheduleTimeline: (key: string) =>
      mockUseProjectScheduleTimeline(key),
  };
});

// KAN-105 PR3: mock useUpsertPlanMutation so ScheduleGantt renders without a QueryClient
vi.mock("../use-upsert-plan-mutation", () => ({
  useUpsertPlanMutation: () => ({ mutate: vi.fn() }),
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
