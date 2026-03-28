import { describe, it, expect, beforeEach } from "vitest";
import { useBoardStore } from "@/stores/board-store";
import type { BoardColumn } from "@/stores/board-store";

describe("useBoardStore", () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    useBoardStore.setState({
      hiddenColumns: new Set<BoardColumn>(["backlog", "finished"]),
      filters: {},
      viewMode: "grouped",
      showUngrouped: false,
    });
  });

  describe("initial state", () => {
    it("hides backlog and finished by default", () => {
      const { hiddenColumns } = useBoardStore.getState();
      expect(hiddenColumns.has("backlog")).toBe(true);
      expect(hiddenColumns.has("finished")).toBe(true);
    });

    it("does not hide other columns by default", () => {
      const { hiddenColumns } = useBoardStore.getState();
      const visible: BoardColumn[] = [
        "analysis",
        "in_progress",
        "testing",
      ];
      for (const col of visible) {
        expect(hiddenColumns.has(col)).toBe(false);
      }
    });

    it("starts with empty filters", () => {
      const { filters } = useBoardStore.getState();
      expect(filters).toEqual({});
    });
  });

  describe("toggleColumn", () => {
    it("shows a hidden column when toggled", () => {
      useBoardStore.getState().toggleColumn("backlog");
      expect(useBoardStore.getState().hiddenColumns.has("backlog")).toBe(false);
    });

    it("hides a visible column when toggled", () => {
      useBoardStore.getState().toggleColumn("analysis");
      expect(useBoardStore.getState().hiddenColumns.has("analysis")).toBe(true);
    });

    it("toggles back and forth correctly", () => {
      const { toggleColumn } = useBoardStore.getState();

      // Show backlog
      toggleColumn("backlog");
      expect(useBoardStore.getState().hiddenColumns.has("backlog")).toBe(false);

      // Hide backlog again
      useBoardStore.getState().toggleColumn("backlog");
      expect(useBoardStore.getState().hiddenColumns.has("backlog")).toBe(true);
    });

    it("does not affect other columns", () => {
      useBoardStore.getState().toggleColumn("backlog");
      // backlog is now visible, but finished should still be hidden
      expect(useBoardStore.getState().hiddenColumns.has("finished")).toBe(true);
    });
  });

  describe("setFilter", () => {
    it("sets a single filter field", () => {
      useBoardStore.getState().setFilter("type", "bug");
      expect(useBoardStore.getState().filters.type).toBe("bug");
    });

    it("sets multiple filter fields independently", () => {
      const store = useBoardStore.getState();
      store.setFilter("type", "bug");
      useBoardStore.getState().setFilter("priority", "high");

      const { filters } = useBoardStore.getState();
      expect(filters.type).toBe("bug");
      expect(filters.priority).toBe("high");
    });

    it("clears a filter field when set to undefined", () => {
      useBoardStore.getState().setFilter("type", "bug");
      useBoardStore.getState().setFilter("type", undefined);
      expect(useBoardStore.getState().filters.type).toBeUndefined();
    });

    it("sets search filter", () => {
      useBoardStore.getState().setFilter("search", "auth");
      expect(useBoardStore.getState().filters.search).toBe("auth");
    });

    it("sets assigneeId filter", () => {
      useBoardStore.getState().setFilter("assigneeId", "user-123");
      expect(useBoardStore.getState().filters.assigneeId).toBe("user-123");
    });
  });

  describe("clearFilters", () => {
    it("resets all filters to empty object", () => {
      const store = useBoardStore.getState();
      store.setFilter("type", "bug");
      useBoardStore.getState().setFilter("priority", "critical");
      useBoardStore.getState().setFilter("search", "something");

      useBoardStore.getState().clearFilters();
      expect(useBoardStore.getState().filters).toEqual({});
    });

    it("does not affect column visibility", () => {
      useBoardStore.getState().toggleColumn("backlog"); // show it
      useBoardStore.getState().setFilter("type", "bug");
      useBoardStore.getState().clearFilters();

      // backlog should still be visible (was toggled)
      expect(useBoardStore.getState().hiddenColumns.has("backlog")).toBe(false);
    });
  });

  describe("viewMode", () => {
    it("defaults to 'grouped'", () => {
      expect(useBoardStore.getState().viewMode).toBe("grouped");
    });

    it("can be set to 'flat'", () => {
      useBoardStore.getState().setViewMode("flat");
      expect(useBoardStore.getState().viewMode).toBe("flat");
    });

    it("can be toggled back to 'grouped'", () => {
      useBoardStore.getState().setViewMode("flat");
      useBoardStore.getState().setViewMode("grouped");
      expect(useBoardStore.getState().viewMode).toBe("grouped");
    });

    it("does not affect other state when changed", () => {
      useBoardStore.getState().setFilter("type", "bug");
      useBoardStore.getState().setViewMode("flat");
      expect(useBoardStore.getState().filters.type).toBe("bug");
    });
  });

  describe("showUngrouped", () => {
    it("defaults to false", () => {
      expect(useBoardStore.getState().showUngrouped).toBe(false);
    });

    it("can be set to true", () => {
      useBoardStore.getState().setShowUngrouped(true);
      expect(useBoardStore.getState().showUngrouped).toBe(true);
    });

    it("can be toggled back to false", () => {
      useBoardStore.getState().setShowUngrouped(true);
      useBoardStore.getState().setShowUngrouped(false);
      expect(useBoardStore.getState().showUngrouped).toBe(false);
    });
  });
});
