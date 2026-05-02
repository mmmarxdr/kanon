import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { useTimelineData } from "../use-timeline-data";

function makeItem(overrides: Partial<RoadmapItem> = {}): RoadmapItem {
  return {
    id: "x",
    title: "X",
    horizon: "now",
    status: "idea",
    labels: [],
    sortOrder: 0,
    promoted: false,
    projectId: "p",
    createdAt: "2026-04-26T00:00:00Z",
    updatedAt: "2026-04-26T00:00:00Z",
    effort: 3,
    impact: 5,
    ...overrides,
  };
}

describe("useTimelineData", () => {
  it("returns empty groups when no items", () => {
    const { result } = renderHook(() => useTimelineData([]));
    expect(result.current.groups).toEqual([]);
  });

  it("synthesizes bar positions inside the horizon's week range", () => {
    // now horizon range is [-1, 6]
    const items = [
      makeItem({ id: "a", horizon: "now", effort: 3 }),
      makeItem({ id: "b", horizon: "now", effort: 3 }),
    ];
    const { result } = renderHook(() => useTimelineData(items));
    const group = result.current.groups[0]!;
    for (const it of group.items) {
      expect(it.start).toBeGreaterThanOrEqual(-1);
      expect(it.end).toBeLessThanOrEqual(6);
      expect(it.end).toBeGreaterThan(it.start);
    }
  });

  it("staggers successive items within the same horizon", () => {
    const items = [
      makeItem({ id: "a", horizon: "next", effort: 2 }),
      makeItem({ id: "b", horizon: "next", effort: 2 }),
      makeItem({ id: "c", horizon: "next", effort: 2 }),
    ];
    const { result } = renderHook(() => useTimelineData(items));
    const itemsOut = result.current.groups[0]!.items;
    // Successive items must not all sit at the same start week.
    const uniqueStarts = new Set(itemsOut.map((i) => i.start));
    expect(uniqueStarts.size).toBeGreaterThan(1);
  });

  it("scales duration with effort (higher effort → wider bar)", () => {
    const items = [
      makeItem({ id: "low", horizon: "later", effort: 1 }),
      makeItem({ id: "high", horizon: "later", effort: 5 }),
    ];
    const { result } = renderHook(() => useTimelineData(items));
    const out = result.current.groups[0]!.items;
    const low = out.find((x) => x.id === "low")!;
    const high = out.find((x) => x.id === "high")!;
    expect(high.end - high.start).toBeGreaterThan(low.end - low.start);
  });

  it("falls back to a sensible default when effort is null", () => {
    const items = [makeItem({ id: "a", horizon: "now", effort: null })];
    const { result } = renderHook(() => useTimelineData(items));
    const it = result.current.groups[0]!.items[0]!;
    expect(it.end - it.start).toBeGreaterThanOrEqual(2);
  });

  it("groups items by horizon in HORIZONS order, dropping empty horizons", () => {
    const items = [
      makeItem({ id: "1", horizon: "later" }),
      makeItem({ id: "2", horizon: "now" }),
      makeItem({ id: "3", horizon: "now" }),
    ];
    const { result } = renderHook(() => useTimelineData(items));
    const horizons = result.current.groups.map((g) => g.horizon);
    expect(horizons).toEqual(["now", "later"]);
    expect(result.current.groups[0]!.items.length).toBe(2);
    expect(result.current.groups[1]!.items.length).toBe(1);
  });

  it("preserves effort, impact, status, title, id on each timeline item", () => {
    const items = [
      makeItem({
        id: "a",
        title: "Alpha",
        status: "in_progress",
        effort: 4,
        impact: 8,
      }),
    ];
    const { result } = renderHook(() => useTimelineData(items));
    const item = result.current.groups[0]!.items[0]!;
    expect(item.id).toBe("a");
    expect(item.title).toBe("Alpha");
    expect(item.status).toBe("in_progress");
    expect(item.effort).toBe(4);
    expect(item.impact).toBe(8);
  });
});
