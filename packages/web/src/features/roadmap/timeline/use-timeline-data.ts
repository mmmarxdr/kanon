import { useMemo } from "react";
import type { Horizon, RoadmapItem, RoadmapStatus } from "@/types/roadmap";
import { HORIZONS, HORIZON_LABELS, HORIZON_SUB_LABELS } from "@/stores/roadmap-store";

// ── Constants ──────────────────────────────────────────────────────────

export const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/** Today is week 0. Negative weeks are in the past, positive in the future. */
export const TODAY_WEEK = 0;

/** Total weeks rendered in the canvas (≈9 months @ 4 weeks/month). */
export const TOTAL_WEEKS = 40;

/** First week shown on the canvas (used by xpx). */
export const CANVAS_START_WEEK = -2;

/**
 * Per-horizon week ranges within the canvas. Until items carry real start/end
 * dates we synthesize positions from (horizon × index × effort) so the
 * timeline reads as a coherent plan instead of a stack of 1-week pellets at
 * week 0.
 */
const HORIZON_RANGE: Readonly<Record<Horizon, readonly [number, number]>> = {
  now: [-1, 6],
  next: [6, 14],
  later: [14, 28],
  someday: [28, 38],
} as const;

/** Default effort when an item has none — keeps duration math sensible. */
const DEFAULT_EFFORT = 3;

export interface MonthSegment {
  /** Display label, e.g. "Apr". */
  label: string;
  /** Inclusive start week (relative to today=0). */
  start: number;
  /** Exclusive end week. */
  end: number;
}

export interface QuarterSegment {
  /** Display label, e.g. "Q2 · 2026". */
  label: string;
  start: number;
  end: number;
  /** Tone used to highlight the active quarter. */
  tone: Horizon;
}

/**
 * Months that fit within the 40-week canvas window starting two weeks before
 * today. The original design pins this to Apr 2026 → Dec 2026; we keep the
 * relative geometry stable so the rest of the layout math stays simple.
 */
export const MONTHS: readonly MonthSegment[] = [
  { label: "Apr", start: -2, end: 2 },
  { label: "May", start: 2, end: 6 },
  { label: "Jun", start: 6, end: 10 },
  { label: "Jul", start: 10, end: 14 },
  { label: "Aug", start: 14, end: 18 },
  { label: "Sep", start: 18, end: 22 },
  { label: "Oct", start: 22, end: 26 },
  { label: "Nov", start: 26, end: 30 },
  { label: "Dec", start: 30, end: 38 },
] as const;

export const QUARTERS: readonly QuarterSegment[] = [
  { label: "Q2 · 2026", start: -2, end: 10, tone: "now" },
  { label: "Q3 · 2026", start: 10, end: 22, tone: "next" },
  { label: "Q4 · 2026", start: 22, end: 34, tone: "later" },
  { label: "Q1 · 2027", start: 34, end: 38, tone: "someday" },
] as const;

// ── Types ──────────────────────────────────────────────────────────────

export interface TimelineItem {
  id: string;
  title: string;
  /** Week number (TODAY=0) when work begins; can be negative. */
  start: number;
  /** Week number (TODAY=0) when work is expected to end. */
  end: number;
  status: RoadmapStatus;
  horizon: Horizon;
  effort: number | null;
  impact: number | null;
  /** Owner id, or null if unassigned (placeholder until people-on-items lands). */
  owner: string | null;
}

export interface TimelineGroup {
  horizon: Horizon;
  label: string;
  /** "this cycle", "1–2 cycles", etc. */
  sub: string;
  items: TimelineItem[];
}

export interface TimelineData {
  groups: TimelineGroup[];
}

// ── Helpers ────────────────────────────────────────────────────────────

/** Compute synthesized [start, end] week pair for an item within its horizon. */
function planItem(
  horizon: Horizon,
  indexInHorizon: number,
  effort: number | null,
): { start: number; end: number } {
  const [hStart, hEnd] = HORIZON_RANGE[horizon];
  const span = hEnd - hStart;
  const baseStart = hStart + ((indexInHorizon * 1.4) % (span * 0.4));
  const dur = Math.max(2, (effort ?? DEFAULT_EFFORT) * 1.4);
  const start = Math.round(baseStart);
  const end = Math.min(hEnd, Math.round(baseStart + dur));
  return { start, end: end <= start ? start + 1 : end };
}

// ── Hook ───────────────────────────────────────────────────────────────

/**
 * Transform RoadmapItem[] into the week-relative shape consumed by the
 * custom Gantt canvas. Items are grouped by horizon in HORIZONS order;
 * empty horizons are dropped.
 *
 * Bar positions are synthesized from (horizon, index, effort) — see
 * planItem(). Real start/end dates land later when items grow targetDate
 * support; until then this gives a readable plan rather than a stack of
 * 1-week pellets at week 0.
 */
export function useTimelineData(items: RoadmapItem[]): TimelineData {
  return useMemo(() => {
    if (items.length === 0) {
      return { groups: [] };
    }

    const grouped = new Map<Horizon, TimelineItem[]>();
    for (const h of HORIZONS) {
      grouped.set(h, []);
    }

    // Stable per-horizon ordering: input order, which is sortOrder from the
    // store. Within a horizon, indexInHorizon drives the stagger.
    const horizonCursor = new Map<Horizon, number>();
    for (const h of HORIZONS) horizonCursor.set(h, 0);

    for (const item of items) {
      const idx = horizonCursor.get(item.horizon)!;
      horizonCursor.set(item.horizon, idx + 1);

      const { start, end } = planItem(item.horizon, idx, item.effort ?? null);

      const tlItem: TimelineItem = {
        id: item.id,
        title: item.title,
        start,
        end,
        status: item.status,
        horizon: item.horizon,
        effort: item.effort ?? null,
        impact: item.impact ?? null,
        owner: null,
      };

      grouped.get(item.horizon)!.push(tlItem);
    }

    const groups: TimelineGroup[] = [];
    for (const h of HORIZONS) {
      const horizonItems = grouped.get(h)!;
      if (horizonItems.length > 0) {
        groups.push({
          horizon: h,
          label: HORIZON_LABELS[h],
          sub: HORIZON_SUB_LABELS[h],
          items: horizonItems,
        });
      }
    }

    return { groups };
  }, [items]);
}
