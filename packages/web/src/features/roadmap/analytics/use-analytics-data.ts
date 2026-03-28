import { useMemo } from "react";
import type { Horizon, RoadmapItem, RoadmapStatus } from "@/types/roadmap";
import { HORIZONS, HORIZON_LABELS, ROADMAP_STATUSES, STATUS_LABELS } from "@/stores/roadmap-store";
import { HORIZON_CHART_COLORS, STATUS_CHART_COLORS } from "./chart-colors";

// ── Types ──────────────────────────────────────────────────────────────

export interface EffortImpactPoint {
  id: string;
  title: string;
  effort: number;
  impact: number;
  horizon: Horizon;
}

export interface HorizonBar {
  horizon: Horizon;
  label: string;
  count: number;
  fill: string;
}

export interface StatusSlice {
  status: RoadmapStatus;
  label: string;
  count: number;
  fill: string;
}

export interface PromotionData {
  promoted: number;
  total: number;
  rate: number; // 0-100
}

export interface AgingItem {
  id: string;
  title: string;
  horizon: Horizon;
  ageDays: number;
  createdAt: string;
}

// ── Hooks ──────────────────────────────────────────────────────────────

/**
 * Returns items that have both effort AND impact scores,
 * mapped for a scatter chart.
 */
export function useEffortImpactData(items: RoadmapItem[]): EffortImpactPoint[] {
  return useMemo(() => {
    const result = items
      .filter(
        (i): i is RoadmapItem & { effort: number; impact: number } =>
          i.effort != null && i.impact != null,
      )
      .map((i) => ({
        id: i.id,
        title: i.title,
        effort: i.effort,
        impact: i.impact,
        horizon: i.horizon,
      }));
    return result;
  }, [items]);
}

/**
 * Returns count per horizon for a bar chart.
 */
export function useHorizonData(items: RoadmapItem[]): HorizonBar[] {
  return useMemo(() => {
    const counts = new Map<Horizon, number>();
    for (const h of HORIZONS) {
      counts.set(h, 0);
    }
    for (const item of items) {
      counts.set(item.horizon, (counts.get(item.horizon) ?? 0) + 1);
    }
    const result = HORIZONS.map((h) => ({
      horizon: h,
      label: HORIZON_LABELS[h],
      count: counts.get(h) ?? 0,
      fill: HORIZON_CHART_COLORS[h],
    }));
    return result;
  }, [items]);
}

/**
 * Returns count per status for a donut chart.
 */
export function useStatusData(items: RoadmapItem[]): StatusSlice[] {
  return useMemo(() => {
    const counts = new Map<RoadmapStatus, number>();
    for (const s of ROADMAP_STATUSES) {
      counts.set(s, 0);
    }
    for (const item of items) {
      counts.set(item.status, (counts.get(item.status) ?? 0) + 1);
    }
    const result = ROADMAP_STATUSES.map((s) => ({
      status: s,
      label: STATUS_LABELS[s],
      count: counts.get(s) ?? 0,
      fill: STATUS_CHART_COLORS[s],
    }));
    return result;
  }, [items]);
}

/**
 * Returns promotion rate data.
 */
export function usePromotionData(items: RoadmapItem[]): PromotionData {
  return useMemo(() => {
    const total = items.length;
    const promoted = items.filter((i) => i.promoted).length;
    const rate = total > 0 ? Math.round((promoted / total) * 100) : 0;
    return { promoted, total, rate };
  }, [items]);
}

/**
 * Returns items in "idea" status older than thresholdDays,
 * sorted by age descending.
 */
export function useAgingData(
  items: RoadmapItem[],
  thresholdDays = 30,
): AgingItem[] {
  return useMemo(() => {
    const now = Date.now();
    const msPerDay = 86_400_000;

    const ideaItems = items.filter((i) => i.status === "idea");

    const result = ideaItems
      .map((i) => ({
        id: i.id,
        title: i.title,
        horizon: i.horizon,
        ageDays: Math.floor((now - new Date(i.createdAt).getTime()) / msPerDay),
        createdAt: i.createdAt,
      }))
      .filter((i) => i.ageDays >= thresholdDays)
      .sort((a, b) => b.ageDays - a.ageDays);
    return result;
  }, [items, thresholdDays]);
}
