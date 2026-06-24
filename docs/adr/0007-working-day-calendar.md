# ADR-0007: Working-day calendar in the forecast engine

- Status: Proposed
- Date: 2026-06-24
- Epic: ppm-foundation (W4 — PPM Engine: Visible)
- Issue: KAN-147
- Related: ADR-0004 (scheduling model), ADR-0003 (critical path as read-model output)

## Context

The forecast engine converts hours to days with `ceil(hours / FORECAST_HOURS_PER_DAY)` **calendar** days and adds them with `addDays` — weekends and holidays are ignored (a documented v1 limitation). A 5-day task spanning a weekend forecasts ~2 days early; the error compounds across a typed-dependency chain, so multi-week forecasts drift roughly 30% over a quarter. This makes slip and float — the core signals of the W4 Gantt — quietly wrong on any horizon longer than a week.

`env.FORECAST_HOURS_PER_DAY` already exists. The duration math lives in `packages/api/src/modules/forecast/engine.ts` (`days()`, `addDays`, `spanDays`, `applyEdge`). The engine is pure and unit-tested; there is no calendar concept anywhere in the schema or config.

Open questions from exploration:
- Where does the calendar live — global config, or per-project?
- Is it a hard dependency of the engine, or an injected strategy so the pure functions stay testable?
- How are holidays sourced and how often do they change?

## Decision

1. **Introduce a `WorkingCalendar` value passed into the engine, not read from `env`.** Shape: `{ workDays: number[] /* 0–6, default [1,2,3,4,5] */, holidays: Set<ISODate> }`. The engine stays pure — the calendar is a parameter of `computeForecast`, exactly like `hoursPerDay` is today. No global singleton, no `Date`-based "is today a holiday" lookups inside pure functions.

2. **Calendar is project-level, with a Mon–Fri default.** A new `ProjectScheduleConfig` (1:1 with Project) holds `workDays Int[]` and a `holidays` list. Absent config → `[1,2,3,4,5]` and no holidays, so existing projects keep working with zero migration data. Kept off `Project` for the same isolation reason `IssueSchedule` is kept off `Issue` (ADR-0004 decision #1).

3. **Replace calendar-day arithmetic with working-day arithmetic at two points only:**
   - `days(hours, hoursPerDay)` keeps returning a *count* of working days (unchanged).
   - `addDays(date, n)` is replaced by `addWorkingDays(date, n, calendar)` — steps forward skipping non-working days. `forecastStart`/`forecastEnd` are snapped to the next working day if they land on one.
   - `lagDays` on dependency edges is interpreted as **working** days too, so a `FS + 2d` lag means two working days, consistent with duration.

4. **Holidays are a static per-project list, edited explicitly.** No external holiday-feed integration in this slice (YAGNI — feeds add a network dependency and a sync story for a list that changes a few times a year). A future ADR can add region presets if demand appears.

## Consequences

- Multi-week forecasts stop drifting; slip/float become trustworthy on quarter-length horizons.
- The engine signature gains one parameter; all call sites (`computeForecast`, `forecastEndFor`, `applyEdge`) thread the calendar through. Pure-function testability is preserved — tests pass a literal calendar.
- New `ProjectScheduleConfig` table + config surface (read/write). Additive migration; default-Mon–Fri means no backfill.
- `addWorkingDays` is O(n) in the day count per call; fine for issue-scale spans. A holiday `Set` lookup keeps the per-step check O(1).
- One ceiling to watch: an all-holiday or empty `workDays` calendar would loop forever in `addWorkingDays`. Guard with a validation that `workDays` is non-empty and a step cap.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Read calendar from `env` (like `FORECAST_HOURS_PER_DAY`) | Calendar is per-project data, not deployment config; env can't express per-project holidays and would force one global calendar. |
| Global single calendar table | Multi-project workspaces (different teams, regions) need different work weeks; a global calendar can't express that. |
| Inject calendar via a module-level singleton the engine reads | Breaks the engine's purity — the unit tests would need global setup/teardown; passing it as a parameter is simpler and explicit. |
| Integrate an external holiday feed now | Network dependency + sync story for a list that changes ~a dozen times a year; a static editable list covers the need. |
| Store forecast results pre-adjusted, keep engine calendar-naive | The drift is in the math, not the storage; adjusting after the fact can't fix dependency-chain propagation. |
