import { describe, it, expect, vi, afterEach } from "vitest";
import { renderHook } from "@testing-library/react";
import type { RoadmapItem } from "@/types/roadmap";
import { useTimelineData } from "../use-timeline-data";

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
    createdAt: "2026-01-15T00:00:00Z",
    updatedAt: "2026-01-15T00:00:00Z",
    ...overrides,
  };
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

describe("useTimelineData", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns empty groups and zero domain for empty input", () => {
    const { result } = renderHook(() => useTimelineData([]));
    expect(result.current.groups).toEqual([]);
    expect(result.current.domain).toEqual([0, 0]);
  });

  it("groups items by horizon", () => {
    const items = [
      makeItem({ id: "1", horizon: "now" }),
      makeItem({ id: "2", horizon: "now" }),
      makeItem({ id: "3", horizon: "later" }),
    ];
    const { result } = renderHook(() => useTimelineData(items));

    // HORIZONS order: someday, later, next, now — but empty ones excluded
    const horizons = result.current.groups.map((g) => g.horizon);
    expect(horizons).toContain("now");
    expect(horizons).toContain("later");
    expect(horizons).not.toContain("someday");
    expect(horizons).not.toContain("next");

    const nowGroup = result.current.groups.find((g) => g.horizon === "now");
    expect(nowGroup?.items).toHaveLength(2);

    const laterGroup = result.current.groups.find((g) => g.horizon === "later");
    expect(laterGroup?.items).toHaveLength(1);
  });

  it("computes relative domain with 7-day padding", () => {
    const items = [
      makeItem({
        id: "1",
        createdAt: "2026-01-15T00:00:00Z",
        targetDate: "2026-04-01T00:00:00Z",
      }),
    ];
    const { result } = renderHook(() => useTimelineData(items));

    const minTs = new Date("2026-01-15T00:00:00Z").getTime();
    const maxTs = new Date("2026-04-01T00:00:00Z").getTime();
    const domainStart = minTs - SEVEN_DAYS_MS;

    // Domain is relative: [0, totalRange]
    expect(result.current.domain[0]).toBe(0);
    expect(result.current.domain[1]).toBe(maxTs + SEVEN_DAYS_MS - domainStart);
    // domainStart is exposed for tick formatting
    expect(result.current.domainStart).toBe(domainStart);
  });

  it("detects open-ended items (no targetDate)", () => {
    const items = [
      makeItem({ id: "1", targetDate: "2026-06-01T00:00:00Z" }),
      makeItem({ id: "2", targetDate: null }),
      makeItem({ id: "3" }), // targetDate undefined
    ];
    const { result } = renderHook(() => useTimelineData(items));

    const allItems = result.current.groups.flatMap((g) => g.items);
    const item1 = allItems.find((i) => i.id === "1");
    const item2 = allItems.find((i) => i.id === "2");
    const item3 = allItems.find((i) => i.id === "3");

    expect(item1?.isOpenEnded).toBe(false);
    expect(item2?.isOpenEnded).toBe(true);
    expect(item3?.isOpenEnded).toBe(true);
  });

  it("computes correct relative offset and duration for items with targetDate", () => {
    const createdAt = "2026-01-15T00:00:00Z";
    const targetDate = "2026-04-01T00:00:00Z";
    const items = [makeItem({ id: "1", createdAt, targetDate })];

    const { result } = renderHook(() => useTimelineData(items));
    const item = result.current.groups[0]?.items[0];

    // Offset is relative to domain start (createdAt - 7 days)
    const domainStart = new Date(createdAt).getTime() - SEVEN_DAYS_MS;
    const expectedOffset = new Date(createdAt).getTime() - domainStart; // = SEVEN_DAYS_MS
    const expectedDuration =
      new Date(targetDate).getTime() - new Date(createdAt).getTime();

    expect(item?.offset).toBe(expectedOffset);
    expect(item?.duration).toBe(expectedDuration);
  });

  it("uses today as end date for open-ended items", () => {
    const now = new Date("2026-03-24T12:00:00Z").getTime();
    vi.spyOn(Date, "now").mockReturnValue(now);

    const createdAt = "2026-01-15T00:00:00Z";
    const items = [makeItem({ id: "1", createdAt, targetDate: null })];

    const { result } = renderHook(() => useTimelineData(items));
    const item = result.current.groups[0]?.items[0];

    const expectedDuration = now - new Date(createdAt).getTime();
    expect(item?.duration).toBe(expectedDuration);
  });

  it("truncates item names at 30 characters", () => {
    const longTitle = "This is a very long roadmap item title that exceeds thirty characters";
    const items = [makeItem({ id: "1", title: longTitle })];

    const { result } = renderHook(() => useTimelineData(items));
    const item = result.current.groups[0]?.items[0];

    expect(item?.name.length).toBeLessThanOrEqual(30);
    expect(item?.name).toContain("\u2026"); // ellipsis
  });

  it("preserves short names without truncation", () => {
    const items = [makeItem({ id: "1", title: "Short title" })];

    const { result } = renderHook(() => useTimelineData(items));
    const item = result.current.groups[0]?.items[0];

    expect(item?.name).toBe("Short title");
  });

  it("orders groups by HORIZONS constant (someday, later, next, now)", () => {
    const items = [
      makeItem({ id: "1", horizon: "now" }),
      makeItem({ id: "2", horizon: "someday" }),
      makeItem({ id: "3", horizon: "later" }),
    ];
    const { result } = renderHook(() => useTimelineData(items));

    const horizons = result.current.groups.map((g) => g.horizon);
    expect(horizons).toEqual(["someday", "later", "now"]);
  });
});
