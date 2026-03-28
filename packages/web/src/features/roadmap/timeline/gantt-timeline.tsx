import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { RoadmapItem } from "@/types/roadmap";
import { useRoadmapStore } from "@/stores/roadmap-store";
import { ChartCard } from "../analytics/chart-card";
import { useContainerWidth } from "../use-container-size";
import { useTimelineData } from "./use-timeline-data";
import { TimelineBar } from "./timeline-bar";
import { TimelineTooltip } from "./timeline-tooltip";

interface GanttTimelineProps {
  items: RoadmapItem[];
}

const ROW_HEIGHT = 36;
const Y_AXIS_WIDTH = 180;

/**
 * Main Gantt timeline container.
 * Renders one recharts BarChart per horizon (swimlane) with a shared X-axis time domain.
 * Uses the stacked-bar offset technique: invisible offset bar + visible duration bar.
 * Offset/duration values are RELATIVE to domainStart (not raw timestamps) to avoid
 * floating-point precision issues in recharts rendering.
 */
export function GanttTimeline({ items }: GanttTimelineProps) {
  const [containerRef, containerWidth] = useContainerWidth();
  const { domain, domainStart, groups } = useTimelineData(items);
  const setSelectedItemId = useRoadmapStore((s) => s.setSelectedItemId);
  // Today marker as relative value (offset from domainStart)
  const todayRelative = Date.now() - domainStart;

  // Tick formatter: convert relative ms back to absolute date for display
  function formatTick(relativeMs: number): string {
    const d = new Date(relativeMs + domainStart);
    const month = d.toLocaleString(undefined, { month: "short" });
    const day = d.getDate();
    return `${month} ${day}`;
  }

  // Empty state
  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <p className="text-sm text-on-surface/40">No roadmap items yet</p>
      </div>
    );
  }

  // Sparse state encouragement
  const sparseMessage =
    items.length < 3
      ? "Add more items to see a richer timeline view."
      : undefined;

  return (
    <div ref={containerRef} className="overflow-y-auto h-full pb-6 space-y-4">
      {sparseMessage && (
        <p className="text-xs text-on-surface/50 px-1">{sparseMessage}</p>
      )}

      {groups.map((group) => {
        const chartHeight = Math.max(
          120,
          group.items.length * ROW_HEIGHT + 60,
        );

        return (
          <ChartCard
            key={group.horizon}
            title={group.label}
            subtitle={`${group.items.length} item${group.items.length !== 1 ? "s" : ""}`}
          >
            {containerWidth > 0 && (
              <BarChart
                width={containerWidth}
                height={chartHeight}
                data={group.items}
                layout="vertical"
                margin={{ top: 5, right: 20, bottom: 5, left: 0 }}
                barCategoryGap="20%"
              >
                <XAxis
                  type="number"
                  domain={domain}
                  tickFormatter={formatTick}
                  tick={{ fontSize: 10 }}
                  tickCount={6}
                />
                <YAxis
                  type="category"
                  dataKey="name"
                  width={Y_AXIS_WIDTH}
                  tick={{ fontSize: 11 }}
                />
                <Tooltip
                  content={<TimelineTooltip />}
                  cursor={{ fill: "rgba(0,0,0,0.04)" }}
                />
                <ReferenceLine
                  x={todayRelative}
                  stroke="#EF4444"
                  strokeDasharray="3 3"
                  strokeWidth={1.5}
                  label={{
                    value: "Today",
                    position: "top",
                    fontSize: 10,
                    fill: "#EF4444",
                  }}
                />

                {/* Invisible offset bar — positions the visible bar on the time axis */}
                <Bar
                  dataKey="offset"
                  stackId="timeline"
                  fill="transparent"
                  isAnimationActive={false}
                />

                {/* Visible duration bar — colored by status */}
                <Bar
                  dataKey="duration"
                  stackId="timeline"
                  shape={<TimelineBar />}
                  isAnimationActive={false}
                  onClick={(data) => {
                    if (data?.id) {
                      setSelectedItemId(data.id as string);
                    }
                  }}
                  cursor="pointer"
                />
              </BarChart>
            )}
          </ChartCard>
        );
      })}
    </div>
  );
}
