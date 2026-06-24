/**
 * KAN-105 PR2 — ScheduleGantt: container component for the three-plane
 * schedule Gantt view.
 *
 * Renders:
 *  - Left gutter:  issueKey + title (fixed-width, mirroring gantt-timeline LEFT=240)
 *  - Header axis:  month markers + today vertical line (sticky)
 *  - Row per issue: ThreePlaneRow (baseline ghost / plan bar / forecast overlay)
 *  - Legend block: three planes + slip explained
 *  - States: loading / error / empty (friendly messages)
 *
 * No drag, no mutations, no SSE — PR3.
 */

import { useMemo, useCallback, type CSSProperties } from "react";
import { useContainerWidth } from "@/features/roadmap/use-container-size";
import { useProjectScheduleTimeline } from "./use-project-schedule-timeline";
import { computeDomain } from "./timeline-scale";
import { ThreePlaneRow, type PlanChangePayload } from "./three-plane-row";
import { useUpsertPlanMutation } from "./use-upsert-plan-mutation";

// ── Layout constants (mirror gantt-timeline.tsx) ─────────────────────────────

const LEFT = 240;
const ROW_H = 44; // slightly taller than roadmap's 36 to fit the forecast band below the bar
const HDR_H = 48;
const MIN_CANVAS_W = 1100;

// ── Month axis helpers ────────────────────────────────────────────────────────

/**
 * Build an array of {label, ratio} month markers within [domainMin, domainMax].
 * ratio is the position 0..1 along the track for each month boundary.
 */
function buildMonthMarkers(
  domainMin: Date,
  domainMax: Date,
): Array<{ label: string; ratio: number }> {
  const span = domainMax.getTime() - domainMin.getTime();
  if (span <= 0) return [];

  const MONTH_NAMES = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];

  const markers: Array<{ label: string; ratio: number }> = [];
  // Walk month boundaries from the first full month after domainMin to domainMax
  const cursor = new Date(domainMin);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  // Advance to the first boundary that is >= domainMin
  if (cursor.getTime() < domainMin.getTime()) {
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  while (cursor.getTime() <= domainMax.getTime()) {
    const ratio = (cursor.getTime() - domainMin.getTime()) / span;
    markers.push({
      label: `${MONTH_NAMES[cursor.getUTCMonth()]} ${cursor.getUTCFullYear()}`,
      ratio,
    });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }

  return markers;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ScheduleGanttProps {
  projectKey: string;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function ScheduleGantt({ projectKey }: ScheduleGanttProps) {
  const { data, isLoading, isError } = useProjectScheduleTimeline(projectKey);
  const [containerRef, containerWidth] = useContainerWidth();
  const upsertPlan = useUpsertPlanMutation();

  const canvasW = Math.max(containerWidth || 0, MIN_CANVAS_W);
  const trackW = Math.max(canvasW - LEFT, 200);

  const handlePlanChange = useCallback(
    ({ issueKey, startDate, dueDate }: PlanChangePayload) => {
      upsertPlan.mutate({ issueKey, projectKey, startDate, dueDate });
    },
    [upsertPlan, projectKey],
  );

  const domain = useMemo(
    () => computeDomain(data ?? []),
    [data],
  );

  const monthMarkers = useMemo(
    () => buildMonthMarkers(domain.min, domain.max),
    [domain],
  );

  // Today position ratio across the track
  const todayRatio = useMemo(() => {
    const span = domain.max.getTime() - domain.min.getTime();
    if (span <= 0) return 0;
    return Math.min(1, Math.max(0, (Date.now() - domain.min.getTime()) / span));
  }, [domain]);

  // ── Loading ───────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div
        data-testid="schedule-gantt-loading"
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        Loading schedule…
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────
  if (isError) {
    return (
      <div
        data-testid="schedule-gantt-error"
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--bad)",
          fontSize: 12,
        }}
      >
        Failed to load schedule timeline.
      </div>
    );
  }

  // ── Empty ─────────────────────────────────────────────────────────────
  if (!data || data.length === 0) {
    return (
      <div
        data-testid="schedule-gantt-empty"
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        No schedule data yet. Add start/due dates to issues to see them here.
      </div>
    );
  }

  // ── Full render ───────────────────────────────────────────────────────

  const totalH = HDR_H + data.length * ROW_H + 32 /* legend padding */;

  const outerStyle: CSSProperties = {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    overflow: "hidden",
    background: "var(--bg)",
  };

  const scrollStyle: CSSProperties = {
    flex: 1,
    overflow: "auto",
    position: "relative",
  };

  const canvasStyle: CSSProperties = {
    position: "relative",
    minWidth: MIN_CANVAS_W,
    height: totalH,
  };

  return (
    <div data-testid="schedule-gantt" style={outerStyle}>
      {/* Legend toolbar */}
      <GanttLegend />

      {/* Scroll container */}
      <div ref={containerRef} style={scrollStyle}>
        <div style={canvasStyle}>

          {/* Sticky header: month axis */}
          <div
            data-testid="schedule-gantt-header"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 4,
              background: "var(--bg)",
              borderBottom: "1px solid var(--line)",
              height: HDR_H,
            }}
          >
            {/* Left gutter label */}
            <div
              style={{
                position: "absolute",
                left: 0,
                top: 0,
                bottom: 0,
                width: LEFT,
                borderRight: "1px solid var(--line)",
                display: "flex",
                alignItems: "center",
                padding: "0 16px",
                fontSize: 11,
                color: "var(--ink-4)",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
              }}
              className="mono"
            >
              Issue
            </div>

            {/* Month markers */}
            {monthMarkers.map((m) => (
              <div
                key={m.label}
                className="mono"
                style={{
                  position: "absolute",
                  left: `${LEFT + m.ratio * trackW}px`,
                  top: 0,
                  bottom: 0,
                  paddingLeft: 6,
                  display: "flex",
                  alignItems: "center",
                  fontSize: 10.5,
                  color: "var(--ink-4)",
                  borderLeft: "1px solid var(--line)",
                  pointerEvents: "none",
                  whiteSpace: "nowrap",
                }}
              >
                {m.label}
              </div>
            ))}
          </div>

          {/* Today vertical line */}
          <div
            data-testid="schedule-gantt-today"
            style={{
              position: "absolute",
              top: HDR_H,
              bottom: 0,
              left: `${LEFT + todayRatio * trackW}px`,
              width: 1,
              background: "var(--accent)",
              opacity: 0.7,
              zIndex: 3,
              pointerEvents: "none",
            }}
          />

          {/* Issue rows */}
          {data.map((row, i) => (
            <div
              key={row.issueId}
              data-testid="gantt-issue-row"
              style={{
                position: "absolute",
                top: HDR_H + i * ROW_H,
                left: 0,
                right: 0,
                height: ROW_H,
                borderBottom: "1px solid var(--line)",
                display: "flex",
              }}
            >
              {/* Left gutter */}
              <div
                style={{
                  width: LEFT,
                  flexShrink: 0,
                  padding: "0 16px",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  borderRight: "1px solid var(--line)",
                  background: "var(--bg)",
                  zIndex: 1,
                  overflow: "hidden",
                }}
              >
                <span
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: "var(--ink-4)",
                    flexShrink: 0,
                  }}
                >
                  {row.issueKey}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--ink-2)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                    minWidth: 0,
                  }}
                >
                  {row.title}
                </span>
              </div>

              {/* Track area — ThreePlaneRow handles absolute positioning within */}
              <div
                style={{
                  flex: 1,
                  position: "relative",
                  overflow: "hidden",
                }}
              >
                <ThreePlaneRow
                  row={row}
                  domain={domain}
                  trackWidth={trackW}
                  onPlanChange={handlePlanChange}
                />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Legend ────────────────────────────────────────────────────────────────────

const LEGEND_ITEMS = [
  {
    label: "Baseline",
    style: {
      width: 20,
      height: 8,
      borderRadius: 2,
      background: "var(--bg-3)",
      border: "1px dashed var(--line-2)",
      opacity: 0.7,
    } as CSSProperties,
  },
  {
    label: "Plan",
    style: {
      width: 20,
      height: 10,
      borderRadius: 2,
      background: "color-mix(in oklch, var(--accent) 18%, var(--panel))",
      border: "1px solid var(--accent)",
    } as CSSProperties,
  },
  {
    label: "Forecast",
    style: {
      width: 20,
      height: 5,
      borderRadius: 2,
      background: "color-mix(in oklch, var(--accent) 20%, transparent)",
      border: "1px solid var(--accent)",
    } as CSSProperties,
  },
  {
    label: "Slip",
    style: {
      width: 20,
      height: 10,
      borderRadius: 2,
      background: "color-mix(in oklch, var(--warn) 22%, transparent)",
      border: "1px dashed var(--warn)",
    } as CSSProperties,
  },
  {
    // KAN-150: critical-path bars are colored red.
    label: "Critical",
    style: {
      width: 20,
      height: 10,
      borderRadius: 2,
      background: "color-mix(in oklch, var(--bad) 18%, var(--panel))",
      border: "1px solid var(--bad)",
    } as CSSProperties,
  },
  {
    // KAN-150: near-critical (low schedule float) bars are colored amber.
    label: "Near-critical",
    style: {
      width: 20,
      height: 10,
      borderRadius: 2,
      background: "color-mix(in oklch, var(--warn) 16%, var(--panel))",
      border: "1px solid var(--warn)",
    } as CSSProperties,
  },
] as const;

function GanttLegend() {
  return (
    <div
      data-testid="schedule-gantt-legend"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "8px 16px",
        borderBottom: "1px solid var(--line)",
        flexShrink: 0,
      }}
    >
      <span
        className="mono"
        style={{
          fontSize: 10,
          letterSpacing: "0.08em",
          color: "var(--ink-4)",
          textTransform: "uppercase",
          marginRight: 4,
        }}
      >
        legend
      </span>
      {LEGEND_ITEMS.map((item) => (
        <span
          key={item.label}
          style={{ display: "inline-flex", alignItems: "center", gap: 6 }}
        >
          <span style={item.style} />
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{item.label}</span>
        </span>
      ))}
    </div>
  );
}
