import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import i18n from "@/i18n";
import type { RoadmapItem, RoadmapStatus, Horizon } from "@/types/roadmap";
import { useRoadmapStore } from "@/stores/roadmap-store";
import { Segmented } from "@/components/ui/primitives";
import { useContainerWidth } from "../use-container-size";
import {
  CANVAS_START_WEEK,
  MONTHS,
  QUARTERS,
  TODAY_WEEK,
  TOTAL_WEEKS,
  useTimelineData,
  type TimelineGroup,
  type TimelineItem,
} from "./use-timeline-data";
import { TimelineBar } from "./timeline-bar";

interface GanttTimelineProps {
  items: RoadmapItem[];
}

// ── Layout constants ──────────────────────────────────────────────────

const LEFT = 240;
const ROW_H = 36;
const HDR_H = 56;
/** Fallback canvas width before ResizeObserver fires (also a sane minimum). */
const MIN_CANVAS_WIDTH = 1100;

// ── Group-by ──────────────────────────────────────────────────────────

type GroupBy = "horizon" | "owner";

const GROUP_BY_STORAGE_KEY = "kanon.timeline.groupBy";

function unassignedOwnerLabel(): string {
  return i18n.t("roadmap:unassignedOwner");
}

function loadGroupBy(): GroupBy {
  try {
    const v = window.localStorage.getItem(GROUP_BY_STORAGE_KEY);
    return v === "owner" ? "owner" : "horizon";
  } catch {
    return "horizon";
  }
}

function persistGroupBy(value: GroupBy): void {
  try {
    window.localStorage.setItem(GROUP_BY_STORAGE_KEY, value);
  } catch {
    // localStorage unavailable
  }
}

// ── Theming helpers ───────────────────────────────────────────────────

const STATUS_LEGEND: ReadonlyArray<{
  status: RoadmapStatus;
  color: string;
  labelKey: string;
}> = [
  { status: "in_progress", color: "var(--accent)", labelKey: "statusInProgress" },
  { status: "planned", color: "var(--ink-2)", labelKey: "statusPlanned" },
  { status: "done", color: "var(--ok)", labelKey: "statusDone" },
  { status: "idea", color: "var(--ink-4)", labelKey: "statusIdea" },
];

function statusDotColor(status: RoadmapStatus): string {
  switch (status) {
    case "in_progress":
      return "var(--accent)";
    case "planned":
      return "var(--ink-2)";
    case "done":
      return "var(--ok)";
    case "idea":
    default:
      return "var(--ink-4)";
  }
}

function horizonTone(horizon: Horizon): string {
  switch (horizon) {
    case "now":
      return "var(--accent)";
    case "next":
      return "var(--ai)";
    case "later":
      return "var(--warn)";
    case "someday":
    default:
      return "var(--ink-4)";
  }
}

// ── Edge model ────────────────────────────────────────────────────────

interface TimelineEdge {
  id: string;
  src: TimelineItem;
  tgt: TimelineItem;
}

/**
 * Compute dependency edges from RoadmapItem.blocks. Drops edges whose target
 * isn't present in the current item set (e.g. cross-project blocks).
 */
function computeEdges(
  rawItems: RoadmapItem[],
  byId: Map<string, TimelineItem>,
): TimelineEdge[] {
  const edges: TimelineEdge[] = [];
  for (const item of rawItems) {
    const src = byId.get(item.id);
    if (!src) continue;
    for (const dep of item.blocks ?? []) {
      const tgt = byId.get(dep.targetId);
      if (!tgt) continue;
      edges.push({ id: dep.id, src, tgt });
    }
  }
  return edges;
}

/**
 * Build a flat row index Map<itemId, rowIndex> respecting render order
 * (group header consumes a row, each item consumes the next row).
 *
 * Used for O(1) y-coordinate lookup when drawing dependency edges.
 */
function flatRowIndex(groups: TimelineGroup[]): Map<string, number> {
  const map = new Map<string, number>();
  let row = 0;
  for (const group of groups) {
    row += 1; // group header
    for (const item of group.items) {
      map.set(item.id, row);
      row += 1;
    }
  }
  return map;
}

// ── Component ─────────────────────────────────────────────────────────

/**
 * Custom canvas Gantt timeline. Replaces the recharts BarChart layout with
 * an absolute-positioned grid that matches the redesigned roadmap timeline.
 *
 * Geometry: the canvas spans TOTAL_WEEKS columns starting at CANVAS_START_WEEK.
 * `xpx(w)` converts a week number to an absolute pixel offset (including the
 * fixed-width LEFT track-label column); `wpx(span)` converts a week span to
 * a pixel width.
 */
export function GanttTimeline({ items }: GanttTimelineProps) {
  const { t } = useTranslation("roadmap");
  const [containerRef, containerWidth] = useContainerWidth();
  const { groups: horizonGroups } = useTimelineData(items);
  const setSelectedItemId = useRoadmapStore((s) => s.setSelectedItemId);

  // KAN-31: group-by toggle, hydrated from localStorage on first render.
  const [groupBy, setGroupBy] = useState<GroupBy>(() => loadGroupBy());
  useEffect(() => {
    persistGroupBy(groupBy);
  }, [groupBy]);

  // KAN-32 / KAN-33: shared hover state (drives both edge dim & bar glow).
  const [hoveredItemId, setHoveredItemId] = useState<string | null>(null);

  // Resolve final groups based on groupBy. Horizon → reuse hook output.
  // Owner → flatten all items and bucket by `owner` (Unassigned for null).
  const groups = useMemo<TimelineGroup[]>(() => {
    if (groupBy === "horizon") return horizonGroups;
    return groupByOwner(horizonGroups);
  }, [groupBy, horizonGroups]);

  // Map<id, item> over the *currently rendered* items — used for edges.
  const itemById = useMemo(() => {
    const map = new Map<string, TimelineItem>();
    for (const g of groups) {
      for (const it of g.items) {
        map.set(it.id, it);
      }
    }
    return map;
  }, [groups]);

  // KAN-32: dependency edges, derived directly from RoadmapItem.blocks.
  const edges = useMemo(() => computeEdges(items, itemById), [items, itemById]);

  // Flat item count (for the counter strip — also matches itemById.size).
  const totalItems = useMemo(
    () => groups.reduce((acc, g) => acc + g.items.length, 0),
    [groups],
  );

  // Canvas width must accommodate the fixed LEFT column + at least 200px of
  // track. Use the measured container width; fall back to a sensible min.
  const canvasW = Math.max(containerWidth || 0, MIN_CANVAS_WIDTH);
  const trackW = Math.max(canvasW - LEFT, 200);

  /** Pixel x-offset for a given week number, measured from the canvas left edge. */
  const xpx = (week: number): number =>
    LEFT + ((week - CANVAS_START_WEEK) / TOTAL_WEEKS) * trackW;
  /** Pixel width for a given week span. */
  const wpx = (span: number): number => (span / TOTAL_WEEKS) * trackW;

  // Total rows = one header row per group + one item row per item.
  const totalRows = useMemo(
    () => groups.reduce((acc, g) => acc + g.items.length + 1, 0),
    [groups],
  );
  const containerH = HDR_H + totalRows * ROW_H + 20;

  // Pre-compute the row index per item id for edge geometry.
  const rowIndex = useMemo(() => flatRowIndex(groups), [groups]);

  // Empty state mirrors the previous component's contract.
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-on-surface/40">{t("timelineEmpty")}</p>
      </div>
    );
  }

  const sparseMessage = items.length < 3 ? t("timelineSparse") : null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {sparseMessage && (
        <p
          className="text-xs text-on-surface/50"
          style={{ padding: "6px 16px 0" }}
        >
          {sparseMessage}
        </p>
      )}

      {/* Sub-toolbar: group-by + counter on the left, legend on the right. */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "8px 16px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 10,
            letterSpacing: "0.08em",
            color: "var(--ink-4)",
            textTransform: "uppercase",
          }}
        >
          group by
        </span>
        <Segmented<GroupBy>
          value={groupBy}
          options={[
            { id: "horizon", label: t("groupByHorizon") },
            { id: "owner", label: t("groupByOwner") },
          ]}
          onChange={setGroupBy}
        />
        <span
          aria-hidden="true"
          style={{ width: 1, height: 14, background: "var(--line)" }}
        />
        <span
          data-testid="timeline-counter"
          className="mono"
          style={{ fontSize: 11, color: "var(--ink-3)" }}
        >
          {totalItems} items · {edges.length} edges · {MONTHS.length} months
        </span>
        <span style={{ flex: 1 }} />
        <Legend />
      </div>

      {/* Scroll container */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          overflow: "auto",
          position: "relative",
          background: "var(--bg)",
        }}
      >
        <div
          style={{
            position: "relative",
            minWidth: MIN_CANVAS_WIDTH,
            height: containerH,
          }}
        >
          {/* Sticky 2-row header */}
          <div
            data-testid="timeline-header"
            style={{
              position: "sticky",
              top: 0,
              zIndex: 4,
              background: "var(--bg)",
              borderBottom: "1px solid var(--line)",
              height: HDR_H,
            }}
          >
            <QuarterRow xpx={xpx} wpx={wpx} />
            <MonthRow xpx={xpx} wpx={wpx} />
          </div>

          {/* Today vertical line */}
          <div
            data-testid="timeline-today-line"
            style={{
              position: "absolute",
              top: HDR_H,
              bottom: 0,
              left: `${xpx(TODAY_WEEK)}px`,
              width: 1,
              background: "var(--accent)",
              opacity: 0.7,
              zIndex: 3,
              pointerEvents: "none",
            }}
          />
          <div
            className="mono"
            style={{
              position: "absolute",
              top: HDR_H + 4,
              left: `${xpx(TODAY_WEEK) + 4}px`,
              fontSize: 10,
              color: "var(--accent)",
              zIndex: 3,
              pointerEvents: "none",
            }}
          >
            now · w0
          </div>

          {/* Vertical month grid lines (skip first to avoid doubling the LEFT border). */}
          {MONTHS.map((m, i) =>
            i === 0 ? null : (
              <div
                key={m.label}
                data-testid="timeline-month-grid"
                style={{
                  position: "absolute",
                  top: HDR_H,
                  bottom: 0,
                  left: `${xpx(m.start)}px`,
                  width: 1,
                  background: "var(--line)",
                  opacity: 0.6,
                  zIndex: 0,
                  pointerEvents: "none",
                }}
              />
            ),
          )}

          {/* Rows + bars */}
          <RowsLayer
            groups={groups}
            xpx={xpx}
            wpx={wpx}
            onItemClick={setSelectedItemId}
            hoveredItemId={hoveredItemId}
            onHoverChange={setHoveredItemId}
            groupBy={groupBy}
          />

          {/* KAN-32: Dependency edges overlay */}
          <EdgesOverlay
            edges={edges}
            rowIndex={rowIndex}
            trackW={trackW}
            containerH={containerH}
            hoveredItemId={hoveredItemId}
          />
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────

interface PixelMath {
  xpx: (week: number) => number;
  wpx: (span: number) => number;
}

function QuarterRow({ xpx, wpx }: PixelMath) {
  const { t } = useTranslation("roadmap");
  return (
    <div
      style={{
        position: "relative",
        height: 26,
        borderBottom: "1px solid var(--line)",
      }}
    >
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
        {t("track")}
      </div>
      {QUARTERS.map((q) => (
        <div
          key={q.label}
          style={{
            position: "absolute",
            left: `${xpx(q.start)}px`,
            width: `${wpx(q.end - q.start)}px`,
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: "0 8px",
            fontSize: 11,
            fontWeight: 500,
            color: q.tone === "now" ? "var(--accent)" : "var(--ink-3)",
            borderLeft: "1px solid var(--line)",
          }}
        >
          {q.label}
        </div>
      ))}
    </div>
  );
}

function MonthRow({ xpx, wpx }: PixelMath) {
  return (
    <div style={{ position: "relative", height: 30 }}>
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: LEFT,
          borderRight: "1px solid var(--line)",
        }}
      />
      {MONTHS.map((m) => (
        <div
          key={m.label}
          className="mono"
          style={{
            position: "absolute",
            left: `${xpx(m.start)}px`,
            width: `${wpx(m.end - m.start)}px`,
            height: "100%",
            display: "flex",
            alignItems: "center",
            padding: "0 6px",
            fontSize: 10.5,
            color: "var(--ink-4)",
            borderLeft: "1px solid var(--line)",
          }}
        >
          {m.label}
        </div>
      ))}
    </div>
  );
}

interface RowsLayerProps extends PixelMath {
  groups: TimelineGroup[];
  onItemClick: (id: string) => void;
  hoveredItemId: string | null;
  onHoverChange: (id: string | null) => void;
  groupBy: GroupBy;
}

function RowsLayer({
  groups,
  xpx,
  wpx,
  onItemClick,
  hoveredItemId,
  onHoverChange,
  groupBy,
}: RowsLayerProps) {
  // Walk groups + items in render order, assigning a flat row index.
  const rendered: React.ReactNode[] = [];
  let row = 0;

  for (const group of groups) {
    const headerRow = row++;
    rendered.push(
      <GroupHeader
        key={`hdr-${group.horizon}-${group.label}`}
        horizon={group.horizon}
        label={group.label}
        sub={group.sub}
        count={group.items.length}
        topPx={HDR_H + headerRow * ROW_H}
        groupBy={groupBy}
      />,
    );

    for (const item of group.items) {
      const itemRow = row++;
      const left = xpx(item.start);
      const width = wpx(item.end - item.start);
      rendered.push(
        <ItemRow
          key={`${group.label}-${item.id}`}
          topPx={HDR_H + itemRow * ROW_H}
          item={item}
          barLeft={left}
          barWidth={width}
          onItemClick={onItemClick}
          hoveredItemId={hoveredItemId}
          onHoverChange={onHoverChange}
        />,
      );
    }
  }

  return <div style={{ position: "relative" }}>{rendered}</div>;
}

interface GroupHeaderProps {
  horizon: Horizon;
  label: string;
  sub: string;
  count: number;
  topPx: number;
  groupBy: GroupBy;
}

function GroupHeader({
  horizon,
  label,
  sub,
  count,
  topPx,
  groupBy,
}: GroupHeaderProps) {
  // Owner-grouped headers don't have a horizon tone — fall back to ink-4.
  const dotColor = groupBy === "horizon" ? horizonTone(horizon) : "var(--ink-4)";
  return (
    <div
      data-testid="timeline-group-header"
      style={{
        position: "absolute",
        top: topPx,
        left: 0,
        right: 0,
        height: ROW_H,
        background: "var(--bg-2)",
        borderBottom: "1px solid var(--line)",
        display: "flex",
        alignItems: "center",
      }}
    >
      <div
        style={{
          width: LEFT,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRight: "1px solid var(--line)",
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dotColor,
          }}
        />
        <span
          style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}
        >
          {label}
        </span>
        {sub && (
          <span
            className="mono"
            style={{ fontSize: 10, color: "var(--ink-4)" }}
          >
            {sub}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ fontSize: 10, color: "var(--ink-4)", paddingRight: 4 }}
        >
          {count}
        </span>
      </div>
    </div>
  );
}

interface ItemRowProps {
  topPx: number;
  item: TimelineItem;
  barLeft: number;
  barWidth: number;
  onItemClick: (id: string) => void;
  hoveredItemId: string | null;
  onHoverChange: (id: string | null) => void;
}

function ItemRow({
  topPx,
  item,
  barLeft,
  barWidth,
  onItemClick,
  hoveredItemId,
  onHoverChange,
}: ItemRowProps) {
  return (
    <div
      style={{
        position: "absolute",
        top: topPx,
        left: 0,
        right: 0,
        height: ROW_H,
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 0,
          top: 0,
          bottom: 0,
          width: LEFT,
          padding: "0 16px",
          display: "flex",
          alignItems: "center",
          gap: 8,
          borderRight: "1px solid var(--line)",
          background: "var(--bg)",
          zIndex: 1,
        }}
      >
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 1,
            background: statusDotColor(item.status),
            flexShrink: 0,
          }}
        />
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
          {item.title}
        </span>
        <span style={{ flex: 1 }} />
        {/* Owner avatar slot (placeholder until people-on-items lands). */}
        <span
          aria-hidden="true"
          style={{
            width: 16,
            height: 16,
            borderRadius: "50%",
            background: "var(--bg-3)",
            border: "1px solid var(--line)",
            flexShrink: 0,
          }}
        />
      </div>
      <TimelineBar
        item={item}
        left={barLeft}
        width={barWidth}
        onClick={onItemClick}
        hoveredItemId={hoveredItemId}
        onHoverChange={onHoverChange}
      />
    </div>
  );
}

// ── Edges overlay (KAN-32) ────────────────────────────────────────────

interface EdgesOverlayProps {
  edges: TimelineEdge[];
  rowIndex: Map<string, number>;
  trackW: number;
  containerH: number;
  hoveredItemId: string | null;
}

/**
 * SVG overlay that draws cubic-bezier dependency arrows between bars.
 *
 * Geometry mirrors the design: source x = end of source bar (+2 weeks of
 * canvas offset, baked into the LEFT/TOTAL_WEEKS math), target x = start of
 * target bar minus a 6px stub so the marker arrow lands cleanly at the bar
 * edge. Y is the row-center of each item (rowIndex × ROW_H + ROW_H/2).
 *
 * Hover behavior:
 *   - When `hoveredItemId` is null → NO edges visible. Showing all edges at
 *     once turned the canvas into a noise of crossing lines on dense
 *     roadmaps; users can't read the bars under them. Edges only surface
 *     when the user explicitly asks for them by hovering a bar.
 *   - When set → only edges that touch the hovered item render, in accent
 *     stroke with the full marker. Everything else stays hidden.
 *
 * Pointer events are disabled — bar hover/click must pass through.
 */
function EdgesOverlay({
  edges,
  rowIndex,
  trackW,
  containerH,
  hoveredItemId,
}: EdgesOverlayProps) {
  return (
    <svg
      data-testid="timeline-edges-overlay"
      style={{
        position: "absolute",
        top: HDR_H,
        left: 0,
        width: "100%",
        height: containerH - HDR_H,
        pointerEvents: "none",
        zIndex: 2,
      }}
    >
      <defs>
        <marker
          id="kanonArrow"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0L8 4L0 8z" fill="var(--accent)" />
        </marker>
        <marker
          id="kanonArrowMuted"
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="6"
          markerHeight="6"
          orient="auto"
        >
          <path d="M0 0L8 4L0 8z" fill="var(--line-2)" />
        </marker>
      </defs>
      {edges.map((edge) => {
        // Only render edges that touch the currently hovered bar.
        if (hoveredItemId === null) return null;
        const isRelated =
          hoveredItemId === edge.src.id || hoveredItemId === edge.tgt.id;
        if (!isRelated) return null;

        const sr = rowIndex.get(edge.src.id);
        const tr = rowIndex.get(edge.tgt.id);
        if (sr == null || tr == null) return null;

        const x1 =
          LEFT + ((edge.src.end - CANVAS_START_WEEK) / TOTAL_WEEKS) * trackW;
        const x2 =
          LEFT + ((edge.tgt.start - CANVAS_START_WEEK) / TOTAL_WEEKS) * trackW;
        const y1 = sr * ROW_H + ROW_H / 2;
        const y2 = tr * ROW_H + ROW_H / 2;
        const mx = (x1 + x2) / 2;

        return (
          <g
            key={edge.id}
            data-testid="timeline-edge-group"
            data-related="true"
          >
            <path
              data-testid="timeline-edge"
              d={`M ${x1} ${y1} C ${mx} ${y1}, ${mx} ${y2}, ${x2 - 6} ${y2}`}
              stroke="var(--accent)"
              strokeWidth={1.4}
              fill="none"
              markerEnd="url(#kanonArrow)"
            />
          </g>
        );
      })}
    </svg>
  );
}

// ── Owner grouping helper ────────────────────────────────────────────

/**
 * Re-bucket already-planned timeline items by `owner`. Keeps the per-horizon
 * synthesized geometry intact; only the group structure changes.
 *
 * `null` owners collapse into a single "Unassigned" bucket — until people-on-
 * items lands this is the typical case for every item, so the toggle still
 * gives the user a coherent view rather than an empty group set.
 */
function groupByOwner(horizonGroups: TimelineGroup[]): TimelineGroup[] {
  const byOwner = new Map<string, TimelineItem[]>();
  for (const g of horizonGroups) {
    for (const item of g.items) {
      const key = item.owner ?? unassignedOwnerLabel();
      const bucket = byOwner.get(key);
      if (bucket) {
        bucket.push(item);
      } else {
        byOwner.set(key, [item]);
      }
    }
  }

  const out: TimelineGroup[] = [];
  for (const [owner, ownerItems] of byOwner) {
    // We keep `horizon` on the group object to satisfy the TimelineGroup
    // shape. Owner-mode never reads it for visual cues — GroupHeader picks
    // ink-4 by default in owner mode.
    const firstHorizon = ownerItems[0]?.horizon ?? "now";
    out.push({
      horizon: firstHorizon,
      label: owner,
      sub: "",
      items: ownerItems,
    });
  }
  return out;
}

// (Removed defensive `void` re-exports — unused now that the store imports
// are scoped to what this file actually consumes.)

function Legend() {
  const { t } = useTranslation("roadmap");
  const wrap: CSSProperties = {
    display: "flex",
    gap: 10,
    fontSize: 11,
    color: "var(--ink-3)",
    alignItems: "center",
  };
  return (
    <div style={wrap}>
      {STATUS_LEGEND.map((l) => (
        <span
          key={l.status}
          style={{ display: "inline-flex", alignItems: "center", gap: 5 }}
        >
          <span
            data-testid="legend-swatch"
            data-status={l.status}
            style={{
              width: 8,
              height: 8,
              borderRadius: 2,
              background: l.color,
            }}
          />
          {t(l.labelKey)}
        </span>
      ))}
    </div>
  );
}

