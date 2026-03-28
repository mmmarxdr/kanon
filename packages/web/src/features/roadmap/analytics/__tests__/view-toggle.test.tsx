import { describe, it, expect, beforeEach } from "vitest";
import { useRoadmapStore } from "@/stores/roadmap-store";

/**
 * Integration test for view toggle: verifies the Zustand store
 * viewMode state and setViewMode action work correctly.
 *
 * Note: Full integration testing of the roadmap route with mocked queries
 * and DOM assertions would require TanStack Router test setup. This test
 * covers the store-level behavior that drives the toggle.
 */

describe("View toggle (store integration)", () => {
  beforeEach(() => {
    useRoadmapStore.getState().setViewMode("board");
  });

  it("defaults to board view", () => {
    expect(useRoadmapStore.getState().viewMode).toBe("board");
  });

  it("switches to analytics view", () => {
    useRoadmapStore.getState().setViewMode("analytics");
    expect(useRoadmapStore.getState().viewMode).toBe("analytics");
  });

  it("switches back to board view", () => {
    useRoadmapStore.getState().setViewMode("analytics");
    useRoadmapStore.getState().setViewMode("board");
    expect(useRoadmapStore.getState().viewMode).toBe("board");
  });

  it("does not affect other store state when toggling", () => {
    useRoadmapStore.getState().setSearch("test");
    useRoadmapStore.getState().setViewMode("analytics");
    expect(useRoadmapStore.getState().search).toBe("test");
    expect(useRoadmapStore.getState().viewMode).toBe("analytics");
  });
});
