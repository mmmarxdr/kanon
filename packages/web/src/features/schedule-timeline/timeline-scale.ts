/**
 * KAN-105 PR2 — Pure date-to-pixel scale functions for the three-plane
 * schedule Gantt.
 *
 * No React. No side effects. All functions are pure and fully testable.
 *
 * Domain: the date range covering ALL non-null date fields across all rows,
 * expanded by a padding margin on each side so bars never sit flush against
 * the canvas edge. When every row has null dates a fallback domain is used.
 */

import type { ScheduleTimelineRow } from "./use-project-schedule-timeline";

// ── Constants ────────────────────────────────────────────────────────────────

/** Minimum rendered bar width in pixels — prevents invisible 0-width bars. */
export const MIN_BAR_WIDTH = 8;

/** Padding added to each side of the computed date domain, in days. */
export const DOMAIN_PADDING_DAYS = 14;

/**
 * Width of the fallback domain in days, used when all date fields are null.
 * Centers on today.
 */
export const FALLBACK_DOMAIN_DAYS = 180;

// ── Types ────────────────────────────────────────────────────────────────────

export interface DateDomain {
  min: Date;
  max: Date;
}

export interface BarBox {
  /** Pixel offset from the left edge of the track (not the full canvas). */
  left: number;
  /** Pixel width, enforcing MIN_BAR_WIDTH. */
  width: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function daysMs(days: number): number {
  return days * 24 * 60 * 60 * 1000;
}

function parseDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const d = new Date(iso);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Extract all non-null dates from a row across all three planes.
 */
function rowDates(row: ScheduleTimelineRow): Date[] {
  const candidates = [
    row.startDate,
    row.dueDate,
    row.baselineStart,
    row.baselineEnd,
    row.forecastStart,
    row.forecastEnd,
  ];
  return candidates.map(parseDate).filter((d): d is Date => d !== null);
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the date domain across all rows. Considers every non-null date field
 * in every row (plan, baseline, forecast planes). Adds DOMAIN_PADDING_DAYS of
 * margin on each side so bars don't sit flush at the canvas edges.
 *
 * Falls back to a FALLBACK_DOMAIN_DAYS window centred on today when all dates
 * are null or the row array is empty.
 */
export function computeDomain(rows: ScheduleTimelineRow[]): DateDomain {
  const allDates: Date[] = rows.flatMap(rowDates);

  if (allDates.length === 0) {
    const now = Date.now();
    return {
      min: new Date(now - daysMs(FALLBACK_DOMAIN_DAYS / 2)),
      max: new Date(now + daysMs(FALLBACK_DOMAIN_DAYS / 2)),
    };
  }

  const times = allDates.map((d) => d.getTime());
  const rawMin = Math.min(...times);
  const rawMax = Math.max(...times);

  return {
    min: new Date(rawMin - daysMs(DOMAIN_PADDING_DAYS)),
    max: new Date(rawMax + daysMs(DOMAIN_PADDING_DAYS)),
  };
}

/**
 * Convert a date to a pixel offset within the track (0 → left edge,
 * trackWidth → right edge). Clamps to [0, trackWidth].
 *
 * @param date       The date to project.
 * @param domain     The computed domain from {@link computeDomain}.
 * @param trackWidth The pixel width of the scrollable track area.
 */
export function xForDate(date: Date, domain: DateDomain, trackWidth: number): number {
  const span = domain.max.getTime() - domain.min.getTime();
  if (span <= 0) return 0;
  const ratio = (date.getTime() - domain.min.getTime()) / span;
  return Math.min(trackWidth, Math.max(0, ratio * trackWidth));
}

/**
 * Compute the {left, width} pixel box for a bar given its start/end dates.
 * Enforces MIN_BAR_WIDTH so very short bars remain clickable and visible.
 * Width is clamped so the bar never overflows the track.
 *
 * @param start      Bar start date.
 * @param end        Bar end date.
 * @param domain     The computed domain from {@link computeDomain}.
 * @param trackWidth The pixel width of the scrollable track area.
 */
export function barBox(
  start: Date,
  end: Date,
  domain: DateDomain,
  trackWidth: number,
): BarBox {
  const left = xForDate(start, domain, trackWidth);
  const rawRight = xForDate(end, domain, trackWidth);
  const rawWidth = rawRight - left;
  // Enforce minimum width; clamp so bar doesn't overflow track
  const width = Math.min(
    Math.max(rawWidth, MIN_BAR_WIDTH),
    trackWidth - left,
  );
  return { left, width };
}
