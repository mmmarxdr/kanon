/**
 * KAN-105 PR2 — Unit tests for ThreePlaneRow.
 * RED phase: these tests fail until three-plane-row.tsx is implemented.
 */

import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { ScheduleTimelineRow } from "../use-project-schedule-timeline";
import { ThreePlaneRow } from "../three-plane-row";
import { computeDomain } from "../timeline-scale";

// ── Fixture ──────────────────────────────────────────────────────────────────

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
    deps: [],
    cycleId: null,
    cycleName: null,
    isNeighbor: false,
    ...overrides,
  };
}

function makeDomain(row: ScheduleTimelineRow) {
  return computeDomain([row]);
}

const TRACK_W = 1200;

// ── All three planes present ─────────────────────────────────────────────────

describe("ThreePlaneRow — all planes present", () => {
  it("renders the baseline ghost plane", () => {
    const row = makeRow();
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='plane-baseline']")).toBeTruthy();
  });

  it("renders the plan bar plane", () => {
    const row = makeRow();
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='plane-plan']")).toBeTruthy();
  });

  it("renders the forecast overlay plane", () => {
    const row = makeRow();
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='plane-forecast']")).toBeTruthy();
  });
});

// ── Null dates graceful handling ─────────────────────────────────────────────

describe("ThreePlaneRow — null dates don't crash", () => {
  it("skips baseline plane when baselineStart/End are null", () => {
    const row = makeRow({ baselineStart: null, baselineEnd: null });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='plane-baseline']")).toBeNull();
    // Plan and forecast still render
    expect(container.querySelector("[data-testid='plane-plan']")).toBeTruthy();
    expect(container.querySelector("[data-testid='plane-forecast']")).toBeTruthy();
  });

  it("skips plan plane when startDate/dueDate are null", () => {
    const row = makeRow({ startDate: null, dueDate: null });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='plane-plan']")).toBeNull();
  });

  it("skips forecast plane when forecastStart/End are null", () => {
    const row = makeRow({ forecastStart: null, forecastEnd: null });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='plane-forecast']")).toBeNull();
  });

  it("renders without crashing when all date fields are null", () => {
    const row = makeRow({
      startDate: null,
      dueDate: null,
      baselineStart: null,
      baselineEnd: null,
      forecastStart: null,
      forecastEnd: null,
    });
    const domain = computeDomain([row]); // uses fallback domain
    expect(() =>
      render(
        <ThreePlaneRow row={row} domain={domain} trackWidth={TRACK_W} />,
      ),
    ).not.toThrow();
  });
});

// ── Slip gap ─────────────────────────────────────────────────────────────────

describe("ThreePlaneRow — slip gap", () => {
  it("renders slip-gap when forecastEnd > dueDate", () => {
    const row = makeRow({
      dueDate: "2026-05-01T00:00:00Z",
      forecastEnd: "2026-05-15T00:00:00Z", // 14 days slip
    });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='slip-gap']")).toBeTruthy();
  });

  it("does NOT render slip-gap when forecastEnd === dueDate", () => {
    const row = makeRow({
      dueDate: "2026-05-01T00:00:00Z",
      forecastEnd: "2026-05-01T00:00:00Z",
    });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='slip-gap']")).toBeNull();
  });

  it("does NOT render slip-gap when forecastEnd < dueDate (ahead of schedule)", () => {
    const row = makeRow({
      dueDate: "2026-05-15T00:00:00Z",
      forecastEnd: "2026-05-01T00:00:00Z", // finishing early
    });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='slip-gap']")).toBeNull();
  });

  it("does NOT render slip-gap when dueDate is null", () => {
    const row = makeRow({
      dueDate: null,
      forecastEnd: "2026-05-15T00:00:00Z",
    });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='slip-gap']")).toBeNull();
  });

  it("does NOT render slip-gap when forecastEnd is null", () => {
    const row = makeRow({
      dueDate: "2026-05-15T00:00:00Z",
      forecastEnd: null,
    });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-testid='slip-gap']")).toBeNull();
  });
});

// ── Slip gap — accessibility ──────────────────────────────────────────────────

describe("ThreePlaneRow — slip gap accessibility", () => {
  it("slip-gap element has an aria-label describing the slip when slipping", () => {
    const row = makeRow({
      dueDate: "2026-05-01T00:00:00Z",
      forecastEnd: "2026-05-15T00:00:00Z",
      slipDays: 14,
    });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    const el = container.querySelector("[data-testid='slip-gap']");
    expect(el).toBeTruthy();
    expect(el?.getAttribute("aria-label")).toMatch(/14 day/i);
  });

  it("slip-gap element has an accessible label when slipping", () => {
    const row = makeRow({
      dueDate: "2026-05-01T00:00:00Z",
      forecastEnd: "2026-05-15T00:00:00Z",
      slipDays: 14,
    });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    const el = container.querySelector("[data-testid='slip-gap']");
    expect(el?.getAttribute("aria-label")).toMatch(/14 day/i);
  });
});

// ── Critical flag ─────────────────────────────────────────────────────────────

describe("ThreePlaneRow — critical flag", () => {
  it("sets data-critical='true' on the plan bar when critical is true", () => {
    const row = makeRow({ critical: true });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    const el = container.querySelector("[data-critical='true']");
    expect(el).toBeTruthy();
  });

  it("does NOT set data-critical='true' when critical is false", () => {
    const row = makeRow({ critical: false });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-critical='true']")).toBeNull();
  });

  it("does NOT set data-critical='true' when critical is null", () => {
    const row = makeRow({ critical: null });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(container.querySelector("[data-critical='true']")).toBeNull();
  });

  it("plan bar has aria-label 'Critical path issue' when critical is true", () => {
    const row = makeRow({ critical: true });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    const el = container.querySelector("[data-critical='true']");
    expect(el?.getAttribute("aria-label")).toBe("Critical path issue");
  });
});

// ── Critical-path coloring (KAN-150) ───────────────────────────────────────────

describe("ThreePlaneRow — critical-path coloring (KAN-150)", () => {
  it("critical plan bar is colored red (var(--bad)) for fill and border", () => {
    const row = makeRow({ critical: true });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    const style = container.querySelector("[data-testid='plane-plan']")?.getAttribute("style") ?? "";
    expect(style).toContain("var(--bad)");
  });

  it("near-critical (low positive floatDays) is amber, not red, with data-near-critical", () => {
    const row = makeRow({ critical: false, floatDays: 2 });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    const el = container.querySelector("[data-testid='plane-plan']");
    expect(el?.getAttribute("data-near-critical")).toBe("true");
    expect(el?.getAttribute("data-critical")).toBeNull();
    const style = el?.getAttribute("style") ?? "";
    expect(style).toContain("var(--warn)");
    expect(style).not.toContain("var(--bad)");
    expect(el?.getAttribute("aria-label")).toBe("Near-critical issue (low schedule float)");
  });

  it("at the near-critical threshold (floatDays=3) the bar is still amber", () => {
    const row = makeRow({ critical: false, floatDays: 3 });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(
      container.querySelector("[data-testid='plane-plan']")?.getAttribute("data-near-critical"),
    ).toBe("true");
  });

  it("comfortable float (floatDays=5) is neither critical nor near-critical", () => {
    const row = makeRow({ critical: false, floatDays: 5 });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    const el = container.querySelector("[data-testid='plane-plan']");
    expect(el?.getAttribute("data-critical")).toBeNull();
    expect(el?.getAttribute("data-near-critical")).toBeNull();
  });

  it("null floatDays is not near-critical", () => {
    const row = makeRow({ critical: false, floatDays: null });
    const { container } = render(
      <ThreePlaneRow row={row} domain={makeDomain(row)} trackWidth={TRACK_W} />,
    );
    expect(
      container.querySelector("[data-testid='plane-plan']")?.getAttribute("data-near-critical"),
    ).toBeNull();
  });
});
