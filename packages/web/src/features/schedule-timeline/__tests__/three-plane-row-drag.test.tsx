/**
 * KAN-105 PR3 — Drag interaction tests for ThreePlaneRow.
 *
 * RED phase: tests written before drag implementation.
 *
 * Strategy:
 *   - Simulate pointerdown → pointermove → pointerup on the plan bar.
 *   - Verify onPlanChange is called with correctly shifted dates on drop.
 *   - Verify zero-delta drag does NOT call onPlanChange.
 *   - Verify null-plan row has no drag handlers / no data-draggable.
 *   - Verify baseline/forecast/slip remain non-interactive (pointerEvents none).
 *
 * The component receives an onPlanChange callback from the parent (ScheduleGantt)
 * so ThreePlaneRow stays presentational and testable without a QueryClient.
 */

import { describe, it, expect, vi } from "vitest";
import { render, fireEvent } from "@testing-library/react";
import type { ScheduleTimelineRow } from "../use-project-schedule-timeline";
import { ThreePlaneRow } from "../three-plane-row";
import { computeDomain, pixelToDate } from "../timeline-scale";

// ── Fixtures ──────────────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ScheduleTimelineRow> = {}): ScheduleTimelineRow {
  return {
    issueId: "id-1",
    issueKey: "TST-1",
    title: "Draggable issue",
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
    planVsBaseline: null,
    forecastVsBaseline: null,
    isNeighbor: false,
    ...overrides,
  };
}

const TRACK_W = 1200;

function makeDomain(row: ScheduleTimelineRow) {
  return computeDomain([row]);
}

// ── data-draggable attribute ──────────────────────────────────────────────────

describe("ThreePlaneRow — data-draggable attribute", () => {
  it("sets data-draggable='true' on the plan bar when startDate+dueDate are set", () => {
    const row = makeRow();
    const onPlanChange = vi.fn();
    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={makeDomain(row)}
        trackWidth={TRACK_W}
        onPlanChange={onPlanChange}
      />,
    );
    const plan = container.querySelector("[data-testid='plane-plan']");
    expect(plan?.getAttribute("data-draggable")).toBe("true");
  });

  it("does NOT set data-draggable when startDate is null (no plan)", () => {
    const row = makeRow({ startDate: null, dueDate: null });
    const onPlanChange = vi.fn();
    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={makeDomain(row)}
        trackWidth={TRACK_W}
        onPlanChange={onPlanChange}
      />,
    );
    // Plan bar itself should not render
    expect(container.querySelector("[data-testid='plane-plan']")).toBeNull();
  });
});

// ── Drag → onPlanChange called with shifted dates ─────────────────────────────

describe("ThreePlaneRow — drag shifts dates and calls onPlanChange", () => {
  it("calls onPlanChange with dates shifted by the drag delta in whole days", () => {
    const row = makeRow();
    const domain = makeDomain(row);
    const onPlanChange = vi.fn();

    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={domain}
        trackWidth={TRACK_W}
        onPlanChange={onPlanChange}
      />,
    );

    const plan = container.querySelector("[data-testid='plane-plan']") as HTMLElement;
    expect(plan).toBeTruthy();

    // Compute how many pixels correspond to 7 days in this domain
    const domainSpanMs = domain.max.getTime() - domain.min.getTime();
    const domainSpanDays = domainSpanMs / (1000 * 60 * 60 * 24);
    const pxPerDay = TRACK_W / domainSpanDays;
    const dragPx = Math.round(7 * pxPerDay); // drag 7 days worth of pixels

    // Simulate pointer drag
    fireEvent.pointerDown(plan, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(plan, { clientX: dragPx, pointerId: 1 });
    fireEvent.pointerUp(plan, { clientX: dragPx, pointerId: 1 });

    expect(onPlanChange).toHaveBeenCalledTimes(1);
    const call = onPlanChange.mock.calls[0]![0] as {
      issueKey: string;
      startDate: string;
      dueDate: string;
    };

    // issueKey must match
    expect(call.issueKey).toBe("TST-1");

    // Both dates should be shifted by exactly 7 days
    const originalStart = new Date("2026-03-01T00:00:00Z");
    const originalDue = new Date("2026-05-01T00:00:00Z");
    const expectedStart = new Date(originalStart.getTime() + 7 * 24 * 60 * 60 * 1000);
    const expectedDue = new Date(originalDue.getTime() + 7 * 24 * 60 * 60 * 1000);

    expect(call.startDate.slice(0, 10)).toBe(expectedStart.toISOString().slice(0, 10));
    expect(call.dueDate.slice(0, 10)).toBe(expectedDue.toISOString().slice(0, 10));
  });
});

// ── Zero-delta drag ───────────────────────────────────────────────────────────

describe("ThreePlaneRow — zero-delta drag does NOT call onPlanChange", () => {
  it("does NOT call onPlanChange when drag rounds to 0-day delta", () => {
    const row = makeRow();
    const onPlanChange = vi.fn();

    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={makeDomain(row)}
        trackWidth={TRACK_W}
        onPlanChange={onPlanChange}
      />,
    );

    const plan = container.querySelector("[data-testid='plane-plan']") as HTMLElement;

    // Drag just 1px — far less than a day's worth of pixels → rounds to 0 days
    fireEvent.pointerDown(plan, { clientX: 100, pointerId: 1 });
    fireEvent.pointerMove(plan, { clientX: 101, pointerId: 1 });
    fireEvent.pointerUp(plan, { clientX: 101, pointerId: 1 });

    expect(onPlanChange).not.toHaveBeenCalled();
  });
});

// ── Null plan — not draggable ─────────────────────────────────────────────────

describe("ThreePlaneRow — null plan row is not draggable", () => {
  it("does not render a plan bar when startDate/dueDate are null", () => {
    const row = makeRow({ startDate: null, dueDate: null });
    const onPlanChange = vi.fn();

    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={makeDomain(row)}
        trackWidth={TRACK_W}
        onPlanChange={onPlanChange}
      />,
    );

    expect(container.querySelector("[data-testid='plane-plan']")).toBeNull();
    expect(onPlanChange).not.toHaveBeenCalled();
  });
});

// ── pointercancel resets drag without writing ─────────────────────────────────

describe("ThreePlaneRow — pointercancel resets drag without calling onPlanChange", () => {
  it("fires pointercancel after a move → does NOT call onPlanChange and offset resets to 0", () => {
    const row = makeRow();
    const domain = makeDomain(row);
    const onPlanChange = vi.fn();

    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={domain}
        trackWidth={TRACK_W}
        onPlanChange={onPlanChange}
      />,
    );

    const plan = container.querySelector("[data-testid='plane-plan']") as HTMLElement;
    expect(plan).toBeTruthy();

    const domainSpanMs = domain.max.getTime() - domain.min.getTime();
    const domainSpanDays = domainSpanMs / (1000 * 60 * 60 * 24);
    const pxPerDay = TRACK_W / domainSpanDays;
    const dragPx = Math.round(7 * pxPerDay);

    fireEvent.pointerDown(plan, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(plan, { clientX: dragPx, pointerId: 1 });
    // Browser cancels the gesture (touch scroll, system gesture, etc.)
    fireEvent.pointerCancel(plan, { clientX: dragPx, pointerId: 1 });

    // Must NOT write anything
    expect(onPlanChange).not.toHaveBeenCalled();
    // Bar offset must have been reset: left should equal base (no dragOffsetPx)
    const baseLeft = parseFloat(plan.style.left);
    // After cancel the left should be back to what barBox computes (no offset)
    // We verify by re-rendering without drag and comparing
    const { container: freshContainer } = render(
      <ThreePlaneRow
        row={row}
        domain={domain}
        trackWidth={TRACK_W}
        onPlanChange={onPlanChange}
      />,
    );
    const freshPlan = freshContainer.querySelector("[data-testid='plane-plan']") as HTMLElement;
    expect(baseLeft).toBe(parseFloat(freshPlan.style.left));
  });
});

// ── UTC midnight snap ─────────────────────────────────────────────────────────

describe("ThreePlaneRow — drag output dates are snapped to UTC midnight", () => {
  it("emits T00:00:00.000Z dates even when row dates carry a non-midnight time", () => {
    const row = makeRow({
      startDate: "2026-03-01T14:00:00Z",
      dueDate: "2026-03-15T14:00:00Z",
    });
    const domain = makeDomain(row);
    const onPlanChange = vi.fn();

    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={domain}
        trackWidth={TRACK_W}
        onPlanChange={onPlanChange}
      />,
    );

    const plan = container.querySelector("[data-testid='plane-plan']") as HTMLElement;
    expect(plan).toBeTruthy();

    const domainSpanMs = domain.max.getTime() - domain.min.getTime();
    const domainSpanDays = domainSpanMs / (1000 * 60 * 60 * 24);
    const pxPerDay = TRACK_W / domainSpanDays;
    // Drag at least 3 days worth of pixels to guarantee a non-zero delta
    const dragPx = Math.round(3 * pxPerDay);

    fireEvent.pointerDown(plan, { clientX: 0, pointerId: 1 });
    fireEvent.pointerMove(plan, { clientX: dragPx, pointerId: 1 });
    fireEvent.pointerUp(plan, { clientX: dragPx, pointerId: 1 });

    expect(onPlanChange).toHaveBeenCalledTimes(1);
    const call = onPlanChange.mock.calls[0]![0] as { startDate: string; dueDate: string };

    // Both emitted ISO strings must end in T00:00:00.000Z (UTC midnight)
    expect(call.startDate).toMatch(/T00:00:00\.000Z$/);
    expect(call.dueDate).toMatch(/T00:00:00\.000Z$/);

    // Duration must be preserved (14 days — snapping both by equal amounts)
    const emittedStart = new Date(call.startDate).getTime();
    const emittedDue = new Date(call.dueDate).getTime();
    expect(emittedDue - emittedStart).toBe(14 * 24 * 60 * 60 * 1000);

    // Compute the actual delta that the pixel math will produce (same logic as component)
    const anchorPx = TRACK_W / 2;
    const anchorDate = pixelToDate(anchorPx, domain, TRACK_W);
    const shiftedDate = pixelToDate(anchorPx + dragPx, domain, TRACK_W);
    const deltaDays = Math.round(
      (shiftedDate.getTime() - anchorDate.getTime()) / (1000 * 60 * 60 * 24),
    );
    expect(deltaDays).toBeGreaterThan(0); // guard: must be a real drag

    // Original dates snapped to midnight, then shifted by deltaDays
    const expectedStart = new Date("2026-03-01T00:00:00Z");
    expectedStart.setUTCDate(expectedStart.getUTCDate() + deltaDays);
    const expectedDue = new Date("2026-03-15T00:00:00Z");
    expectedDue.setUTCDate(expectedDue.getUTCDate() + deltaDays);

    expect(call.startDate.slice(0, 10)).toBe(expectedStart.toISOString().slice(0, 10));
    expect(call.dueDate.slice(0, 10)).toBe(expectedDue.toISOString().slice(0, 10));
  });
});

// ── Non-interactive planes ────────────────────────────────────────────────────

describe("ThreePlaneRow — baseline / forecast / slip remain non-interactive", () => {
  it("baseline plane has pointerEvents: none", () => {
    const row = makeRow();
    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={makeDomain(row)}
        trackWidth={TRACK_W}
        onPlanChange={vi.fn()}
      />,
    );
    const baseline = container.querySelector("[data-testid='plane-baseline']") as HTMLElement;
    expect(baseline?.style.pointerEvents).toBe("none");
  });

  it("forecast plane has pointerEvents: none", () => {
    const row = makeRow();
    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={makeDomain(row)}
        trackWidth={TRACK_W}
        onPlanChange={vi.fn()}
      />,
    );
    const forecast = container.querySelector("[data-testid='plane-forecast']") as HTMLElement;
    expect(forecast?.style.pointerEvents).toBe("none");
  });

  it("slip gap has pointerEvents: none", () => {
    const row = makeRow({
      dueDate: "2026-05-01T00:00:00Z",
      forecastEnd: "2026-05-15T00:00:00Z",
    });
    const { container } = render(
      <ThreePlaneRow
        row={row}
        domain={makeDomain(row)}
        trackWidth={TRACK_W}
        onPlanChange={vi.fn()}
      />,
    );
    const slip = container.querySelector("[data-testid='slip-gap']") as HTMLElement;
    expect(slip?.style.pointerEvents).toBe("none");
  });
});
