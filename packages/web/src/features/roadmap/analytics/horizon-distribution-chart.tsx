import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  Cell,
  LabelList,
} from "recharts";
import type { RoadmapItem } from "@/types/roadmap";
import { ChartCard } from "./chart-card";
import { ChartTooltip } from "./chart-tooltip";
import { useHorizonData } from "./use-analytics-data";
import { useContainerWidth } from "../use-container-size";
import { useI18n } from "@/hooks/use-i18n";

const CHART_HEIGHT = 250;

interface HorizonDistributionChartProps {
  items: RoadmapItem[];
}

export function HorizonDistributionChart({ items }: HorizonDistributionChartProps) {
  const { t } = useI18n();
  const data = useHorizonData(items);
  const localizedData = data.map((d) => ({
    ...d,
    label:
      d.horizon === "now"
        ? t("roadmap.horizon.now")
        : d.horizon === "next"
          ? t("roadmap.horizon.next")
          : d.horizon === "later"
            ? t("roadmap.horizon.later")
            : t("roadmap.horizon.someday"),
  }));
  const hasData = data.some((d) => d.count > 0);
  const [containerRef, containerWidth] = useContainerWidth();

  return (
    <ChartCard
      title={t("roadmap.analytics.horizonDistribution.title")}
      subtitle={t("roadmap.analytics.horizonDistribution.subtitle")}
      isEmpty={!hasData}
      emptyMessage={t("roadmap.analytics.horizonDistribution.empty")}
    >
      <div ref={containerRef}>
        {containerWidth > 0 && (
          <BarChart
            width={containerWidth}
            height={CHART_HEIGHT}
            data={localizedData}
            layout="horizontal"
            margin={{ top: 10, right: 10, bottom: 5, left: 0 }}
          >
            <XAxis dataKey="label" tick={{ fontSize: 11 }} />
            <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
            <Tooltip content={<ChartTooltip />} />
            <Legend wrapperStyle={{ fontSize: 12 }} verticalAlign="bottom" height={36} />
            <Bar dataKey="count" radius={[4, 4, 0, 0]}>
              {data.map((entry) => (
                <Cell key={entry.horizon} fill={entry.fill} />
              ))}
              <LabelList dataKey="count" position="top" fontSize={11} />
            </Bar>
          </BarChart>
        )}
      </div>
    </ChartCard>
  );
}
