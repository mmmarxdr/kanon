import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
} from "recharts";
import type { RoadmapItem } from "@/types/roadmap";
import { HORIZON_CHART_COLORS } from "./chart-colors";
import { ChartCard } from "./chart-card";
import { useEffortImpactData, type EffortImpactPoint } from "./use-analytics-data";
import { useContainerWidth } from "../use-container-size";
import { useI18n } from "@/hooks/use-i18n";

const CHART_HEIGHT = 320;

interface EffortImpactChartProps {
  items: RoadmapItem[];
}

function CustomTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: EffortImpactPoint }> }) {
  const { t } = useI18n();
  const horizonLabel = (horizon: EffortImpactPoint["horizon"]) =>
    horizon === "now"
      ? t("roadmap.horizon.now")
      : horizon === "next"
        ? t("roadmap.horizon.next")
        : horizon === "later"
          ? t("roadmap.horizon.later")
          : t("roadmap.horizon.someday");
  if (!active || !payload?.length) return null;
  const entry = payload[0];
  if (!entry) return null;
  const point = entry.payload;
  return (
    <div className="bg-surface-container-lowest rounded-md shadow-float p-2 text-xs text-on-surface">
      <p className="font-medium">{point.title}</p>
      <p className="text-on-surface/60 mt-1">
        {t("roadmap.analytics.effortImpact.tooltipEffort")}: {point.effort} &middot; {t("roadmap.analytics.effortImpact.tooltipImpact")}: {point.impact}
      </p>
      <p className="text-on-surface/60">
        {t("roadmap.analytics.effortImpact.tooltipHorizon")}: {horizonLabel(point.horizon)}
      </p>
    </div>
  );
}

export function EffortImpactChart({ items }: EffortImpactChartProps) {
  const { t } = useI18n();
  const horizonLabel = (horizon: string) =>
    horizon === "now"
      ? t("roadmap.horizon.now")
      : horizon === "next"
        ? t("roadmap.horizon.next")
        : horizon === "later"
          ? t("roadmap.horizon.later")
          : t("roadmap.horizon.someday");
  const data = useEffortImpactData(items);
  const [containerRef, containerWidth] = useContainerWidth();

  return (
    <ChartCard
      title={t("roadmap.analytics.effortImpact.title")}
      subtitle={t("roadmap.analytics.effortImpact.subtitle")}
      isEmpty={data.length === 0}
      emptyMessage={t("roadmap.analytics.effortImpact.empty")}
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
              name={t("roadmap.analytics.effortImpact.axisEffort")}
              domain={[0.5, 5.5]}
              ticks={[1, 2, 3, 4, 5]}
              tick={{ fontSize: 11 }}
              label={{ value: t("roadmap.analytics.effortImpact.axisEffort"), position: "insideBottom", offset: -5, fontSize: 11 }}
            />
            <YAxis
              type="number"
              dataKey="impact"
              name={t("roadmap.analytics.effortImpact.axisImpact")}
              domain={[0.5, 5.5]}
              ticks={[1, 2, 3, 4, 5]}
              tick={{ fontSize: 11 }}
              label={{ value: t("roadmap.analytics.effortImpact.axisImpact"), angle: -90, position: "insideLeft", offset: 10, fontSize: 11 }}
            />
            <ReferenceLine x={2.5} stroke="#94a3b8" strokeDasharray="3 3" opacity={0.4} />
            <ReferenceLine y={2.5} stroke="#94a3b8" strokeDasharray="3 3" opacity={0.4} />
            <Tooltip content={<CustomTooltip />} />
            {/* Render one Scatter per horizon for color coding */}
            {(Object.entries(HORIZON_CHART_COLORS) as [string, string][]).map(
              ([horizon, color]) => {
                const horizonData = data.filter((d) => d.horizon === horizon);
                if (horizonData.length === 0) return null;
                return (
                  <Scatter
                    key={horizon}
                    name={horizonLabel(horizon)}
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
                    {horizonLabel(horizon)}
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
