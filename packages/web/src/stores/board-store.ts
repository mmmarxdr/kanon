import { create } from "zustand";

/**
 * Issue states matching the API's IssueState enum (kanban pipeline).
 */
export const ISSUE_STATES = [
  "backlog",
  "todo",
  "in_progress",
  "review",
  "done",
] as const;

export type IssueState = (typeof ISSUE_STATES)[number];

// ---------------------------------------------------------------------------
// Board columns – one column per state.
// The board column model is preserved so legacy imports keep working, but it
// is now a 1:1 mapping with IssueState.
// ---------------------------------------------------------------------------

export type BoardColumn = IssueState;

export const BOARD_COLUMNS: readonly BoardColumn[] = ISSUE_STATES;

export const COLUMN_STATE_MAP: Record<BoardColumn, readonly IssueState[]> = {
  backlog:     ["backlog"],
  todo:        ["todo"],
  in_progress: ["in_progress"],
  review:      ["review"],
  done:        ["done"],
};

export const COLUMN_DEFAULT_STATE: Record<BoardColumn, IssueState> = {
  backlog:     "backlog",
  todo:        "todo",
  in_progress: "in_progress",
  review:      "review",
  done:        "done",
};

export const COLUMN_LABELS: Record<BoardColumn, string> = {
  backlog:     "Backlog",
  todo:        "Todo",
  in_progress: "In progress",
  review:      "In review",
  done:        "Done",
};

export const STATE_LABELS: Record<IssueState, string> = {
  backlog:     "Backlog",
  todo:        "Todo",
  in_progress: "In progress",
  review:      "In review",
  done:        "Done",
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
