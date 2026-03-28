import { describe, it, expect } from "vitest";
import { HORIZON_CHART_COLORS, STATUS_CHART_COLORS } from "../chart-colors";
import type { Horizon, RoadmapStatus } from "@/types/roadmap";

const ALL_HORIZONS: Horizon[] = ["now", "next", "later", "someday"];
const ALL_STATUSES: RoadmapStatus[] = ["idea", "planned", "in_progress", "done"];

describe("HORIZON_CHART_COLORS", () => {
  it("has an entry for every horizon", () => {
    for (const h of ALL_HORIZONS) {
      expect(HORIZON_CHART_COLORS[h]).toBeDefined();
      expect(HORIZON_CHART_COLORS[h]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("has exactly 4 entries", () => {
    expect(Object.keys(HORIZON_CHART_COLORS)).toHaveLength(4);
  });
});

describe("STATUS_CHART_COLORS", () => {
  it("has an entry for every status", () => {
    for (const s of ALL_STATUSES) {
      expect(STATUS_CHART_COLORS[s]).toBeDefined();
      expect(STATUS_CHART_COLORS[s]).toMatch(/^#[0-9A-Fa-f]{6}$/);
    }
  });

  it("has exactly 4 entries", () => {
    expect(Object.keys(STATUS_CHART_COLORS)).toHaveLength(4);
  });
});
