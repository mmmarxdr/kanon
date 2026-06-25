/**
 * Unit tests for schedule timeline service (KAN-105 PR1, KAN-153).
 *
 * Tests the serializeTimelineRow mapping function in isolation:
 * - Decimal → string convention (estimateHours not on row, but progress int)
 * - Date → ISO string convention
 * - Null-safety: issues with no schedule or forecast row → all date fields null
 * - Forecast fields: slipDays, critical, floatDays from IssueForecast
 * - KAN-153: isNeighbor flag
 *
 * getProjectScheduleTimeline is tested via the integration test suite
 * (schedule-timeline.integration.test.ts) which exercises scoping, neighbors,
 * cap/truncated, and the envelope response shape against a real DB.
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

  // KAN-153: isNeighbor flag
  it("STR-8: isNeighbor defaults to false when not provided", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: null,
      forecast: null,
    });
    expect(row.isNeighbor).toBe(false);
  });

  it("STR-9: isNeighbor=true is propagated when explicitly set", () => {
    const row = serializeTimelineRow(
      {
        ...BASE_ISSUE,
        schedule: null,
        forecast: null,
      },
      true,
    );
    expect(row.isNeighbor).toBe(true);
  });

  // ── Variance (KAN-152, ADR-0008 decision #5) ─────────────────────────────

  it("STR-VAR-1: planVsBaseline/forecastVsBaseline computed in whole days", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        dueDate: new Date("2026-07-10T00:00:00.000Z"), // +3d vs baselineEnd
        progress: 0,
        baselineStart: new Date("2026-07-01T00:00:00.000Z"),
        baselineEnd: new Date("2026-07-07T00:00:00.000Z"),
      },
      forecast: {
        forecastStart: new Date("2026-07-01T00:00:00.000Z"),
        forecastEnd: new Date("2026-07-12T00:00:00.000Z"), // +5d vs baselineEnd
        slipDays: 5,
        critical: false,
        floatDays: 0,
      },
    });

    expect(row.planVsBaseline).toBe(3);
    expect(row.forecastVsBaseline).toBe(5);
  });

  it("STR-VAR-2: negative variance when plan/forecast finish before baseline", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        dueDate: new Date("2026-07-05T00:00:00.000Z"), // -2d vs baselineEnd
        progress: 0,
        baselineStart: new Date("2026-07-01T00:00:00.000Z"),
        baselineEnd: new Date("2026-07-07T00:00:00.000Z"),
      },
      forecast: {
        forecastStart: new Date("2026-07-01T00:00:00.000Z"),
        forecastEnd: new Date("2026-07-04T00:00:00.000Z"), // -3d vs baselineEnd
        slipDays: 0,
        critical: false,
        floatDays: 0,
      },
    });

    expect(row.planVsBaseline).toBe(-2);
    expect(row.forecastVsBaseline).toBe(-3);
  });

  it("STR-VAR-3: null variance when no baseline is set", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        dueDate: new Date("2026-07-10T00:00:00.000Z"),
        progress: 0,
        baselineStart: null,
        baselineEnd: null,
      },
      forecast: {
        forecastStart: new Date("2026-07-01T00:00:00.000Z"),
        forecastEnd: new Date("2026-07-12T00:00:00.000Z"),
        slipDays: 5,
        critical: false,
        floatDays: 0,
      },
    });

    expect(row.planVsBaseline).toBeNull();
    expect(row.forecastVsBaseline).toBeNull();
  });

  it("STR-VAR-4: planVsBaseline null when dueDate absent; forecastVsBaseline null when forecastEnd absent", () => {
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        dueDate: null, // no plan finish → planVsBaseline null
        progress: 0,
        baselineStart: new Date("2026-07-01T00:00:00.000Z"),
        baselineEnd: new Date("2026-07-07T00:00:00.000Z"),
      },
      forecast: null, // no forecast row → forecastVsBaseline null
    });

    expect(row.planVsBaseline).toBeNull();
    expect(row.forecastVsBaseline).toBeNull();
  });

  it("STR-VAR-5: non-midnight timestamps are floored to UTC midnight before diff (DST-safe)", () => {
    // dueDate has a time component (14:30 UTC); baselineEnd has a different time (23:59 UTC).
    // Without midnight-flooring, the raw ms diff would round to the wrong integer.
    // With flooring: floor(2026-07-10T14:30) = 2026-07-10, floor(2026-07-07T23:59) = 2026-07-07 → +3d.
    const row = serializeTimelineRow({
      ...BASE_ISSUE,
      schedule: {
        startDate: new Date("2026-07-01T00:00:00.000Z"),
        dueDate: new Date("2026-07-10T14:30:00.000Z"),
        progress: 0,
        baselineStart: new Date("2026-07-01T00:00:00.000Z"),
        baselineEnd: new Date("2026-07-07T23:59:59.000Z"),
      },
      forecast: {
        forecastStart: new Date("2026-07-01T00:00:00.000Z"),
        forecastEnd: new Date("2026-07-12T01:00:00.000Z"), // floor → 2026-07-12, diff = +5d
        slipDays: 5,
        critical: false,
        floatDays: 0,
      },
    });

    expect(row.planVsBaseline).toBe(3);
    expect(row.forecastVsBaseline).toBe(5);
  });
});
