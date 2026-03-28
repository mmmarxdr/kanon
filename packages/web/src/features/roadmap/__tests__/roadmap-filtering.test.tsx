import { describe, it, expect, beforeEach } from "vitest";
import { useRoadmapStore } from "@/stores/roadmap-store";
import type { RoadmapItem } from "@/types/roadmap";

/**
 * Integration test: verifies that the roadmap store filtering logic
 * (search + status + horizon combined) works correctly. This tests the
 * same filtering logic used in roadmap.tsx's filteredItems useMemo.
 */

function makeItem(overrides: Partial<RoadmapItem> = {}): RoadmapItem {
  return {
    id: "item-1",
    title: "Default item",
    horizon: "now",
    status: "idea",
    labels: [],
    sortOrder: 0,
    promoted: false,
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

const ITEMS: RoadmapItem[] = [
  makeItem({ id: "1", title: "Auth flow", status: "in_progress", horizon: "now" }),
  makeItem({ id: "2", title: "API redesign", status: "planned", horizon: "next" }),
  makeItem({ id: "3", title: "Auth tokens", status: "idea", horizon: "later" }),
  makeItem({ id: "4", title: "Dashboard UI", status: "done", horizon: "now" }),
  makeItem({ id: "5", title: "Logging setup", status: "planned", horizon: "someday" }),
];

/** Applies the same filtering logic used in roadmap.tsx */
function applyFilters(items: RoadmapItem[]) {
  const state = useRoadmapStore.getState();
  let result = items;

  if (state.activeStatusFilter) {
    result = result.filter((i) => i.status === state.activeStatusFilter);
  }
  if (state.activeHorizonFilter) {
    result = result.filter((i) => i.horizon === state.activeHorizonFilter);
  }
  if (state.search) {
    const lower = state.search.toLowerCase();
    result = result.filter((i) => i.title.toLowerCase().includes(lower));
  }
  return result;
}

describe("Roadmap filtering integration", () => {
  beforeEach(() => {
    // Reset store to defaults before each test
    const store = useRoadmapStore.getState();
    store.setSearch("");
    store.setStatusFilter(undefined);
    store.setHorizonFilter(undefined);
    store.setSortPreference("sortOrder");
  });

  it("returns all items when no filters active", () => {
    const result = applyFilters(ITEMS);
    expect(result).toHaveLength(5);
  });

  it("filters by search (case-insensitive title match)", () => {
    useRoadmapStore.getState().setSearch("auth");
    const result = applyFilters(ITEMS);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(["1", "3"]);
  });

  it("filters by status", () => {
    useRoadmapStore.getState().setStatusFilter("planned");
    const result = applyFilters(ITEMS);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(["2", "5"]);
  });

  it("filters by horizon", () => {
    useRoadmapStore.getState().setHorizonFilter("now");
    const result = applyFilters(ITEMS);
    expect(result).toHaveLength(2);
    expect(result.map((i) => i.id)).toEqual(["1", "4"]);
  });

  it("combines search + status filters", () => {
    const state = useRoadmapStore.getState();
    state.setSearch("auth");
    state.setStatusFilter("in_progress");
    const result = applyFilters(ITEMS);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("1");
  });

  it("combines search + status + horizon filters", () => {
    const state = useRoadmapStore.getState();
    state.setSearch("auth");
    state.setStatusFilter(undefined); // all statuses
    state.setHorizonFilter("later");
    const result = applyFilters(ITEMS);
    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe("3");
  });

  it("returns empty when no items match combined filters", () => {
    const state = useRoadmapStore.getState();
    state.setSearch("nonexistent");
    const result = applyFilters(ITEMS);
    expect(result).toHaveLength(0);
  });

  it("clears all filters restores defaults", () => {
    const state = useRoadmapStore.getState();
    state.setSearch("auth");
    state.setStatusFilter("planned");
    state.setHorizonFilter("now");

    // Clear
    state.setSearch("");
    state.setStatusFilter(undefined);
    state.setHorizonFilter(undefined);

    const result = applyFilters(ITEMS);
    expect(result).toHaveLength(5);
  });
});
