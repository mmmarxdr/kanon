import type { CSSProperties } from "react";
import type { RoadmapStatus } from "@/types/roadmap";
import type { TimelineItem } from "./use-timeline-data";

interface TimelineBarProps {
  item: TimelineItem;
  /** Pixel offset from the canvas left edge. */
  left: number;
  /** Pixel width. */
  width: number;
  /** Optional click handler — wired to setSelectedItemId. */
  onClick?: (id: string) => void;
  /**
   * KAN-33: Currently-hovered item id (lifted to the gantt parent).
   * - When equal to `item.id` → bar gets the accent glow + raised z-index.
   * - When set to a different id → bar dims to 0.4 opacity.
   * - When null → bar renders at full opacity, no glow.
   */
  hoveredItemId?: string | null;
  /** Hover-state change callback wired by the parent. */
  onHoverChange?: (id: string | null) => void;
}

const ROW_INNER_HEIGHT = 24;
const MIN_BAR_WIDTH = 32;

interface BarStyleTokens {
  /** Background fill (panel-mixed for solid statuses, transparent for ideas). */
  background: string;
  /** Border color. */
  border: string;
  /** "dashed" for idea, otherwise "solid". */
  borderStyle: "dashed" | "solid";
  /** 0..1, drawn as a left-anchored fill on top of the background. */
  progress: number;
}

/**
 * Maps a status to the visual tokens used by the bar. Mirrors the design's
 * `statusColor` + bar styling block.
 */
function tokensFor(status: RoadmapStatus): BarStyleTokens {
  switch (status) {
    case "in_progress":
      return {
        background: "color-mix(in oklch, var(--accent) 18%, var(--panel))",
        border: "var(--accent)",
        borderStyle: "solid",
        progress: 0.45,
      };
    case "done":
      return {
        background: "color-mix(in oklch, var(--ok) 14%, var(--panel))",
        border: "var(--ok)",
        borderStyle: "solid",
        progress: 1,
      };
    case "planned":
      return {
        background: "var(--panel)",
        border: "var(--line-2)",
        borderStyle: "solid",
        progress: 0,
      };
    case "idea":
    default:
      return {
        background: "var(--bg-3)",
        border: "var(--line-2)",
        borderStyle: "dashed",
        progress: 0,
      };
  }
}

/**
 * Absolute-positioned bar inside a row. The parent row supplies the row's
 * vertical box; this component handles horizontal placement, fill, border,
 * progress overlay, and the title + E·I micro-label.
 */
export function TimelineBar({
  item,
  left,
  width,
  onClick,
  hoveredItemId = null,
  onHoverChange,
}: TimelineBarProps) {
  const tokens = tokensFor(item.status);
  const w = Math.max(width, MIN_BAR_WIDTH);

  const isHovered = hoveredItemId !== null && hoveredItemId === item.id;
  const isDimmed = hoveredItemId !== null && hoveredItemId !== item.id;

  const style: CSSProperties = {
    position: "absolute",
    top: 6,
    height: ROW_INNER_HEIGHT,
    left: `${left}px`,
    width: `${w}px`,
    borderRadius: 4,
    background: tokens.background,
    borderWidth: 1,
    borderStyle: tokens.borderStyle,
    borderColor: tokens.border,
    display: "flex",
    alignItems: "center",
    padding: "0 8px",
    gap: 6,
    overflow: "hidden",
    cursor: onClick ? "pointer" : "default",
    zIndex: isHovered ? 3 : 2,
    opacity: isDimmed ? 0.4 : 1,
    boxShadow: isHovered
      ? "0 0 0 1px var(--accent), 0 0 12px color-mix(in oklch, var(--accent) 30%, transparent)"
      : "none",
    transition: "opacity 120ms ease, box-shadow 120ms ease",
  };

  const showProgress = tokens.progress > 0 && tokens.progress < 1;

  const effortLabel = item.effort == null ? "—" : String(item.effort);
  const impactLabel = item.impact == null ? "—" : String(item.impact);

  const handleMouseEnter = onHoverChange
    ? () => onHoverChange(item.id)
    : undefined;
  const handleMouseLeave = onHoverChange
    ? () => onHoverChange(null)
    : undefined;

  return (
    <div
      data-testid="timeline-bar"
      data-status={item.status}
      data-id={item.id}
      style={style}
      onClick={onClick ? () => onClick(item.id) : undefined}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      {showProgress && (
        <div
          data-testid="timeline-bar-progress"
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: `${tokens.progress * 100}%`,
            background: "color-mix(in oklch, var(--accent) 14%, transparent)",
            borderRight: "1px solid var(--accent)",
            borderRadius: "4px 0 0 4px",
            pointerEvents: "none",
          }}
        />
      )}
      <span
        style={{
          fontSize: 11,
          fontWeight: 500,
          color: "var(--ink)",
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
          zIndex: 1,
          minWidth: 0,
        }}
      >
        {item.title}
      </span>
      <span style={{ flex: 1 }} />
      <span
        className="mono"
        style={{
          fontSize: 9.5,
          color: "var(--ink-4)",
          zIndex: 1,
          flexShrink: 0,
        }}
      >
        E{effortLabel}·I{impactLabel}
      </span>
    </div>
  );
}
