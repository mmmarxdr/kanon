import { create } from "zustand";
import type { Horizon, RoadmapStatus } from "@/types/roadmap";

/**
 * Horizon values ordered for the swimlane view (left to right).
 */
export const HORIZONS: readonly Horizon[] = [
  "someday",
  "later",
  "next",
  "now",
] as const;

/**
 * Human-readable labels for each horizon.
 */
export const HORIZON_LABELS: Record<Horizon, string> = {
  someday: "Someday",
  later: "Later",
  next: "Next",
  now: "Now",
};

/**
 * Color mapping for horizon column pill indicators.
 */
export const HORIZON_PILL_COLORS: Record<Horizon, string> = {
  someday: "bg-gray-400",
  later: "bg-blue-400",
  next: "bg-amber-500",
  now: "bg-emerald-500",
};

/**
 * All possible roadmap statuses, ordered for display.
 */
export const ROADMAP_STATUSES: readonly RoadmapStatus[] = [
  "idea",
  "planned",
  "in_progress",
  "done",
] as const;

/**
 * Human-readable labels for each roadmap status.
 */
export const STATUS_LABELS: Record<RoadmapStatus, string> = {
  idea: "Idea",
  planned: "Planned",
  in_progress: "In Progress",
  done: "Done",
};

export type SortPreference = "sortOrder" | "effort" | "impact" | "createdAt";

export type ViewMode = "board" | "analytics" | "timeline" | "graph";

interface RoadmapState {
  /** Active horizon filter (undefined = show all). */
  activeHorizonFilter?: Horizon;
  /** Active status filter (undefined = show all). */
  activeStatusFilter?: RoadmapStatus;
  /** Sort preference for items within a column. */
  sortPreference: SortPreference;
  /** Currently selected item ID (for detail panel). */
  selectedItemId?: string;
  /** Search text for filtering items by title. */
  search: string;
  /** Current view mode: board (swimlane) or analytics (charts). */
  viewMode: ViewMode;

  /** Set the horizon filter. Pass undefined to clear. */
  setHorizonFilter: (horizon?: Horizon) => void;
  /** Set the status filter. Pass undefined to clear. */
  setStatusFilter: (status?: RoadmapStatus) => void;
  /** Set the sort preference. */
  setSortPreference: (pref: SortPreference) => void;
  /** Set the selected item ID. Pass undefined to close detail panel. */
  setSelectedItemId: (id?: string) => void;
  /** Set the search text. */
  setSearch: (s: string) => void;
  /** Set the view mode. */
  setViewMode: (mode: ViewMode) => void;
}

export const useRoadmapStore = create<RoadmapState>((set) => ({
  activeHorizonFilter: undefined,
  activeStatusFilter: undefined,
  sortPreference: "sortOrder",
  selectedItemId: undefined,
  search: "",
  viewMode: "board",

  setHorizonFilter: (horizon) => set({ activeHorizonFilter: horizon }),
  setStatusFilter: (status) => set({ activeStatusFilter: status }),
  setSortPreference: (pref) => set({ sortPreference: pref }),
  setSelectedItemId: (id) => set({ selectedItemId: id }),
  setSearch: (s) => set({ search: s }),
  setViewMode: (mode) => set({ viewMode: mode }),
}));
