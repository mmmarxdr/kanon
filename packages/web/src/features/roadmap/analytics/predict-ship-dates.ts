import type { Horizon, RoadmapItem } from "@/types/roadmap";
import type { ShipPrediction } from "./confidence-table";

const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Base ETA in weeks per horizon. These mirror the synthesized horizon ranges
 * used by the Gantt timeline so an item that visually lives in the middle of
 * the "now" lane forecasts to roughly the same ETA shown there.
 */
const HORIZON_BASE_WEEKS: Record<Horizon, number> = {
  now: 4,
  next: 10,
  later: 20,
  someday: 36,
};

/** Default effort when the item has none. Matches the timeline planner. */
const DEFAULT_EFFORT = 3;

/**
 * Heuristic predictor — turns the real signals we DO have (horizon, effort,
 * dependsOn count, targetDate, status) into a ship-week + confidence score.
 *
 * This is intentionally a transparent rule-based model, not an AI forecast:
 * - we don't have flow telemetry (state-change timestamps) to fit a real
 *   model on, so any ML "prediction" today would be a fabrication;
 * - the rules below are documented so a reader can sanity-check each row;
 * - when AI integration lands, swap this function for a Claude-MCP call
 *   that returns the same `ShipPrediction[]` shape — no callers change.
 */
export function predictShipDates(items: RoadmapItem[]): ShipPrediction[] {
  const now = Date.now();

  return items
    .filter((it) => it.status !== "done")
    .map((it) => {
      // ETA: prefer real targetDate when present, else compute from rules.
      let etaWeeks: number;
      let confidence = 0.7;

      if (it.targetDate) {
        const ts = new Date(it.targetDate).getTime();
        etaWeeks = Math.max(0, Math.round((ts - now) / MS_PER_WEEK));
        confidence += 0.2; // explicit commitment from owner
      } else {
        const base = HORIZON_BASE_WEEKS[it.horizon];
        const effortWeeks = (it.effort ?? DEFAULT_EFFORT) * 1.4;
        const blockedPenalty = (it.dependsOn?.length ?? 0) * 2;
        etaWeeks = Math.round(base + effortWeeks + blockedPenalty);
      }

      // Confidence adjustments
      const blockedCount = it.dependsOn?.length ?? 0;
      confidence -= Math.min(0.2, blockedCount * 0.05);
      if ((it.effort ?? DEFAULT_EFFORT) >= 5) confidence -= 0.08;
      if (it.status === "in_progress") confidence += 0.05;
      if (it.status === "idea") confidence -= 0.1;

      confidence = Math.max(0.3, Math.min(0.95, confidence));

      const eta = etaWeeks <= 0 ? "this wk" : `w +${etaWeeks}`;

      return {
        itemId: it.id,
        eta,
        etaWeeks,
        confidence,
      } as ShipPrediction & { etaWeeks: number };
    })
    .sort((a, b) => (a.etaWeeks ?? 0) - (b.etaWeeks ?? 0));
}
