/**
 * Unit tests for schedule timeline service (KAN-105 PR1).
 *
 * Tests the serializeTimelineRow mapping function in isolation:
 * - Decimal → string convention (estimateHours not on row, but progress int)
 * - Date → ISO string convention
 * - Null-safety: issues with no schedule or forecast row → all date fields null
 * - Forecast fields: slipDays, critical, floatDays from IssueForecast
 */

import { describe, it, expect } from "vitest";
import { serializeTimelineRow } from "./timeline-service.js";

const BASE_ISSUE = {
  id: "00000000-0000-0000-0000-000000000001",
  key: "T-1",
  title: "Test issue",
  state: "backlog" as const,
  type: "task" as const,
};

describe("serializeTimelineRow", () => {
  it("STR-1: maps a fully-scheduled+forecast issue to all fields populated", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        dueDate: new Date("2026-07-31T00:00:00.000Z"),
        progress: 42,
        baselineStart: new Date("2026-06-01T00:00:00.000Z"),
        baselineEnd: new Date("2026-06-30T00:00:00.000Z"),
      },
      forecast: {
        forecastStart: new Date("2026-07-05T00:00:00.000Z"),
        forecastEnd: new Date("2026-08-05T00:00:00.000Z"),
        slipDays: 5,
        critical: true,
        floatDays: 3,
      },
    });

    expect(row.issueId).toBe("00000000-0000-0000-0000-000000000001");
    expect(row.issueKey).toBe("T-1");
    expect(row.title).toBe("Test issue");
    expect(row.state).toBe("backlog");
    expect(row.type).toBe("task");

    // Plan plane
    expect(row.startDate).toBe("2026-07-01T00:00:00.000Z");
    expect(row.dueDate).toBe("2026-07-31T00:00:00.000Z");
    expect(row.progress).toBe(42);

    // Baseline plane
    expect(row.baselineStart).toBe("2026-06-01T00:00:00.000Z");
    expect(row.baselineEnd).toBe("2026-06-30T00:00:00.000Z");

    // Forecast plane
    expect(row.forecastStart).toBe("2026-07-05T00:00:00.000Z");
    expect(row.forecastEnd).toBe("2026-08-05T00:00:00.000Z");
    expect(row.slipDays).toBe(5);
    expect(row.critical).toBe(true);
    expect(row.floatDays).toBe(3);
  });

  it("STR-2: maps an issue with no schedule → all plan/baseline/forecast fields null", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: null,
      forecast: null,
    });

    expect(row.issueId).toBe("00000000-0000-0000-0000-000000000001");
    expect(row.progress).toBe(0);
    expect(row.startDate).toBeNull();
    expect(row.dueDate).toBeNull();
    expect(row.baselineStart).toBeNull();
    expect(row.baselineEnd).toBeNull();
    expect(row.forecastStart).toBeNull();
    expect(row.forecastEnd).toBeNull();
    expect(row.slipDays).toBeNull();
    expect(row.critical).toBeNull();
    expect(row.floatDays).toBeNull();
  });

  it("STR-3: maps an issue with schedule-only (no forecast) → forecast fields null", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        dueDate: null,
        progress: 10,
        baselineStart: null,
        baselineEnd: null,
      },
      forecast: null,
    });

    expect(row.startDate).toBe("2026-07-01T00:00:00.000Z");
    expect(row.dueDate).toBeNull();
    expect(row.progress).toBe(10);
    expect(row.forecastStart).toBeNull();
    expect(row.forecastEnd).toBeNull();
    expect(row.slipDays).toBeNull();
    expect(row.critical).toBeNull();
    expect(row.floatDays).toBeNull();
  });

  it("STR-5: maps an issue with forecast-only (no schedule) → plan/baseline null, forecast populated", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: null,
      forecast: {
        forecastStart: new Date("2026-09-01T00:00:00.000Z"),
        forecastEnd: new Date("2026-09-30T00:00:00.000Z"),
        slipDays: 7,
        critical: true,
        floatDays: 0,
      },
    });

    // Plan plane — all null because no schedule row
    expect(row.startDate).toBeNull();
    expect(row.dueDate).toBeNull();
    expect(row.progress).toBe(0);

    // Baseline plane — all null because no schedule row
    expect(row.baselineStart).toBeNull();
    expect(row.baselineEnd).toBeNull();

    // Forecast plane — populated from IssueForecast row
    expect(row.forecastStart).toBe("2026-09-01T00:00:00.000Z");
    expect(row.forecastEnd).toBe("2026-09-30T00:00:00.000Z");
    expect(row.slipDays).toBe(7);
    expect(row.critical).toBe(true);
    expect(row.floatDays).toBe(0);
  });

  it("STR-4: null dates in schedule remain null (not converted)", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: {
        startDate: null,
        dueDate: null,
        progress: 0,
        baselineStart: null,
        baselineEnd: null,
      },
      forecast: {
        forecastStart: null,
        forecastEnd: null,
        slipDays: 0,
        critical: false,
        floatDays: null,
      },
    });

    expect(row.startDate).toBeNull();
    expect(row.dueDate).toBeNull();
    expect(row.forecastStart).toBeNull();
    expect(row.forecastEnd).toBeNull();
    expect(row.floatDays).toBeNull();
    expect(row.slipDays).toBe(0);
    expect(row.critical).toBe(false);
  });

  it("STR-6: maps outgoing dependency edges to deps[] (KAN-149)", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: null,
      forecast: null,
      blocks: [
        { targetId: "00000000-0000-0000-0000-0000000000aa", type: "FS", lagDays: 2 },
        { targetId: "00000000-0000-0000-0000-0000000000bb", type: "SS", lagDays: 0 },
      ],
    });

    expect(row.deps).toEqual([
      { targetIssueId: "00000000-0000-0000-0000-0000000000aa", type: "FS", lagDays: 2 },
      { targetIssueId: "00000000-0000-0000-0000-0000000000bb", type: "SS", lagDays: 0 },
    ]);
  });

  it("STR-7: missing blocks relation → deps is an empty array", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: null,
      forecast: null,
    });
    expect(row.deps).toEqual([]);
  });
});
