/**
 * engine-calendar.test.ts — KAN-147 (ADR-0007)
 *
 * Pure unit suite for the WorkingCalendar helpers and calendar-aware forecast.
 * ZERO Prisma imports — all functions are tested on plain objects.
 *
 * Strict TDD: written RED first, then engine implemented to GREEN.
 *
 * Calendar semantics (ADR-0007 decision #1/#3):
 *   - workDays: number[] of UTC weekday indices (0=Sun..6=Sat), default [1..5].
 *   - holidays: Set<ISODate> of "YYYY-MM-DD" (UTC) strings.
 *   - addWorkingDays(date, n): step forward n WORKING days; n=0 snaps forward
 *     to the next working day. Negative n steps backward.
 *   - workingDaysBetween(start, end): inverse of addWorkingDays.
 *   - When no calendar is supplied to computeForecast, behaviour is unchanged
 *     (every calendar day is a working day → addDays).
 */

import { describe, it, expect } from "vitest";
import {
  isWorkingDay,
  addWorkingDays,
  workingDaysBetween,
  computeForecast,
  type WorkingCalendar,
} from "./engine.js";
import type { ForecastNode, ForecastEdge } from "./types.js";

// ─── Helpers ─────────────────────────────────────────────────────────────────

const MON_FRI: WorkingCalendar = {
  workDays: [1, 2, 3, 4, 5],
  holidays: new Set<string>(),
};

/** UTC midnight date for an ISO YYYY-MM-DD string. */
function utc(iso: string): Date {
  return new Date(`${iso}T00:00:00.000Z`);
}

/** ISO YYYY-MM-DD (UTC) of a date. */
function isoOf(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function node(overrides: Partial<ForecastNode> & { issueId: string }): ForecastNode {
  return {
    startDate: null,
    dueDate: null,
    estimateHours: null,
    progress: 0,
    state: "backlog",
    completedAt: null,
    loggedH: 0,
    interruptedDays: 0,
    ...overrides,
  };
}

// ─── isWorkingDay ──────────────────────────────────────────────────────────

describe("isWorkingDay", () => {
  it("Mon–Fri are working days, Sat/Sun are not", () => {
    // 2026-06-22 is a Monday, 2026-06-28 is a Sunday.
    expect(isWorkingDay(utc("2026-06-22"), MON_FRI)).toBe(true); // Mon
    expect(isWorkingDay(utc("2026-06-26"), MON_FRI)).toBe(true); // Fri
    expect(isWorkingDay(utc("2026-06-27"), MON_FRI)).toBe(false); // Sat
    expect(isWorkingDay(utc("2026-06-28"), MON_FRI)).toBe(false); // Sun
  });

  it("a holiday on a normal working day is not a working day", () => {
    const cal: WorkingCalendar = {
      workDays: [1, 2, 3, 4, 5],
      holidays: new Set(["2026-06-24"]), // a Wednesday
    };
    expect(isWorkingDay(utc("2026-06-24"), cal)).toBe(false);
    expect(isWorkingDay(utc("2026-06-25"), cal)).toBe(true);
  });
});

// ─── addWorkingDays ──────────────────────────────────────────────────────────

describe("addWorkingDays", () => {
  it("n=0 returns the same date when already a working day", () => {
    // 2026-06-22 Monday
    expect(isoOf(addWorkingDays(utc("2026-06-22"), 0, MON_FRI))).toBe("2026-06-22");
  });

  it("n=0 snaps forward to the next working day when on a weekend", () => {
    // 2026-06-27 Saturday → next working day 2026-06-29 Monday
    expect(isoOf(addWorkingDays(utc("2026-06-27"), 0, MON_FRI))).toBe("2026-06-29");
  });

  it("skips weekends stepping forward", () => {
    // Friday 2026-06-26 + 1 working day → Monday 2026-06-29
    expect(isoOf(addWorkingDays(utc("2026-06-26"), 1, MON_FRI))).toBe("2026-06-29");
  });

  it("a 5-working-day task starting Thursday lands the next Wednesday (crosses a weekend)", () => {
    // Thursday 2026-06-25 + 5 working days:
    // Fri(1) Mon(2) Tue(3) Wed(4) Thu(5)? Let's count: start Thu 06-25.
    // +1 Fri 06-26, +2 Mon 06-29, +3 Tue 06-30, +4 Wed 07-01, +5 Thu 07-02
    expect(isoOf(addWorkingDays(utc("2026-06-25"), 5, MON_FRI))).toBe("2026-07-02");
  });

  it("skips holidays", () => {
    const cal: WorkingCalendar = {
      workDays: [1, 2, 3, 4, 5],
      holidays: new Set(["2026-06-25"]), // Thursday holiday
    };
    // Wednesday 2026-06-24 + 1 working day skips Thu holiday → Fri 2026-06-26
    expect(isoOf(addWorkingDays(utc("2026-06-24"), 1, cal))).toBe("2026-06-26");
  });

  it("steps backward for negative n", () => {
    // Monday 2026-06-29 - 1 working day → Friday 2026-06-26
    expect(isoOf(addWorkingDays(utc("2026-06-29"), -1, MON_FRI))).toBe("2026-06-26");
  });

  it("does not hang when workDays is empty (treated as all-days fallback)", () => {
    const broken: WorkingCalendar = { workDays: [], holidays: new Set() };
    // Must terminate; with an empty calendar we fall back to plain calendar days.
    const out = addWorkingDays(utc("2026-06-22"), 3, broken);
    expect(out).toBeInstanceOf(Date);
    expect(isoOf(out)).toBe("2026-06-25");
  });
});

// ─── workingDaysBetween ──────────────────────────────────────────────────────

describe("workingDaysBetween", () => {
  it("is the inverse of addWorkingDays for working-day anchors", () => {
    const start = utc("2026-06-25"); // Thursday — a working day
    for (const n of [0, 1, 3, 5, 10, 22]) {
      const end = addWorkingDays(start, n, MON_FRI);
      expect(workingDaysBetween(start, end, MON_FRI)).toBe(n);
    }
  });

  it("round-trips for a SATURDAY start (CRITICAL: snap must be applied before both sides)", () => {
    // Without snap, addWorkingDays(Sat, 1) = Tue (snaps to Mon first, then +1)
    // but workingDaysBetween(Sat, Tue) = 2 (Mon + Tue after Sat), breaking the inverse.
    // With snap applied to the anchor before both calls, the round-trip holds.
    const satStart = utc("2026-06-27"); // Saturday
    for (const n of [0, 1, 3, 5]) {
      const end = addWorkingDays(satStart, n, MON_FRI);
      // After snap: effective anchor is Mon 06-29.
      // addWorkingDays(Sat, n) produces the same result as addWorkingDays(Mon, n).
      // workingDaysBetween(Sat, end) must equal n (same snap applied to start).
      expect(workingDaysBetween(satStart, end, MON_FRI)).toBe(n);
    }
  });

  it("round-trips for a HOLIDAY start", () => {
    const cal: WorkingCalendar = {
      workDays: [1, 2, 3, 4, 5],
      holidays: new Set(["2026-06-24"]), // Wednesday holiday
    };
    const holStart = utc("2026-06-24"); // Wednesday holiday → snaps to Thu 06-25
    for (const n of [0, 1, 3, 5]) {
      const end = addWorkingDays(holStart, n, cal);
      expect(workingDaysBetween(holStart, end, cal)).toBe(n);
    }
  });

  it("counts a 5-working-day span across a weekend as 5, not 7 calendar days", () => {
    const start = utc("2026-06-25"); // Thu
    const end = utc("2026-07-02"); // Thu, 7 calendar days later
    expect(workingDaysBetween(start, end, MON_FRI)).toBe(5);
  });
});

// ─── Calendar threaded through computeForecast ───────────────────────────────

describe("computeForecast — working calendar", () => {
  it("forecasts a task that would land on a weekend onto a working day", () => {
    // Start Friday 2026-06-26, 8h estimate = 1 day span.
    // The clamp/span lands the end on a working day, never Sat/Sun.
    const nodes: ForecastNode[] = [
      node({
        issueId: "a",
        startDate: utc("2026-06-26"),
        estimateHours: 16, // 2 days
        progress: 0,
        state: "todo",
      }),
    ];
    const res = computeForecast(
      { nodes, edges: [], milestones: [] },
      { hoursPerDay: 8, calendar: MON_FRI, now: utc("2026-06-01") },
    );
    const entry = res.forecasts.get("a")!;
    expect(entry.forecastEnd).not.toBeNull();
    expect(isWorkingDay(entry.forecastEnd!, MON_FRI)).toBe(true);
  });

  it("an FS+2d lag is interpreted as 2 WORKING days", () => {
    // pred ends Friday 2026-06-26. Successor FS + 2 working days starts
    // Tue 2026-06-30 (Mon=+1, Tue=+2), not Sunday.
    const nodes: ForecastNode[] = [
      node({ issueId: "p", startDate: utc("2026-06-25"), estimateHours: 8, state: "todo" }),
      node({ issueId: "s", startDate: utc("2026-06-25"), estimateHours: 8, state: "todo" }),
    ];
    const edges: ForecastEdge[] = [
      { source: "p", target: "s", type: "FS", lagDays: 2 },
    ];
    const res = computeForecast(
      { nodes, edges, milestones: [] },
      { hoursPerDay: 8, calendar: MON_FRI, now: utc("2026-06-01") },
    );
    const s = res.forecasts.get("s")!;
    expect(isWorkingDay(s.forecastStart!, MON_FRI)).toBe(true);
    // pred (8h=1day) starts Thu 06-25 → ends Fri 06-26. +2 working days → Tue 06-30.
    expect(isoOf(s.forecastStart!)).toBe("2026-06-30");
  });

  it("a dependency chain with SATURDAY start produces correct concrete dates, floatDays, and critical", () => {
    // Node A starts Saturday 2026-06-27 (should snap to Mon 2026-06-29).
    // A: 8h = 1 working day → forecastStart Mon 06-29, exclusive Tue 06-30, inclusive Mon 06-29.
    // B depends on A via FS lag=0: starts Tue 06-30 (A exclusive), 8h = 1 day → exclusive Wed 07-01, inclusive Tue 06-30.
    // Both are on the critical path → floatDays=0, critical=true.
    const nodes: ForecastNode[] = [
      node({ issueId: "a", startDate: utc("2026-06-27"), estimateHours: 8, state: "todo" }),
      node({ issueId: "b", startDate: utc("2026-06-27"), estimateHours: 8, state: "todo" }),
    ];
    const edges: ForecastEdge[] = [{ source: "a", target: "b", type: "FS", lagDays: 0 }];
    const res = computeForecast(
      { nodes, edges, milestones: [] },
      { hoursPerDay: 8, calendar: MON_FRI, now: utc("2026-06-01") },
    );

    const a = res.forecasts.get("a")!;
    const b = res.forecasts.get("b")!;

    // A: snapped to Mon 06-29, 1 working day → inclusive Mon 06-29
    expect(isoOf(a.forecastStart!)).toBe("2026-06-29");
    expect(isoOf(a.forecastEnd!)).toBe("2026-06-29");

    // B: starts Tue 06-30 (A exclusive), 1 working day → inclusive Tue 06-30
    expect(isoOf(b.forecastStart!)).toBe("2026-06-30");
    expect(isoOf(b.forecastEnd!)).toBe("2026-06-30");

    // Both on critical path
    expect(a.critical).toBe(true);
    expect(b.critical).toBe(true);
    expect(a.floatDays).toBe(0);
    expect(b.floatDays).toBe(0);
  });

  it("a node with a HOLIDAY startDate has correct forecastStart and floatDays", () => {
    // Holiday Wednesday 2026-06-24 → snaps to Thu 06-25.
    // 8h = 1 working day → exclusive Fri 06-26, inclusive Thu 06-25.
    const cal: WorkingCalendar = {
      workDays: [1, 2, 3, 4, 5],
      holidays: new Set(["2026-06-24"]),
    };
    const nodes: ForecastNode[] = [
      node({ issueId: "a", startDate: utc("2026-06-24"), estimateHours: 8, state: "todo" }),
    ];
    const res = computeForecast(
      { nodes, edges: [], milestones: [] },
      { hoursPerDay: 8, calendar: cal, now: utc("2026-06-01") },
    );
    const a = res.forecasts.get("a")!;
    expect(isoOf(a.forecastStart!)).toBe("2026-06-25"); // snapped off holiday
    expect(isoOf(a.forecastEnd!)).toBe("2026-06-25"); // Thu + 1 wd exclusive=Fri, inclusive=Thu
    expect(a.floatDays).toBe(0);
    expect(a.critical).toBe(true);
  });

  it("a dependency chain across two weekends does not drift onto weekends (concrete dates)", () => {
    // A: starts Thu 06-25, 5 days (40h/8) → exclusive Thu 07-02, inclusive Wed 07-01 (crosses weekend 1).
    // B: starts Thu 07-02 (A exclusive), 5 days → exclusive Thu 07-09, inclusive Wed 07-08 (crosses weekend 2).
    // Both inclusive ends must land on working days; no weekend drift.
    const nodes: ForecastNode[] = [
      node({ issueId: "a", startDate: utc("2026-06-25"), estimateHours: 40, state: "todo" }),
      node({ issueId: "b", startDate: utc("2026-06-25"), estimateHours: 40, state: "todo" }),
    ];
    const edges: ForecastEdge[] = [{ source: "a", target: "b", type: "FS", lagDays: 0 }];
    const res = computeForecast(
      { nodes, edges, milestones: [] },
      { hoursPerDay: 8, calendar: MON_FRI, now: utc("2026-06-01") },
    );
    const a = res.forecasts.get("a")!;
    const b = res.forecasts.get("b")!;

    // A: Thu 06-25 + 5 wd exclusive=Thu 07-02, inclusive=Wed 07-01
    expect(isoOf(a.forecastStart!)).toBe("2026-06-25");
    expect(isoOf(a.forecastEnd!)).toBe("2026-07-01");

    // B: starts Thu 07-02 (A exclusive), +5 wd exclusive=Thu 07-09, inclusive=Wed 07-08
    expect(isoOf(b.forecastStart!)).toBe("2026-07-02");
    expect(isoOf(b.forecastEnd!)).toBe("2026-07-08");

    for (const id of ["a", "b"]) {
      const e = res.forecasts.get(id)!;
      expect(isWorkingDay(e.forecastStart!, MON_FRI)).toBe(true);
      expect(isWorkingDay(e.forecastEnd!, MON_FRI)).toBe(true);
    }
  });

  it("with no calendar, reproduces calendar-day behaviour (lands on a weekend)", () => {
    // No calendar → every day is a working day → addDays. A 2-day task from
    // Friday: exclusive Sunday 06-28, inclusive Saturday 06-27.
    const nodes: ForecastNode[] = [
      node({ issueId: "a", startDate: utc("2026-06-26"), estimateHours: 16, state: "todo" }),
    ];
    const res = computeForecast(
      { nodes, edges: [], milestones: [] },
      { hoursPerDay: 8, now: utc("2026-06-01") },
    );
    const entry = res.forecasts.get("a")!;
    // Friday 06-26 + 2 calendar days exclusive = Sunday 06-28, inclusive = Saturday 06-27.
    expect(isoOf(entry.forecastEnd!)).toBe("2026-06-27");
  });
});
