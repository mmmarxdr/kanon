# ADR-0009: Scoping the schedule-timeline read (filter + cap)

- Status: Proposed
- Date: 2026-06-24
- Epic: ppm-foundation
- Issue: KAN-153
- Related: ADR-0004 (scheduling model), ADR-0003 (critical path is read-model output), ADR-0007 (working calendar)

## Context

`GET /api/projects/:key/schedule-timeline` (`timeline-service.getProjectScheduleTimeline`) returns **every** issue in the project with no filter or bound. Observed in prod: one project returned 146 rows in a single payload. The Gantt renders all of them — payload size, render cost, and an unreadable timeline all grow without limit.

Key structural fact that shapes the fix: **compute and read are already separate.**
- **Compute** — `rebuildProjectForecast(projectId)` (forecast/listener.ts + service.ts) recomputes the *whole project* forecast on any relevant change, trailing-debounced (`FORECAST_DEBOUNCE_MS`, default 3000ms), and persists `IssueForecast` rows. Critical path and float are computed over the **full dependency graph**.
- **Read** — `getProjectScheduleTimeline` only *reads* the persisted schedule + forecast + dependency rows. It computes nothing.

Therefore KAN-153 is a **read-scoping** problem, not a compute problem. Scoping the read does not touch the recompute, and the persisted `critical`/`floatDays` stay correct because they were computed globally — a subset just *displays* already-correct values.

The user's framing holds: you always look at the schedule **by sprint or by date window**, never as a 200-row dump. Classic offset/limit pagination is the wrong model for a Gantt (a timeline split across "pages" is unreadable). The right model is **windowing** (cycle or date range) plus a **hard server cap** as a backstop.

## Decision

1. **Scope the read; leave the compute global and untouched.** No change to `rebuildProjectForecast`. The endpoint gains optional filters and a cap.

2. **Filter contract** on `GET /api/projects/:key/schedule-timeline`:
   - `cycleId` (uuid) — only issues in that cycle (+ neighbors, see #4).
   - `from`, `to` (ISO date) — issues whose plan span `[startDate,dueDate]` **or** forecast span `[forecastStart,forecastEnd]` overlaps `[from,to]` (+ neighbors).
   - `limit` (int, default = cap) — server cap, never exceeded.

3. **Default scope when no filter is given:** the **active cycle** if the project has one; otherwise a **date window around today** (today − 2 weeks … today + 6 weeks). Escape hatch for genuinely small projects: if the whole project has **≤ `SMALL_PROJECT_THRESHOLD` (60)** issues, return everything (a sub-60-row Gantt is fine and forcing a window on it is annoying). This threshold is **separate from and much smaller than the cap** — the prod case (~146 issues) is above it, so it *does* get scoped by default (which is the whole point; 146 issues must not all come back by default).

4. **Cross-boundary dependencies → pull in 1-hop neighbors.** After resolving the scoped set, any issue referenced by an in-scope dependency edge (as source or target) that falls outside the scope is included as a **neighbor row** flagged `isNeighbor: true`. This keeps dependency arrows anchored on both ends (the Gantt's `DepArrows` drops edges whose target is absent) instead of silently losing them. Neighbors are 1-hop only — no transitive expansion — to keep the set bounded.

5. **Hard cap = 250 rows (incl. neighbors).** If the scoped+neighbor set exceeds 250, truncate to 250 and set `truncated: true`. The cap is a backstop, not the primary mechanism — a well-scoped window/cycle is almost always far under it. Note the cap (250, a safety ceiling) and the small-project escape-hatch threshold (60, "don't bother scoping") are deliberately different numbers and must not be collapsed into one constant.

6. **Response becomes an envelope** (was a bare array):
   ```
   { rows: ScheduleTimelineRow[], total: number, truncated: boolean }
   ```
   `total` = full count matching the filter before the cap, so the UI can show "showing N of M" and prompt the user to narrow. `rows` includes neighbor rows (flagged). Unscheduled issues (null plan/forecast dates) match no date window — they surface only via a cycle filter or the small-project escape hatch, never via a `from/to` window.

7. **Frontend drives the filter.** `use-project-schedule-timeline` takes `{ cycleId?, from?, to? }`; the Gantt supplies them from its current cycle filter and/or visible time domain, and refetches on change. Neighbor rows render muted (ghost) and are excluded from the tier filters and the "showing N of M" count of *in-scope* work.

## Consequences

- Payloads and render cost scale with the **visible window**, not the project size. Prod's 146-row dump becomes "active cycle" (a handful) by default.
- Zero risk to forecast correctness: compute stays whole-graph; the read only narrows what is displayed.
- Dependency arrows stay correct across the window edge thanks to 1-hop neighbors; deeper chains that leave the window are intentionally not drawn (bounded set).
- One extra query for neighbor expansion (resolve dep-referenced ids outside the scope). Bounded by the in-scope dep count.
- The response shape changes from `T[]` to `{ rows, total, truncated }` — a breaking change to the endpoint contract; the shared schema and the one client are updated together.
- SSE invalidation (KAN-105 PR3) re-fetches the *current window* after a rebuild — no interaction problem.

## Alternatives considered

| Option | Rejected because |
|--------|------------------|
| Offset/limit pagination | A Gantt split across numbered pages is unreadable; you navigate a timeline by time/cycle, not page index. |
| Incremental / partial forecast recompute | The compute is not the bottleneck (the read is), and partial CPM recompute risks wrong critical/float on cross-boundary edges. Out of scope. |
| Scope the compute too (forecast only the window) | Critical path needs the full graph; forecasting a window in isolation drops predecessors/successors and produces wrong slip/float. The whole point is to *not* touch compute. |
| Hide cross-boundary deps instead of neighbors | Loses the "this slips because of something off-screen" signal — the most important thing a schedule view conveys. 1-hop neighbors keep it for one bounded step. |
| Keep the bare-array response, add an `X-Total-Count` header | Truncation + neighbor flags need structured fields; a header-only signal is easy to miss and can't carry per-row `isNeighbor`. |
