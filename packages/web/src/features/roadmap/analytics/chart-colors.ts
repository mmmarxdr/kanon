import type { Horizon, RoadmapStatus } from "@/types/roadmap";

/**
 * Hex color constants for Recharts charts.
 * Derived from design tokens — maps to the same semantic palette
 * used by HORIZON_PILL_COLORS but as hex values for Recharts.
 */
export const HORIZON_CHART_COLORS: Record<Horizon, string> = {
  someday: "#9CA3AF", // gray-400
  later: "#60A5FA",   // blue-400
  next: "#F59E0B",    // amber-500
  now: "#10B981",     // emerald-500
};

/**
 * Hex color constants for roadmap statuses in charts.
 */
export const STATUS_CHART_COLORS: Record<RoadmapStatus, string> = {
  idea: "#9CA3AF",       // gray-400
  planned: "#3B82F6",    // blue-500
  in_progress: "#F59E0B", // amber-500
  done: "#059669",       // emerald-600
};
