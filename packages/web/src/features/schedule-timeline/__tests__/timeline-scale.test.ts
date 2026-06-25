/**
 * KAN-105 PR2 — Unit tests for timeline-scale pure math.
 * RED phase: these tests fail until timeline-scale.ts is implemented.
 */

import { describe, it, expect } from "vitest";
import {
  computeDomain,
  xForDate,
  pixelToDate,
  barBox,
  MIN_BAR_WIDTH,
  FALLBACK_DOMAIN_DAYS,
} from "../timeline-scale";
import type { ScheduleTimelineRow } from "../use-project-schedule-timeline";

// ── Fixture helpers ──────────────────────────────────────────────────────────

function makeRow(overrides: Partial<ScheduleTimelineRow> = {}): ScheduleTimelineRow {
  return {
    issueId: "id-1",
    issueKey: "TST-1",
    title: "Default",
    state: "todo",
    type: "issue",
    startDate: null,
    dueDate: null,
    progress: 0,
    baselineStart: null,
    baselineEnd: null,
    forecastStart: null,
    forecastEnd: null,
    slipDays: null,
    critical: null,
    floatDays: null,
    deps: [],
    cycleId: null,
    cycleName: null,
    planVsBaseline: null,
    forecastVsBaseline: null,
    isNeighbor: false,
    ...overrides,
  };
}

// ── computeDomain ────────────────────────────────────────────────────────────

describe("computeDomain — all-null rows", () => {
  it("returns a sensible fallback domain when all rows have null dates", () => {
    const rows = [makeRow(), makeRow({ issueKey: "TST-2" })];
    const domain = computeDomain(rows);
    expect(domain.min).toBeInstanceOf(Date);
    expect(domain.max).toBeInstanceOf(Date);
    // Fallback domain must span at least FALLBACK_DOMAIN_DAYS
    const spanDays =
      (domain.max.getTime() - domain.min.getTime()) / (1000 * 60 * 60 * 24);
    expect(spanDays).toBeGreaterThanOrEqual(FALLBACK_DOMAIN_DAYS);
  });

  it("returns a fallback domain for an empty row array", () => {
    const domain = computeDomain([]);
    expect(domain.min).toBeInstanceOf(Date);
    expect(domain.max).toBeInstanceOf(Date);
  });
});

describe("computeDomain — date extraction", () => {
  it("includes startDate and dueDate in the domain", () => {
    const rows = [
      makeRow({ startDate: "2026-01-01T00:00:00Z", dueDate: "2026-03-01T00:00:00Z" }),
    ];
    const domain = computeDomain(rows);
    expect(domain.min.getTime()).toBeLessThanOrEqual(
      new Date("2026-01-01T00:00:00Z").getTime(),
    );
    expect(domain.max.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-03-01T00:00:00Z").getTime(),
    );
  });

  it("includes baselineStart and baselineEnd in the domain", () => {
    const rows = [
      makeRow({
        baselineStart: "2025-11-01T00:00:00Z",
        baselineEnd: "2026-02-01T00:00:00Z",
      }),
    ];
    const domain = computeDomain(rows);
    expect(domain.min.getTime()).toBeLessThanOrEqual(
      new Date("2025-11-01T00:00:00Z").getTime(),
    );
    expect(domain.max.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-02-01T00:00:00Z").getTime(),
    );
  });

  it("includes forecastStart and forecastEnd in the domain", () => {
    const rows = [
      makeRow({
        forecastStart: "2026-04-01T00:00:00Z",
        forecastEnd: "2026-06-15T00:00:00Z",
      }),
    ];
    const domain = computeDomain(rows);
    expect(domain.min.getTime()).toBeLessThanOrEqual(
      new Date("2026-04-01T00:00:00Z").getTime(),
    );
    expect(domain.max.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-06-15T00:00:00Z").getTime(),
    );
  });

  it("picks the overall min/max across all rows and all date fields", () => {
    const rows = [
      makeRow({
        startDate: "2026-02-01T00:00:00Z",
        dueDate: "2026-04-01T00:00:00Z",
      }),
      makeRow({
        issueKey: "TST-2",
        baselineStart: "2026-01-01T00:00:00Z",
        baselineEnd: "2026-03-01T00:00:00Z",
        forecastEnd: "2026-05-01T00:00:00Z",
      }),
    ];
    const domain = computeDomain(rows);
    // min must be ≤ 2026-01-01 (with padding, even earlier)
    expect(domain.min.getTime()).toBeLessThanOrEqual(
      new Date("2026-01-01T00:00:00Z").getTime(),
    );
    // max must be ≥ 2026-05-01 (with padding, even later)
    expect(domain.max.getTime()).toBeGreaterThanOrEqual(
      new Date("2026-05-01T00:00:00Z").getTime(),
    );
  });

  it("adds padding so min < raw earliest and max > raw latest", () => {
    const rows = [
      makeRow({
        startDate: "2026-03-01T00:00:00Z",
        dueDate: "2026-06-01T00:00:00Z",
      }),
    ];
    const domain = computeDomain(rows);
    expect(domain.min.getTime()).toBeLessThan(
      new Date("2026-03-01T00:00:00Z").getTime(),
    );
    expect(domain.max.getTime()).toBeGreaterThan(
      new Date("2026-06-01T00:00:00Z").getTime(),
    );
  });
});

// ── xForDate ─────────────────────────────────────────────────────────────────

describe("xForDate", () => {
  const domain = {
    min: new Date("2026-01-01T00:00:00Z"),
    max: new Date("2026-12-31T00:00:00Z"),
  };
  const trackWidth = 1200;

  it("returns 0 for the domain start date", () => {
    expect(xForDate(domain.min, domain, trackWidth)).toBe(0);
  });

  it("returns trackWidth for the domain end date", () => {
    expect(xForDate(domain.max, domain, trackWidth)).toBe(trackWidth);
  });

  it("returns approximately half trackWidth for the midpoint", () => {
    const mid = new Date(
      (domain.min.getTime() + domain.max.getTime()) / 2,
    );
    const x = xForDate(mid, domain, trackWidth);
    expect(x).toBeGreaterThan(trackWidth * 0.4);
    expect(x).toBeLessThan(trackWidth * 0.6);
  });

  it("clamps to 0 for dates before domain.min", () => {
    const before = new Date("2025-01-01T00:00:00Z");
    expect(xForDate(before, domain, trackWidth)).toBe(0);
  });

  it("clamps to trackWidth for dates after domain.max", () => {
    const after = new Date("2028-01-01T00:00:00Z");
    expect(xForDate(after, domain, trackWidth)).toBe(trackWidth);
  });
});

// ── pixelToDate ───────────────────────────────────────────────────────────────

describe("pixelToDate — inverse of xForDate", () => {
  const domain = {
    min: new Date("2026-01-01T00:00:00Z"),
    max: new Date("2026-12-31T00:00:00Z"),
  };
  const trackWidth = 1200;

  it("round-trips: pixelToDate(xForDate(d)) === d (day granularity)", () => {
    const d = new Date("2026-06-15T00:00:00Z");
    const px = xForDate(d, domain, trackWidth);
    const result = pixelToDate(px, domain, trackWidth);
    // Must be within the same UTC day
    expect(result.toISOString().slice(0, 10)).toBe("2026-06-15");
  });

  it("round-trips for the domain start date", () => {
    const px = xForDate(domain.min, domain, trackWidth);
    const result = pixelToDate(px, domain, trackWidth);
    expect(result.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("round-trips for the domain end date", () => {
    const px = xForDate(domain.max, domain, trackWidth);
    const result = pixelToDate(px, domain, trackWidth);
    expect(result.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("clamps to domain.min when px <= 0", () => {
    const result = pixelToDate(-50, domain, trackWidth);
    expect(result.toISOString().slice(0, 10)).toBe("2026-01-01");
  });

  it("clamps to domain.max when px >= trackWidth", () => {
    const result = pixelToDate(trackWidth + 100, domain, trackWidth);
    expect(result.toISOString().slice(0, 10)).toBe("2026-12-31");
  });

  it("snaps to whole-day UTC (midnight) — no sub-day component", () => {
    const d = new Date("2026-08-20T14:30:00Z"); // mid-day
    const px = xForDate(d, domain, trackWidth);
    const result = pixelToDate(px, domain, trackWidth);
    // Hours/minutes/seconds must all be 0 in UTC
    expect(result.getUTCHours()).toBe(0);
    expect(result.getUTCMinutes()).toBe(0);
    expect(result.getUTCSeconds()).toBe(0);
    expect(result.getUTCMilliseconds()).toBe(0);
  });
});

// ── barBox ───────────────────────────────────────────────────────────────────

describe("barBox", () => {
  const domain = {
    min: new Date("2026-01-01T00:00:00Z"),
    max: new Date("2026-12-31T00:00:00Z"),
  };
  const trackWidth = 1200;

  it("returns left=0 when start is at domain.min", () => {
    const box = barBox(domain.min, new Date("2026-06-01T00:00:00Z"), domain, trackWidth);
    expect(box.left).toBe(0);
  });

  it("returns correct left for a mid-domain start", () => {
    const start = new Date("2026-07-01T00:00:00Z"); // ~midyear
    const box = barBox(start, new Date("2026-08-01T00:00:00Z"), domain, trackWidth);
    expect(box.left).toBeGreaterThan(0);
    expect(box.left).toBeLessThan(trackWidth);
  });

  it("enforces MIN_BAR_WIDTH for very short bars", () => {
    // Same day start/end = zero width before enforcement
    const d = new Date("2026-06-01T00:00:00Z");
    const box = barBox(d, d, domain, trackWidth);
    expect(box.width).toBeGreaterThanOrEqual(MIN_BAR_WIDTH);
  });

  it("returns correct width for a known date span", () => {
    // A half-year bar should be ~600px in 1200px track spanning 1 year
    const start = new Date("2026-01-01T00:00:00Z");
    const end = new Date("2026-07-02T00:00:00Z"); // ~half year (182 days / 364 days)
    const box = barBox(start, end, domain, trackWidth);
    expect(box.width).toBeGreaterThan(trackWidth * 0.4);
    expect(box.width).toBeLessThanOrEqual(trackWidth);
  });

  it("clamps left+width to track bounds", () => {
    // End date beyond domain — should not exceed trackWidth
    const start = new Date("2026-06-01T00:00:00Z");
    const end = new Date("2027-12-01T00:00:00Z"); // way past domain.max
    const box = barBox(start, end, domain, trackWidth);
    expect(box.left + box.width).toBeLessThanOrEqual(trackWidth + 1); // +1 float tolerance
  });

  it("inverted pair (start > end) anchors at the earlier date with width ≥ MIN_BAR_WIDTH", () => {
    // start is AFTER end — bar should be anchored at the earlier date (end here)
    const later = new Date("2026-08-01T00:00:00Z");
    const earlier = new Date("2026-06-01T00:00:00Z");
    const boxInverted = barBox(later, earlier, domain, trackWidth);
    const boxNormal = barBox(earlier, later, domain, trackWidth);
    // left must match the normal (earlier-anchored) box within 1px float tolerance
    expect(boxInverted.left).toBeCloseTo(boxNormal.left, 0);
    // width must be at least MIN_BAR_WIDTH
    expect(boxInverted.width).toBeGreaterThanOrEqual(MIN_BAR_WIDTH);
  });

  it("start at domain.max gives width ≥ 0 (never negative)", () => {
    // left will be at or very near trackWidth; width must not go negative
    const start = domain.max;
    const end = domain.max;
    const box = barBox(start, end, domain, trackWidth);
    expect(box.width).toBeGreaterThanOrEqual(0);
  });
});
