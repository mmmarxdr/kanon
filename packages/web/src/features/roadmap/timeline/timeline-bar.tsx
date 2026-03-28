import type { RoadmapStatus } from "@/types/roadmap";
import { STATUS_CHART_COLORS } from "../analytics/chart-colors";

interface TimelineBarProps {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  payload?: {
    isOpenEnded?: boolean;
    status?: RoadmapStatus;
  };
}

/**
 * Custom recharts bar shape for timeline items.
 * - Items with targetDate: solid fill, full opacity, rounded corners.
 * - Open-ended items: 60% opacity + dashed stroke to signal "no end date."
 */
export function TimelineBar({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  payload,
}: TimelineBarProps) {
  if (width <= 0 || height <= 0) return null;

  const isOpenEnded = payload?.isOpenEnded ?? false;
  const status = payload?.status ?? "idea";
  const fill = STATUS_CHART_COLORS[status];
  const radius = 3;

  if (isOpenEnded) {
    return (
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={radius}
        ry={radius}
        fill={fill}
        fillOpacity={0.6}
        stroke={fill}
        strokeWidth={1.5}
        strokeDasharray="4 3"
      />
    );
  }

  return (
    <rect
      x={x}
      y={y}
      width={width}
      height={height}
      rx={radius}
      ry={radius}
      fill={fill}
      fillOpacity={1}
    />
  );
}
