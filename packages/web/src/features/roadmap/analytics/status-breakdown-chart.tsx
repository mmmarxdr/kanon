import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  Label,
} from "recharts";
import type { RoadmapItem } from "@/types/roadmap";
import { ChartCard } from "./chart-card";
import { ChartTooltip } from "./chart-tooltip";
import { useStatusData } from "./use-analytics-data";
import { useContainerWidth } from "../use-container-size";

const CHART_HEIGHT = 250;

interface StatusBreakdownChartProps {
  items: RoadmapItem[];
}

function CenterLabel({ viewBox, total }: { viewBox?: { cx: number; cy: number }; total: number }) {
  if (!viewBox) return null;
  const { cx, cy } = viewBox;
  return (
    <text x={cx} y={cy} textAnchor="middle" dominantBaseline="central">
      <tspan x={cx} dy="-0.4em" className="fill-on-surface text-2xl font-bold">
        {total}
      </tspan>
      <tspan x={cx} dy="1.4em" className="fill-on-surface/60 text-xs">
        Total
      </tspan>
    </text>
  );
}

export function StatusBreakdownChart({ items }: StatusBreakdownChartProps) {
  const data = useStatusData(items);
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const hasData = data.some((d) => d.count > 0);
  const [containerRef, containerWidth] = useContainerWidth();

  return (
    <ChartCard
      title="Status Breakdown"
      subtitle="Items per status"
      isEmpty={!hasData}
      emptyMessage="No roadmap items yet. Add items to see status breakdown."
    >
      <div ref={containerRef}>
        {containerWidth > 0 && (
          <PieChart width={containerWidth} height={CHART_HEIGHT}>
            <Pie
              data={data.filter((d) => d.count > 0)}
              cx="50%"
              cy="50%"
              innerRadius="60%"
              outerRadius="80%"
              dataKey="count"
              nameKey="label"
              paddingAngle={2}
            >
              {data
                .filter((d) => d.count > 0)
                .map((entry) => (
                  <Cell key={entry.status} fill={entry.fill} />
                ))}
              <Label
                position="center"
                content={<CenterLabel total={total} />}
              />
            </Pie>
            <Tooltip content={<ChartTooltip />} />
          </PieChart>
        )}

        {/* Legend — outside the chart, constrained to card width */}
        <div className="flex flex-wrap gap-3 mt-2 justify-center">
          {data
            .filter((d) => d.count > 0)
            .map((d) => (
              <div key={d.status} className="flex items-center gap-1.5 text-xs text-on-surface/70">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: d.fill }}
                />
                {d.label}
              </div>
            ))}
        </div>
      </div>
    </ChartCard>
  );
}
