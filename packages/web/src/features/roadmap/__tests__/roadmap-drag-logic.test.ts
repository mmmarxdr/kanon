import { describe, it, expect } from "vitest";
import { computeDragResult, groupByHorizon } from "../roadmap-board";
import type { RoadmapItem, Horizon } from "@/types/roadmap";

function makeItem(
  overrides: Partial<RoadmapItem> & { id: string; horizon: Horizon; sortOrder: number },
): RoadmapItem {
  return {
    title: `Item ${overrides.id}`,
    labels: [],
    promoted: false,
    status: "idea",
    projectId: "proj-1",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function buildScenario(items: RoadmapItem[]) {
  const grouped = groupByHorizon(items);
  return { items, grouped };
}

describe("computeDragResult", () => {
  it("returns null when dropping outside a valid target (unknown overId)", () => {
    const { items, grouped } = buildScenario([
      makeItem({ id: "a", horizon: "now", sortOrder: 1 }),
    ]);

    const result = computeDragResult("a", "nonexistent-id", items, grouped);
    expect(result).toBeNull();
  });

  it("returns null when activeId is not found in items", () => {
    const { items, grouped } = buildScenario([
      makeItem({ id: "a", horizon: "now", sortOrder: 1 }),
    ]);

    const result = computeDragResult("unknown", "a", items, grouped);
    expect(result).toBeNull();
  });

  describe("cross-column drag", () => {
    it("calls mutation with new horizon when dropping on a column droppable", () => {
      const { items, grouped } = buildScenario([
        makeItem({ id: "a", horizon: "now", sortOrder: 1 }),
      ]);

      const result = computeDragResult("a", "later", items, grouped);
      expect(result).toEqual({
        itemId: "a",
        horizon: "later",
        sortOrder: 1, // max(0) + 1 since "later" column is empty
      });
    });

    it("calls mutation with new horizon when dropping on a card in another column", () => {
      const { items, grouped } = buildScenario([
        makeItem({ id: "a", horizon: "now", sortOrder: 1 }),
        makeItem({ id: "b", horizon: "next", sortOrder: 3 }),
        makeItem({ id: "c", horizon: "next", sortOrder: 5 }),
      ]);

      const result = computeDragResult("a", "b", items, grouped);
      expect(result).toEqual({
        itemId: "a",
        horizon: "next",
        sortOrder: 6, // max(3, 5) + 1
      });
    });
  });

  describe("same-column reorder", () => {
    it("calls mutation with same horizon + new sortOrder when reordering within column", () => {
      const { items, grouped } = buildScenario([
        makeItem({ id: "a", horizon: "now", sortOrder: 1 }),
        makeItem({ id: "b", horizon: "now", sortOrder: 2 }),
        makeItem({ id: "c", horizon: "now", sortOrder: 3 }),
      ]);

      // Drag "a" (index 0) to position of "c" (index 2)
      const result = computeDragResult("a", "c", items, grouped);
      expect(result).not.toBeNull();
      expect(result!.itemId).toBe("a");
      expect(result!.horizon).toBe("now");
      // After removing "a", filtered = [b(2), c(3)]. insertAt = 2-1=1.
      // before = filtered[0].sortOrder = 2, after = filtered[1].sortOrder = 3
      // newSortOrder = (2+3)/2 = 2.5
      expect(result!.sortOrder).toBe(2.5);
    });

    it("computes sortOrder when moving card up", () => {
      const { items, grouped } = buildScenario([
        makeItem({ id: "a", horizon: "now", sortOrder: 1 }),
        makeItem({ id: "b", horizon: "now", sortOrder: 2 }),
        makeItem({ id: "c", horizon: "now", sortOrder: 3 }),
      ]);

      // Drag "c" (index 2) to position of "a" (index 0)
      const result = computeDragResult("c", "a", items, grouped);
      expect(result).not.toBeNull();
      expect(result!.itemId).toBe("c");
      expect(result!.horizon).toBe("now");
      // After removing "c", filtered = [a(1), b(2)]. insertAt = 0.
      // before = filtered[-1] = undefined → 0, after = filtered[0].sortOrder = 1
      // newSortOrder = (0+1)/2 = 0.5
      expect(result!.sortOrder).toBe(0.5);
    });
  });

  describe("same-position drop (no-op)", () => {
    it("returns null when card is dropped on itself", () => {
      const { items, grouped } = buildScenario([
        makeItem({ id: "a", horizon: "now", sortOrder: 1 }),
        makeItem({ id: "b", horizon: "now", sortOrder: 2 }),
      ]);

      const result = computeDragResult("a", "a", items, grouped);
      expect(result).toBeNull();
    });
  });

  describe("dropping on column droppable (horizon string) for same horizon", () => {
    it("returns null because overId is a horizon string and over item is not found", () => {
      // When dropped on the column droppable (not a card) within the same horizon,
      // the same-horizon branch tries to find the over item by UUID but gets
      // the horizon string, which is not a card id → returns null
      const { items, grouped } = buildScenario([
        makeItem({ id: "a", horizon: "now", sortOrder: 1 }),
      ]);

      const result = computeDragResult("a", "now", items, grouped);
      expect(result).toBeNull();
    });
  });
});
