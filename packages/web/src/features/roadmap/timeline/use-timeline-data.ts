import { useMemo } from "react";
import type { Horizon, RoadmapItem, RoadmapStatus } from "@/types/roadmap";
import { HORIZONS, HORIZON_LABELS } from "@/stores/roadmap-store";

// ── Types ──────────────────────────────────────────────────────────────

export interface TimelineItem {
  id: string;
  /** Item title, truncated to 30 chars for Y-axis display. */
  name: string;
  /**
   * Offset from domain start in milliseconds (invisible offset bar).
   * Relative value: createdAtTs - domainStart, NOT the raw timestamp.
   * This keeps stacked bar values proportional to the visible domain range,
   * avoiding floating-point precision issues that occur when raw timestamps
   * (~1.7 trillion) dwarf the visible domain range (~days/weeks).
   */
  offset: number;
  /** (targetDate ?? today) - createdAt in milliseconds (visible duration bar). */
  duration: number;
  /** True when the item has no targetDate. */
  isOpenEnded: boolean;
  status: RoadmapStatus;
  horizon: Horizon;
  /** ISO string for tooltip display. */
  createdAt: string;
  /** ISO string or null for tooltip display. */
  targetDate: string | null;
}

export interface TimelineGroup {
  horizon: Horizon;
  label: string;
  items: TimelineItem[];
}

export interface TimelineData {
  /**
   * Shared X-axis domain as relative milliseconds: [0, totalRange].
   * To convert a tick value back to an absolute timestamp, add domainStart.
   */
  domain: [number, number];
  /** Absolute timestamp of domain start, used for tick formatting. */
  domainStart: number;
  /** Groups ordered by HORIZONS constant, empty horizons excluded. */
  groups: TimelineGroup[];
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_NAME_LENGTH = 30;

function truncateName(name: string): string {
  if (name.length <= MAX_NAME_LENGTH) return name;
  return `${name.slice(0, MAX_NAME_LENGTH - 1)}\u2026`;
}

/**
 * Transforms RoadmapItem[] into timeline chart data.
 * Groups items by horizon, computes offset/duration for stacked bar technique,
 * and derives a shared X-axis domain with 7-day padding.
 */
export function useTimelineData(items: RoadmapItem[]): TimelineData {
  return useMemo(() => {
    if (items.length === 0) {
      return { domain: [0, 0], domainStart: 0, groups: [] };
    }

    const now = Date.now();
    let minTs = Infinity;
    let maxTs = -Infinity;

    // First pass: compute absolute min/max to determine domain bounds
    for (const item of items) {
      const createdAtTs = new Date(item.createdAt).getTime();
      const hasTarget = item.targetDate != null;
      const endTs = hasTarget ? new Date(item.targetDate!).getTime() : now;

      if (createdAtTs < minTs) minTs = createdAtTs;
      if (endTs > maxTs) maxTs = endTs;
    }

    // Domain start is the absolute timestamp of the left edge (with padding)
    const domainStart = minTs - SEVEN_DAYS_MS;
    const domainEnd = maxTs + SEVEN_DAYS_MS;

    // Group items by horizon, computing RELATIVE offset/duration values
    const grouped = new Map<Horizon, TimelineItem[]>();
    for (const h of HORIZONS) {
      grouped.set(h, []);
    }

    for (const item of items) {
      const createdAtTs = new Date(item.createdAt).getTime();
      const hasTarget = item.targetDate != null;
      const endTs = hasTarget ? new Date(item.targetDate!).getTime() : now;

      const timelineItem: TimelineItem = {
        id: item.id,
        name: truncateName(item.title),
        // Relative offset from domain start — keeps values proportional to visible range
        offset: createdAtTs - domainStart,
        duration: Math.max(0, endTs - createdAtTs),
        isOpenEnded: !hasTarget,
        status: item.status,
        horizon: item.horizon,
        createdAt: item.createdAt,
        targetDate: item.targetDate ?? null,
      };

      grouped.get(item.horizon)!.push(timelineItem);
    }

    // Relative domain: [0, totalRange]
    const domain: [number, number] = [0, domainEnd - domainStart];

    // Build groups in HORIZONS order, excluding empty ones
    const groups: TimelineGroup[] = [];
    for (const h of HORIZONS) {
      const horizonItems = grouped.get(h)!;
      if (horizonItems.length > 0) {
        groups.push({
          horizon: h,
          label: HORIZON_LABELS[h],
          items: horizonItems,
        });
      }
    }

    return { domain, domainStart, groups };
  }, [items]);
}
