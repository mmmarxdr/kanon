import { describe, it, expect } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import {
  useEffortImpactData,
  useHorizonData,
  useStatusData,
  usePromotionData,
  useAgingData,
} from "../use-analytics-data";

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

// ── useEffortImpactData ───────────────────────────────────────────

describe("useEffortImpactData", () => {
  it("returns empty array when no items", () => {
    const { result } = renderHook(() => useEffortImpactData([]));
    expect(result.current).toEqual([]);
  });

  it("filters out items with null effort or impact", () => {
    const items = [
      makeItem({ id: "1", effort: 3, impact: null }),
      makeItem({ id: "2", effort: null, impact: 4 }),
      makeItem({ id: "3", effort: 2, impact: 5 }),
    ];
    const { result } = renderHook(() => useEffortImpactData(items));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]!.id).toBe("3");
  });

  it("maps items with both effort and impact correctly", () => {
    const items = [
      makeItem({ id: "1", effort: 3, impact: 4, horizon: "next", title: "Test" }),
    ];
    const { result } = renderHook(() => useEffortImpactData(items));
    expect(result.current[0]!).toEqual({
      id: "1",
      title: "Test",
      effort: 3,
      impact: 4,
      horizon: "next",
    });
  });
});

// ── useHorizonData ────────────────────────────────────────────────

describe("useHorizonData", () => {
  it("returns all 4 horizons even with empty items", () => {
    const { result } = renderHook(() => useHorizonData([]));
    expect(result.current).toHaveLength(4);
    expect(result.current.every((d) => d.count === 0)).toBe(true);
  });

  it("counts items per horizon correctly", () => {
    const items = [
      makeItem({ id: "1", horizon: "now" }),
      makeItem({ id: "2", horizon: "now" }),
      makeItem({ id: "3", horizon: "later" }),
    ];
    const { result } = renderHook(() => useHorizonData(items));
    const nowBar = result.current.find((d) => d.horizon === "now");
    const laterBar = result.current.find((d) => d.horizon === "later");
    expect(nowBar?.count).toBe(2);
    expect(laterBar?.count).toBe(1);
  });

  it("includes fill color for each horizon", () => {
    const { result } = renderHook(() => useHorizonData([]));
    for (const bar of result.current) {
      expect(bar.fill).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });
});

// ── useStatusData ─────────────────────────────────────────────────

describe("useStatusData", () => {
  it("returns all 4 statuses even with empty items", () => {
    const { result } = renderHook(() => useStatusData([]));
    expect(result.current).toHaveLength(4);
    expect(result.current.every((d) => d.count === 0)).toBe(true);
  });

  it("counts items per status correctly", () => {
    const items = [
      makeItem({ id: "1", status: "idea" }),
      makeItem({ id: "2", status: "idea" }),
      makeItem({ id: "3", status: "done" }),
    ];
    const { result } = renderHook(() => useStatusData(items));
    const ideaSlice = result.current.find((d) => d.status === "idea");
    const doneSlice = result.current.find((d) => d.status === "done");
    expect(ideaSlice?.count).toBe(2);
    expect(doneSlice?.count).toBe(1);
  });
});

// ── usePromotionData ──────────────────────────────────────────────

describe("usePromotionData", () => {
  it("returns zero rate for empty items", () => {
    const { result } = renderHook(() => usePromotionData([]));
    expect(result.current).toEqual({ promoted: 0, total: 0, rate: 0 });
  });

  it("calculates promotion rate correctly", () => {
    const items = [
      makeItem({ id: "1", promoted: true }),
      makeItem({ id: "2", promoted: true }),
      makeItem({ id: "3", promoted: false }),
      makeItem({ id: "4", promoted: true }),
      makeItem({ id: "5", promoted: false }),
    ];
    const { result } = renderHook(() => usePromotionData(items));
    expect(result.current.promoted).toBe(3);
    expect(result.current.total).toBe(5);
    expect(result.current.rate).toBe(60);
  });

  it("returns 100% when all promoted", () => {
    const items = [
      makeItem({ id: "1", promoted: true }),
      makeItem({ id: "2", promoted: true }),
    ];
    const { result } = renderHook(() => usePromotionData(items));
    expect(result.current.rate).toBe(100);
  });
});

// ── useAgingData ──────────────────────────────────────────────────

describe("useAgingData", () => {
  it("returns empty array when no items", () => {
    const { result } = renderHook(() => useAgingData([]));
    expect(result.current).toEqual([]);
  });

  it("only includes items in idea status", () => {
    const oldDate = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const items = [
      makeItem({ id: "1", status: "idea", createdAt: oldDate }),
      makeItem({ id: "2", status: "planned", createdAt: oldDate }),
      makeItem({ id: "3", status: "done", createdAt: oldDate }),
    ];
    const { result } = renderHook(() => useAgingData(items));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]!.id).toBe("1");
  });

  it("filters by threshold days", () => {
    const thirtyOneDaysAgo = new Date(Date.now() - 31 * 86_400_000).toISOString();
    const tenDaysAgo = new Date(Date.now() - 10 * 86_400_000).toISOString();
    const items = [
      makeItem({ id: "1", status: "idea", createdAt: thirtyOneDaysAgo }),
      makeItem({ id: "2", status: "idea", createdAt: tenDaysAgo }),
    ];
    const { result } = renderHook(() => useAgingData(items, 30));
    expect(result.current).toHaveLength(1);
    expect(result.current[0]!.id).toBe("1");
  });

  it("sorts by age descending", () => {
    const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400_000).toISOString();
    const fortyDaysAgo = new Date(Date.now() - 40 * 86_400_000).toISOString();
    const items = [
      makeItem({ id: "1", status: "idea", createdAt: fortyDaysAgo }),
      makeItem({ id: "2", status: "idea", createdAt: sixtyDaysAgo }),
    ];
    const { result } = renderHook(() => useAgingData(items));
    expect(result.current[0]!.id).toBe("2");
    expect(result.current[1]!.id).toBe("1");
    expect(result.current[0]!.ageDays).toBeGreaterThan(result.current[1]!.ageDays);
  });

  it("supports custom threshold", () => {
    const fifteenDaysAgo = new Date(Date.now() - 15 * 86_400_000).toISOString();
    const items = [
      makeItem({ id: "1", status: "idea", createdAt: fifteenDaysAgo }),
    ];
    const { result } = renderHook(() => useAgingData(items, 10));
    expect(result.current).toHaveLength(1);

    const { result: result2 } = renderHook(() => useAgingData(items, 20));
    expect(result2.current).toHaveLength(0);
  });
});
