import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  usePlotArea,
} from "recharts";
import { useTranslation } from "react-i18next";
import type { RoadmapItem } from "@/types/roadmap";
import { HORIZON_CHART_COLORS } from "./chart-colors";
import { HORIZON_LABELS } from "@/stores/roadmap-store";
import { ChartCard } from "./chart-card";
import { useEffortImpactData, type EffortImpactPoint } from "./use-analytics-data";
import { useContainerWidth } from "../use-container-size";

const CHART_HEIGHT = 320;

interface EffortImpactChartProps {
  items: RoadmapItem[];
}

/**
 * SVG quadrant labels overlaid on the scatter plot:
 *   top-left  = QUICK WINS  (low effort, high impact)
 *   top-right = BIG BETS    (high effort, high impact)
 *   bottom-left  = FILLER     (low effort, low impact)
 *   bottom-right = MONEY PITS (high effort, low impact)
 *
 * Rendered as a child of the recharts ScatterChart and reads the resolved
 * plot rectangle via `usePlotArea()` so it tracks resizes automatically.
 */
function QuadrantLabels() {
  const plot = usePlotArea();
  if (!plot || !plot.width || !plot.height) return null;
  const { x: left, y: top, width, height } = plot;
  const PAD = 14;
  const labelStyle = {
    fontFamily: "JetBrains Mono, ui-monospace, monospace",
    fontSize: 10,
    letterSpacing: "0.06em",
    fill: "var(--ink-4)",
    pointerEvents: "none" as const,
  };
  return (
    <g aria-hidden="true">
      <text
        x={left + PAD}
        y={top + PAD}
        textAnchor="start"
        dominantBaseline="hanging"
        style={labelStyle}
      >
        QUICK WINS
      </text>
      <text
        x={left + width - PAD}
        y={top + PAD}
        textAnchor="end"
        dominantBaseline="hanging"
        style={labelStyle}
      >
        BIG BETS
      </text>
      <text
        x={left + PAD}
        y={top + height - PAD}
        textAnchor="start"
        dominantBaseline="auto"
        style={labelStyle}
      >
        FILLER
      </text>
      <text
        x={left + width - PAD}
        y={top + height - PAD}
        textAnchor="end"
        dominantBaseline="auto"
        style={labelStyle}
      >
        MONEY PITS
      </text>
    </g>
  );
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: EffortImpactPoint }> }) {
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry) return null;
  const point = entry.payload;
  return (
    <div className="bg-surface-container-lowest rounded-md shadow-float p-2 text-xs text-on-surface">
      <p className="font-medium">{point.title}</p>
      <p className="text-on-surface/60 mt-1">
        Effort: {point.effort} &middot; Impact: {point.impact}
      </p>
      <p className="text-on-surface/60">
        Horizon: {HORIZON_LABELS[point.horizon]}
      </p>
    </div>
  );
}

export function EffortImpactChart({ items }: EffortImpactChartProps) {
  const { t } = useTranslation("roadmap");
  const data = useEffortImpactData(items);
  const [containerRef, containerWidth] = useContainerWidth();

  return (
    <ChartCard
      title={t("analyticsEffortVsImpact")}
      subtitle="Items with both scores plotted"
      isEmpty={data.length === 0}
      emptyMessage={t("emptyEffortImpact")}
    >
      <div ref={containerRef}>
        {containerWidth > 0 && (
          <ScatterChart
            width={containerWidth}
            height={CHART_HEIGHT}
            margin={{ top: 10, right: 10, bottom: 10, left: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="var(--color-outline-variant, #e2e8f0)" opacity={0.3} />
            <XAxis
              type="number"
              dataKey="effort"
              name="Effort"
              domain={[0.5, 5.5]}
              ticks={[1, 2, 3, 4, 5]}
              tick={{ fontSize: 11 }}
              label={{ value: "Effort", position: "insideBottom", offset: -5, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="impact"
              name="Impact"
              domain={[0.5, 5.5]}
              ticks={[1, 2, 3, 4, 5]}
              tick={{ fontSize: 11 }}
              label={{ value: "Impact", angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }}
            />
            <ReferenceLine x={2.5} stroke="#94a3b8" strokeDasharray="3 3" opacity={0.4} />
            <ReferenceLine y={2.5} stroke="#94a3b8" strokeDasharray="3 3" opacity={0.4} />
            <QuadrantLabels />
            <Tooltip content={<CustomTooltip />} />
            {/* Render one Scatter per horizon for color coding */}
            {(Object.entries(HORIZON_CHART_COLORS) as [string, string][]).map(
              ([horizon, color]) => {
                const horizonData = data.filter((d) => d.horizon === horizon);
                if (horizonData.length === 0) return null;
                return (
                  <Scatter
                    key={horizon}
                    name={HORIZON_LABELS[horizon as keyof typeof HORIZON_LABELS]}
                    data={horizonData}
                    fill={color}
                    fillOpacity={0.8}
                    r={6}
                  />
                );
              },
            )}
          </ScatterChart>
        )}

        {/* Legend — outside the chart, constrained to card width */}
        {data.length > 0 && (
          <div className="flex flex-wrap gap-3 mt-2 justify-center">
            {(Object.entries(HORIZON_CHART_COLORS) as [string, string][]).map(
              ([horizon, color]) => {
                const hasData = data.some((d) => d.horizon === horizon);
                if (!hasData) return null;
                return (
                  <div key={horizon} className="flex items-center gap-1.5 text-xs text-on-surface/70">
                    <span
                      className="inline-block w-2.5 h-2.5 rounded-full"
                      style={{ backgroundColor: color }}
                    />
                    {HORIZON_LABELS[horizon as keyof typeof HORIZON_LABELS]}
                  </div>
                );
              },
            )}
          </div>
        )}
      </div>
    </ChartCard>
  );
}
