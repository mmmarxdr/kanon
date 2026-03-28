import { create } from "zustand";

/**
 * Issue states matching the API's IssueState enum.
 * Ordered to reflect the Kanon workflow pipeline.
 */
export const ISSUE_STATES = [
  "backlog",
  "explore",
  "propose",
  "design",
  "spec",
  "tasks",
  "apply",
  "verify",
  "archived",
] as const;

export type IssueState = (typeof ISSUE_STATES)[number];

// ---------------------------------------------------------------------------
// Board columns – each column groups one or more IssueStates
// ---------------------------------------------------------------------------

/** Logical columns shown on the board. */
export type BoardColumn =
  | "backlog"
  | "analysis"
  | "in_progress"
  | "testing"
  | "finished";

/** Ordered list of all board columns (left → right). */
export const BOARD_COLUMNS: readonly BoardColumn[] = [
  "backlog",
  "analysis",
  "in_progress",
  "testing",
  "finished",
] as const;

/** Maps each board column to the IssueStates it contains. */
export const COLUMN_STATE_MAP: Record<BoardColumn, readonly IssueState[]> = {
  backlog: ["backlog", "explore"],
  analysis: ["propose", "design", "spec"],
  in_progress: ["tasks", "apply"],
  testing: ["verify"],
  finished: ["archived"],
};

/** Default IssueState assigned when an issue is dragged into a column. */
export const COLUMN_DEFAULT_STATE: Record<BoardColumn, IssueState> = {
  backlog: "backlog",
  analysis: "propose",
  in_progress: "tasks",
  testing: "verify",
  finished: "archived",
};

/** Human-readable labels for each board column. */
export const COLUMN_LABELS: Record<BoardColumn, string> = {
  backlog: "Backlog",
  analysis: "Analysis",
  in_progress: "In Progress",
  testing: "Testing",
  finished: "Finished",
};

/** Human-readable labels for each state column. */
export const STATE_LABELS: Record<IssueState, string> = {
  backlog: "Backlog",
  explore: "Explore",
  propose: "Propose",
  design: "Design",
  spec: "Spec",
  tasks: "Tasks",
  apply: "Apply",
  verify: "Verify",
  archived: "Archived",
};

/** Columns hidden by default on the board (only in flat mode). */
const DEFAULT_HIDDEN: BoardColumn[] = [];

export interface BoardFilters {
  type?: string;
  priority?: string;
  assigneeId?: string;
  search?: string;
}

export type ViewMode = "grouped" | "flat";

interface BoardState {
  /** Set of board columns that are currently hidden. */
  hiddenColumns: Set<BoardColumn>;
  /** Active filter criteria (client-side). */
  filters: BoardFilters;
  /** View mode: grouped (default) shows group cards; flat shows individual issues. */
  viewMode: ViewMode;
  /** Whether ungrouped issues (groupKey = null) are visible. Hidden by default. */
  showUngrouped: boolean;

  /** Toggle visibility of a specific board column. */
  toggleColumn: (column: BoardColumn) => void;
  /** Set a single filter field. Pass undefined to clear it. */
  setFilter: <K extends keyof BoardFilters>(
    key: K,
    value: BoardFilters[K],
  ) => void;
  /** Clear all active filters. */
  clearFilters: () => void;
  /** Set the view mode (grouped or flat). */
  setViewMode: (mode: ViewMode) => void;
  /** Toggle visibility of ungrouped issues. */
  setShowUngrouped: (show: boolean) => void;
}

export const useBoardStore = create<BoardState>((set) => ({
  hiddenColumns: new Set(DEFAULT_HIDDEN),
  filters: {},
  viewMode: "grouped",
  showUngrouped: false,

  toggleColumn: (column) =>
    set((prev) => {
      const next = new Set(prev.hiddenColumns);
      if (next.has(column)) {
        next.delete(column);
      } else {
        next.add(column);
      }
      return { hiddenColumns: next };
    }),

  setFilter: (key, value) =>
    set((prev) => ({
      filters: { ...prev.filters, [key]: value },
    })),

  clearFilters: () => set({ filters: {} }),

  setViewMode: (mode) => set({ viewMode: mode }),

  setShowUngrouped: (show) => set({ showUngrouped: show }),
}));
