/**
 * KAN-105 PR3 — ThreePlaneRow: renders one issue row with three vertically-
 * distinguishable Gantt planes using the timeline-scale pixel math.
 *
 * Planes (bottom to top by z-index):
 *   1. Baseline ghost — muted ghost behind the plan, shows original commitment.
 *   2. Plan bar       — solid colored bar, progress fill overlay. DRAGGABLE (move).
 *   3. Forecast overlay — translucent accent outline, live reality.
 *   + Slip gap         — warn-colored gap from dueDate to forecastEnd when slipping.
 *
 * PR3 adds:
 *   - Horizontal pointer-drag on the plan bar to MOVE the whole plan.
 *   - onPlanChange callback prop for the parent (ScheduleGantt) to wire the mutation.
 *   - data-draggable="true" on the plan bar when draggable.
 *
 * ponytail: MOVE only (shift start+due by same delta). Per-edge resize handles
 *   (independent start/due) are a follow-up if needed.
 *
 * Styling mirrors the roadmap timeline-bar.tsx aesthetic using the same
 * CSS-var palette. Written from scratch — does NOT import from roadmap/.
 */

import { useState, useRef, useCallback, type CSSProperties, type ReactNode, type PointerEvent } from "react";
import type { ScheduleTimelineRow } from "./use-project-schedule-timeline";
import { barBox, pixelToDate, type DateDomain } from "./timeline-scale";

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

// ── Critical-path coloring (KAN-150) ────────────────────────────────────────
/**
 * Issues with floatDays at or below this many days (but still positive) are
 * "near-critical" — a small schedule slip would put them on the critical path.
 * Matches the forecast engine's default at-risk buffer (3 days).
 */
const NEAR_CRITICAL_THRESHOLD = 3;

type CriticalTier = "critical" | "near" | "normal";

/**
 * Classify a row by critical-path urgency. `critical` (floatDays ≤ 0) wins;
 * otherwise a low positive float marks it near-critical. Everything else is
 * colored by its workflow state.
 */
function criticalTier(row: ScheduleTimelineRow): CriticalTier {
  if (row.critical === true) return "critical";
  // Defensive: a zero/negative float is critical by definition, even if the
  // engine's `critical` flag is somehow out of sync — never render it as normal.
  if (row.floatDays != null && row.floatDays <= 0) return "critical";
  if (row.floatDays != null && row.floatDays <= NEAR_CRITICAL_THRESHOLD) {
    return "near";
  }
  return "normal";
}

/** Resolve the plan bar fill/border, overriding state color for critical tiers. */
function barTokensFor(row: ScheduleTimelineRow): StateTokens {
  switch (criticalTier(row)) {
    case "critical":
      return {
        background: "color-mix(in oklch, var(--bad) 18%, var(--panel))",
        border: "var(--bad)",
      };
    case "near":
      return {
        background: "color-mix(in oklch, var(--warn) 16%, var(--panel))",
        border: "var(--warn)",
      };
    default:
      return tokensForState(row.state);
  }
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PlanChangePayload {
  issueKey: string;
  startDate: string;
  dueDate: string;
}

export interface ThreePlaneRowProps {
  row: ScheduleTimelineRow;
  domain: DateDomain;
  trackWidth: number;
  /** Called when the user drops the plan bar after dragging (non-zero day delta). */
  onPlanChange?: (payload: PlanChangePayload) => void;
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * Renders the three planes + slip gap for one issue row.
 * The parent (ScheduleGantt) positions this absolutely; this component only
 * handles the horizontal/vertical geometry within a single row.
 */
export function ThreePlaneRow({ row, domain, trackWidth, onPlanChange }: ThreePlaneRowProps) {
  const tokens = barTokensFor(row);
  const tier = criticalTier(row);
  const isCritical = tier === "critical";
  const isNearCritical = tier === "near";

  // ── Drag state ──────────────────────────────────────────────────────────
  // dragOffsetPx: visual translation applied while dragging (px). Reset on drop.
  const [dragOffsetPx, setDragOffsetPx] = useState(0);
  const dragStartXRef = useRef<number | null>(null);

  const isDraggable = !!(row.startDate && row.dueDate && onPlanChange);

  /** Resets all drag state without writing — used by cancel and lost-capture. */
  const resetDrag = useCallback(() => {
    dragStartXRef.current = null;
    setDragOffsetPx(0);
  }, []);

  const handlePointerDown = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (!isDraggable) return;
      // setPointerCapture may be absent in test environments (jsdom).
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* no-op */ }
      dragStartXRef.current = e.clientX;
    },
    [isDraggable],
  );

  const handlePointerMove = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (dragStartXRef.current === null) return;
      setDragOffsetPx(e.clientX - dragStartXRef.current);
    },
    [],
  );

  const handlePointerUp = useCallback(
    (e: PointerEvent<HTMLDivElement>) => {
      if (dragStartXRef.current === null) return;
      const totalOffsetPx = e.clientX - dragStartXRef.current;
      dragStartXRef.current = null;
      setDragOffsetPx(0);

      if (!onPlanChange || !row.startDate || !row.dueDate) return;

      // Compute the day delta by converting the start and shifted-start positions
      // back to dates using pixelToDate, then diff in whole days.
      // We need to know the pixel position of the original startDate so we can
      // add the offset to it and convert back to a date.
      //
      // Approach: use pixelToDate on two reference pixel values.
      //   anchorPx = some reference pixel (e.g. trackWidth / 2)
      //   shiftedPx = anchorPx + totalOffsetPx
      // The day delta = pixelToDate(shiftedPx) - pixelToDate(anchorPx) in days.
      //
      // This is equivalent to: delta_days = round(totalOffsetPx / pxPerDay)
      // where pxPerDay = trackWidth / domainSpanDays.
      const domainSpanMs = domain.max.getTime() - domain.min.getTime();
      if (domainSpanMs <= 0 || trackWidth <= 0) return;

      const anchorPx = trackWidth / 2;
      const anchorDate = pixelToDate(anchorPx, domain, trackWidth);
      const shiftedDate = pixelToDate(anchorPx + totalOffsetPx, domain, trackWidth);
      const deltaDays = Math.round(
        (shiftedDate.getTime() - anchorDate.getTime()) / (1000 * 60 * 60 * 24),
      );

      if (deltaDays === 0) return; // no-op — skip write

      const deltaMs = deltaDays * 24 * 60 * 60 * 1000;
      const newStart = new Date(new Date(row.startDate).getTime() + deltaMs);
      const newDue = new Date(new Date(row.dueDate).getTime() + deltaMs);

      // Snap to UTC midnight: preserve day-granular invariant regardless of
      // the original date's time component.
      newStart.setUTCHours(0, 0, 0, 0);
      newDue.setUTCHours(0, 0, 0, 0);

      onPlanChange({
        issueKey: row.issueKey,
        startDate: newStart.toISOString(),
        dueDate: newDue.toISOString(),
      });
    },
    [onPlanChange, row, domain, trackWidth],
  );

  // ── Baseline ghost ──────────────────────────────────────────────────────
  let baselineEl: ReactNode = null;
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
  let planEl: ReactNode = null;
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
      left: `${box.left + dragOffsetPx}px`,
      width: `${box.width}px`,
      borderRadius: 4,
      background: tokens.background,
      border: `1px solid ${tokens.border}`,
      overflow: "hidden",
      zIndex: 2,
      // KAN-150: critical bars get a red glow on top of the red fill/border;
      // near-critical and normal bars rely on fill/border alone.
      boxShadow: isCritical
        ? `0 0 0 2px var(--bad), 0 0 8px color-mix(in oklch, var(--bad) 30%, transparent)`
        : "none",
      transition: dragOffsetPx !== 0 ? "none" : "box-shadow 120ms ease",
      cursor: isDraggable ? "grab" : undefined,
      touchAction: "none",
    };

    const showProgress = row.progress > 0 && row.progress < 100;
    planEl = (
      <div
        data-testid="plane-plan"
        data-critical={isCritical ? "true" : undefined}
        data-near-critical={isNearCritical ? "true" : undefined}
        data-draggable={isDraggable ? "true" : undefined}
        role={isCritical || isNearCritical ? "img" : undefined}
        aria-label={
          isCritical
            ? "Critical path issue"
            : isNearCritical
              ? "Near-critical issue (low schedule float)"
              : undefined
        }
        title={
          isCritical
            ? "Critical path issue"
            : isNearCritical
              ? "Near-critical issue (low schedule float)"
              : undefined
        }
        style={planStyle}
        onPointerDown={isDraggable ? handlePointerDown : undefined}
        onPointerMove={isDraggable ? handlePointerMove : undefined}
        onPointerUp={isDraggable ? handlePointerUp : undefined}
        onPointerCancel={isDraggable ? resetDrag : undefined}
        onLostPointerCapture={isDraggable ? resetDrag : undefined}
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
  let forecastEl: ReactNode = null;
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
  let slipEl: ReactNode = null;
  if (row.dueDate && row.forecastEnd) {
    const due = new Date(row.dueDate);
    const fend = new Date(row.forecastEnd);
    if (fend.getTime() > due.getTime()) {
      const slipDays =
        row.slipDays != null
          ? row.slipDays
          : Math.round((fend.getTime() - due.getTime()) / (1000 * 60 * 60 * 24));
      const slipLabel = `Slipping: forecast exceeds due date by ${slipDays} day(s)`;
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
      slipEl = (
        <div
          data-testid="slip-gap"
          role="img"
          style={slipStyle}
          title={slipLabel}
          aria-label={slipLabel}
        />
      );
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
