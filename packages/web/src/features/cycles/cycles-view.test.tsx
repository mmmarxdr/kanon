import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import type { CycleDetail } from "@/types/cycle";
import { BurnupChart } from "./cycles-view";

// -----------------------------------------------------------------------
// Fixture helpers
// -----------------------------------------------------------------------

function makeCycleDetail(overrides: Partial<CycleDetail> = {}): CycleDetail {
  return {
    id: "cycle-test",
    name: "Sprint Test",
    goal: null,
    state: "active",
    startDate: "2026-04-01",
    endDate: "2026-04-02",
    velocity: null,
    projectId: "proj-1",
    createdAt: "2026-04-01T00:00:00Z",
    updatedAt: "2026-04-01T00:00:00Z",
    issues: [],
    scopeEvents: [],
    dayIndex: 0,
    days: 1,
    scope: 5,
    completed: 0,
    scopeAdded: 0,
    scopeRemoved: 0,
    burnup: [0],
    scopeLine: [5],
    risks: [],
    ...overrides,
  };
}

// -----------------------------------------------------------------------
// BurnupChart — D-tick label deduplication
// -----------------------------------------------------------------------

describe("BurnupChart", () => {
  describe("D-tick labels with days=1 (short cycle)", () => {
    it("renders only distinct D-tick labels — no duplicates", () => {
      const cycle = makeCycleDetail({ days: 1 });
      const { container } = render(<BurnupChart cycle={cycle} />);

      // Gather all <text> elements in the SVG that match the D\d+ pattern
      const allTextEls = Array.from(container.querySelectorAll("text"));
      const dTickLabels = allTextEls
        .map((el) => el.textContent ?? "")
        .filter((t) => /^D\d+$/.test(t));

      // Must have labels
      expect(dTickLabels.length).toBeGreaterThan(0);

      // All labels must be unique
      const unique = new Set(dTickLabels);
      expect(unique.size).toBe(dTickLabels.length);
    });
  });

  describe("D-tick labels with days=2 (another short cycle)", () => {
    it("renders only distinct D-tick labels — no duplicates", () => {
      const cycle = makeCycleDetail({
        days: 2,
        burnup: [0, 1, 2],
        scopeLine: [5, 5, 5],
      });
      const { container } = render(<BurnupChart cycle={cycle} />);

      const allTextEls = Array.from(container.querySelectorAll("text"));
      const dTickLabels = allTextEls
        .map((el) => el.textContent ?? "")
        .filter((t) => /^D\d+$/.test(t));

      expect(dTickLabels.length).toBeGreaterThan(0);
      const unique = new Set(dTickLabels);
      expect(unique.size).toBe(dTickLabels.length);
    });
  });

  describe("D-tick labels with days=14 (normal cycle)", () => {
    it("renders expected D-tick labels without duplicates", () => {
      const cycle = makeCycleDetail({ days: 14 });
      const { container } = render(<BurnupChart cycle={cycle} />);

      const allTextEls = Array.from(container.querySelectorAll("text"));
      const dTickLabels = allTextEls
        .map((el) => el.textContent ?? "")
        .filter((t) => /^D\d+$/.test(t));

      expect(dTickLabels).toContain("D0");
      expect(dTickLabels).toContain("D14");

      const unique = new Set(dTickLabels);
      expect(unique.size).toBe(dTickLabels.length);
    });
  });
});
