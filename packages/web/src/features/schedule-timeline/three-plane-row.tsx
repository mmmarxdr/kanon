/**
 * KAN-105 PR2 — ThreePlaneRow: renders one issue row with three vertically-
 * distinguishable Gantt planes using the timeline-scale pixel math.
 *
 * Planes (bottom to top by z-index):
 *   1. Baseline ghost — muted ghost behind the plan, shows original commitment.
 *   2. Plan bar       — solid colored bar, progress fill overlay.
 *   3. Forecast overlay — translucent accent outline, live reality.
 *   + Slip gap         — warn-colored gap from dueDate to forecastEnd when slipping.
 *
 * No drag, no mutations, no SSE — PR3.
 *
 * Styling mirrors the roadmap timeline-bar.tsx aesthetic using the same
 * CSS-var palette. Written from scratch — does NOT import from roadmap/.
 */

import type { CSSProperties } from "react";
import type { ScheduleTimelineRow } from "./use-project-schedule-timeline";
import { barBox, type DateDomain } from "./timeline-scale";

// ── Layout ───────────────────────────────────────────────────────────────────

const ROW_H = 36;
const BAR_H = 20;
/** Vertical offset so bars sit centred in the row. */
const BAR_TOP = (ROW_H - BAR_H) / 2;
/** Baseline ghost is shorter — sits slightly above centre. */
const GHOST_H = 10;
const GHOST_TOP = (ROW_H - GHOST_H) / 2;
/** Forecast overlay is a thin band that sits below the plan bar. */
const FORECAST_H = 6;
const FORECAST_TOP = BAR_TOP + BAR_H + 2;

// ── State token mapping ───────────────────────────────────────────────────────

interface StateTokens {
  background: string;
  border: string;
}

function tokensForState(state: string): StateTokens {
  switch (state) {
    case "in_progress":
      return {
        background: "color-mix(in oklch, var(--accent) 18%, var(--panel))",
        border: "var(--accent)",
      };
    case "done":
      return {
        background: "color-mix(in oklch, var(--ok) 14%, var(--panel))",
        border: "var(--ok)",
      };
    case "todo":
    case "planned":
      return {
        background: "var(--panel)",
        border: "var(--line-2)",
      };
    default:
      return {
        background: "var(--bg-3)",
        border: "var(--line-2)",
      };
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ThreePlaneRowProps {
  row: ScheduleTimelineRow;
  domain: DateDomain;
  trackWidth: number;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders the three planes + slip gap for one issue row.
 * The parent (ScheduleGantt) positions this absolutely; this component only
 * handles the horizontal/vertical geometry within a single row.
 */
export function ThreePlaneRow({ row, domain, trackWidth }: ThreePlaneRowProps) {
  const tokens = tokensForState(row.state);
  const isCritical = row.critical === true;

  // ── Baseline ghost ──────────────────────────────────────────────────────
  let baselineEl: React.ReactNode = null;
  if (row.baselineStart && row.baselineEnd) {
    const box = barBox(
      new Date(row.baselineStart),
      new Date(row.baselineEnd),
      domain,
      trackWidth,
    );
    const style: CSSProperties = {
      position: "absolute",
      top: GHOST_TOP,
      height: GHOST_H,
      left: `${box.left}px`,
      width: `${box.width}px`,
      borderRadius: 3,
      background: "var(--bg-3)",
      border: "1px dashed var(--line-2)",
      opacity: 0.6,
      zIndex: 1,
      pointerEvents: "none",
    };
    baselineEl = <div data-testid="plane-baseline" style={style} />;
  }

  // ── Plan bar ────────────────────────────────────────────────────────────
  let planEl: React.ReactNode = null;
  if (row.startDate && row.dueDate) {
    const box = barBox(
      new Date(row.startDate),
      new Date(row.dueDate),
      domain,
      trackWidth,
    );
    const planStyle: CSSProperties = {
      position: "absolute",
      top: BAR_TOP,
      height: BAR_H,
      left: `${box.left}px`,
      width: `${box.width}px`,
      borderRadius: 4,
      background: tokens.background,
      border: `1px solid ${tokens.border}`,
      overflow: "hidden",
      zIndex: 2,
      // ponytail: critical ring uses boxShadow; a dedicated marker icon is PR3 scope.
      boxShadow: isCritical
        ? `0 0 0 2px var(--warn), 0 0 8px color-mix(in oklch, var(--warn) 30%, transparent)`
        : "none",
      transition: "box-shadow 120ms ease",
    };

    const showProgress = row.progress > 0 && row.progress < 100;
    planEl = (
      <div
        data-testid="plane-plan"
        data-critical={isCritical ? "true" : undefined}
        style={planStyle}
      >
        {showProgress && (
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              bottom: 0,
              width: `${row.progress}%`,
              background: "color-mix(in oklch, var(--accent) 14%, transparent)",
              borderRight: "1px solid var(--accent)",
              borderRadius: "4px 0 0 4px",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
    );
  }

  // ── Forecast overlay ────────────────────────────────────────────────────
  let forecastEl: React.ReactNode = null;
  if (row.forecastStart && row.forecastEnd) {
    const box = barBox(
      new Date(row.forecastStart),
      new Date(row.forecastEnd),
      domain,
      trackWidth,
    );
    const forecastStyle: CSSProperties = {
      position: "absolute",
      top: FORECAST_TOP,
      height: FORECAST_H,
      left: `${box.left}px`,
      width: `${box.width}px`,
      borderRadius: 2,
      background: "color-mix(in oklch, var(--accent) 20%, transparent)",
      border: "1px solid var(--accent)",
      opacity: 0.75,
      zIndex: 3,
      pointerEvents: "none",
    };
    forecastEl = <div data-testid="plane-forecast" style={forecastStyle} />;
  }

  // ── Slip gap ────────────────────────────────────────────────────────────
  let slipEl: React.ReactNode = null;
  if (row.dueDate && row.forecastEnd) {
    const due = new Date(row.dueDate);
    const fend = new Date(row.forecastEnd);
    if (fend.getTime() > due.getTime()) {
      const box = barBox(due, fend, domain, trackWidth);
      const slipStyle: CSSProperties = {
        position: "absolute",
        top: BAR_TOP,
        height: BAR_H,
        left: `${box.left}px`,
        width: `${box.width}px`,
        borderRadius: "0 4px 4px 0",
        background: "color-mix(in oklch, var(--warn) 22%, transparent)",
        border: "1px dashed var(--warn)",
        borderLeft: "none",
        zIndex: 2,
        pointerEvents: "none",
      };
      slipEl = <div data-testid="slip-gap" style={slipStyle} />;
    }
  }

  const rowStyle: CSSProperties = {
    position: "relative",
    height: ROW_H + FORECAST_H + 2, // extra height to show forecast band below bar
    width: "100%",
  };

  return (
    <div style={rowStyle}>
      {baselineEl}
      {planEl}
      {slipEl}
      {forecastEl}
    </div>
  );
}
