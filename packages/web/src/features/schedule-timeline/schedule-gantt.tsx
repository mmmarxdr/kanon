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

import { useMemo, useCallback, useState, useId, type CSSProperties } from "react";
import { useContainerWidth } from "@/features/roadmap/use-container-size";
import { useProjectScheduleTimeline, type ScheduleTimelineRow } from "./use-project-schedule-timeline";
import { computeDomain, barBox, type DateDomain } from "./timeline-scale";
import { ThreePlaneRow, type PlanChangePayload } from "./three-plane-row";
import { useUpsertPlanMutation } from "./use-upsert-plan-mutation";

// ── Layout constants (mirror gantt-timeline.tsx) ─────────────────────────────

const LEFT = 240;
const ROW_H = 44; // slightly taller than roadmap's 36 to fit the forecast band below the bar
const HDR_H = 48;
const MIN_CANVAS_W = 1100;
const DAY_MS = 86_400_000;

// ── Zoom (KAN-148) ──────────────────────────────────────────────────────────
// "fit" stretches the whole domain to the available track width. Fixed levels
// pin a constant pixels-per-day so the canvas scrolls horizontally at a chosen
// time density.
type ZoomLevel = "fit" | "day" | "week" | "month" | "quarter";
const PX_PER_DAY: Record<Exclude<ZoomLevel, "fit">, number> = {
  day: 28,
  week: 10,
  month: 3.4,
  quarter: 1.2,
};
const ZOOM_OPTIONS: ReadonlyArray<{ value: ZoomLevel; label: string }> = [
  { value: "fit", label: "Fit" },
  { value: "quarter", label: "Quarter" },
  { value: "month", label: "Month" },
  { value: "week", label: "Week" },
  { value: "day", label: "Day" },
];

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
  const { mutate: mutatePlan } = useUpsertPlanMutation();

  const canvasW = Math.max(containerWidth || 0, MIN_CANVAS_W);
  const [zoom, setZoom] = useState<ZoomLevel>("fit");

  const handlePlanChange = useCallback(
    ({ issueKey, startDate, dueDate }: PlanChangePayload) => {
      mutatePlan({ issueKey, projectKey, startDate, dueDate });
    },
    [mutatePlan, projectKey],
  );

  const domain = useMemo(
    () => computeDomain(data ?? []),
    [data],
  );

  // KAN-148: track width is driven by the zoom level. "fit" stretches the whole
  // domain to the visible width; fixed levels use pixels-per-day so the canvas
  // grows wider than the viewport and scrolls horizontally.
  const domainDays = useMemo(
    () => Math.max(1, (domain.max.getTime() - domain.min.getTime()) / DAY_MS),
    [domain],
  );
  const fitTrackW = Math.max(canvasW - LEFT, 200);
  const trackW =
    zoom === "fit" ? fitTrackW : Math.max(domainDays * PX_PER_DAY[zoom], 200);

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

  // KAN-151: re-center the scroll viewport on the today line.
  const scrollToToday = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    const targetX = LEFT + todayRatio * trackW;
    el.scrollLeft = Math.max(0, targetX - el.clientWidth / 2);
  }, [containerRef, todayRatio, trackW]);

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
    // KAN-148: canvas width follows the zoom-driven track so it scrolls when
    // zoomed beyond the viewport; minWidth keeps a floor on tiny containers.
    width: LEFT + trackW,
    minWidth: MIN_CANVAS_W,
    height: totalH,
  };

  return (
    <div data-testid="schedule-gantt" style={outerStyle}>
      {/* Legend toolbar */}
      <GanttLegend zoom={zoom} onZoom={setZoom} onToday={scrollToToday} />

      {/* Scroll container */}
      <div ref={containerRef} data-testid="schedule-gantt-scroll" style={scrollStyle}>
        <div data-testid="schedule-gantt-canvas" style={canvasStyle}>

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

          {/* KAN-149: dependency arrows overlay (above bars, below today line) */}
          <DepArrows data={data} domain={domain} trackW={trackW} />
        </div>
      </div>
    </div>
  );
}

// ── Dependency arrows (KAN-149) ─────────────────────────────────────────────────

/** Vertical center of a plan bar within its row (mirrors ThreePlaneRow BAR_TOP+BAR_H/2). */
const BAR_CENTER = 18;

interface BarAnchor {
  leftX: number;
  rightX: number;
  cy: number;
  critical: boolean;
}

/**
 * Draws an SVG arrow per typed dependency edge between plan bars.
 * Endpoints follow the dependency semantics:
 *   FS source.end → target.start | SS source.start → target.start
 *   FF source.end → target.end   | SF source.start → target.end
 *   blocks is drawn like FS.
 * Edges between two critical-path issues are colored red.
 */
function DepArrows({
  data,
  domain,
  trackW,
}: {
  data: ScheduleTimelineRow[];
  domain: DateDomain;
  trackW: number;
}) {
  // Unique marker ids per instance so multiple Gantts on one page don't collide.
  const uid = useId();
  const arrowId = `${uid}-arrow`;
  const arrowCriticalId = `${uid}-arrow-critical`;

  // Resolve each issue's bar anchors. Rows without a plan bar can't anchor edges.
  const anchors = new Map<string, BarAnchor>();
  data.forEach((row, i) => {
    if (!row.startDate || !row.dueDate) return;
    const box = barBox(new Date(row.startDate), new Date(row.dueDate), domain, trackW);
    anchors.set(row.issueId, {
      leftX: LEFT + box.left,
      rightX: LEFT + box.left + box.width,
      cy: HDR_H + i * ROW_H + BAR_CENTER,
      critical: row.critical === true,
    });
  });

  const edges: Array<{
    key: string;
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    critical: boolean;
  }> = [];

  for (const row of data) {
    const src = anchors.get(row.issueId);
    if (!src) continue;
    for (const dep of row.deps ?? []) {
      const tgt = anchors.get(dep.targetIssueId);
      if (!tgt) continue;
      // Endpoint x by edge type.
      const startFromEnd = dep.type === "FS" || dep.type === "FF" || dep.type === "blocks";
      const endAtEnd = dep.type === "FF" || dep.type === "SF";
      edges.push({
        key: `${row.issueId}->${dep.targetIssueId}:${dep.type}`,
        x1: startFromEnd ? src.rightX : src.leftX,
        y1: src.cy,
        x2: endAtEnd ? tgt.rightX : tgt.leftX,
        y2: tgt.cy,
        critical: src.critical && tgt.critical,
      });
    }
  }

  if (edges.length === 0) return null;

  return (
    <svg
      data-testid="schedule-gantt-deps"
      width={LEFT + trackW}
      height="100%"
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: LEFT + trackW,
        height: "100%",
        pointerEvents: "none",
        zIndex: 2,
        overflow: "visible",
      }}
    >
      <defs>
        <marker id={arrowId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--ink-4)" />
        </marker>
        <marker id={arrowCriticalId} markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 Z" fill="var(--bad)" />
        </marker>
      </defs>
      {edges.map((e) => {
        // Signed control-point offset so backward (x2<x1) and zero-distance
        // edges bow toward each other instead of doubling back.
        const dir = e.x2 >= e.x1 ? 1 : -1;
        const dx = Math.min(48, Math.max(16, Math.abs(e.x2 - e.x1) * 0.4));
        const d = `M ${e.x1} ${e.y1} C ${e.x1 + dir * dx} ${e.y1}, ${e.x2 - dir * dx} ${e.y2}, ${e.x2} ${e.y2}`;
        return (
          <path
            key={e.key}
            data-testid="dep-edge"
            data-critical={e.critical ? "true" : undefined}
            d={d}
            fill="none"
            stroke={e.critical ? "var(--bad)" : "var(--ink-4)"}
            strokeWidth={e.critical ? 2 : 1.2}
            strokeOpacity={e.critical ? 0.9 : 0.6}
            markerEnd={e.critical ? `url(#${arrowCriticalId})` : `url(#${arrowId})`}
          />
        );
      })}
    </svg>
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

function GanttLegend({
  zoom,
  onZoom,
  onToday,
}: {
  zoom?: ZoomLevel;
  onZoom?: (z: ZoomLevel) => void;
  onToday?: () => void;
}) {
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

      {/* Right-aligned controls: zoom (KAN-148) + scroll-to-today (KAN-151). */}
      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        {onZoom && (
          <div
            data-testid="schedule-gantt-zoom"
            role="group"
            aria-label="Timescale zoom"
            style={{ display: "inline-flex", gap: 2 }}
          >
            {ZOOM_OPTIONS.map((opt) => {
              const active = zoom === opt.value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  data-testid={`schedule-gantt-zoom-${opt.value}`}
                  data-active={active ? "true" : undefined}
                  aria-pressed={active}
                  onClick={() => onZoom(opt.value)}
                  className="mono"
                  style={{
                    fontSize: 11,
                    color: active ? "var(--ink-1)" : "var(--ink-3)",
                    background: active ? "var(--bg-3)" : "var(--panel)",
                    border: `1px solid ${active ? "var(--accent)" : "var(--line-2)"}`,
                    borderRadius: 4,
                    padding: "3px 8px",
                    cursor: "pointer",
                  }}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}
        {onToday && (
          <button
            type="button"
            data-testid="schedule-gantt-today-btn"
            onClick={onToday}
            className="mono"
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              background: "var(--panel)",
              border: "1px solid var(--line-2)",
              borderRadius: 4,
              padding: "3px 10px",
              cursor: "pointer",
            }}
          >
            Today
          </button>
        )}
      </div>
    </div>
  );
}
