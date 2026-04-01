import { PieChart, Pie, Cell } from "recharts";
import type { RoadmapItem } from "@/types/roadmap";
import { ChartCard } from "./chart-card";
import { usePromotionData } from "./use-analytics-data";
import { useI18n } from "@/hooks/use-i18n";

interface PromotionRateCardProps {
  items: RoadmapItem[];
}

export function PromotionRateCard({ items }: PromotionRateCardProps) {
  const { t } = useI18n();
  const { promoted, total, rate } = usePromotionData(items);

  const ringData = [
    { name: t("roadmap.analytics.promotionRate.legendPromoted"), value: promoted },
    { name: t("roadmap.analytics.promotionRate.legendRemaining"), value: Math.max(total - promoted, 0) },
  ];

  return (
    <ChartCard
      title={t("roadmap.analytics.promotionRate.title")}
      subtitle={t("roadmap.analytics.promotionRate.subtitle")}
      isEmpty={total === 0}
      emptyMessage={t("roadmap.analytics.promotionRate.empty")}
    >
      <div className="flex items-center gap-6">
        {/* Large percentage */}
        <div className="flex-1">
          <p className="text-4xl font-bold text-on-surface">{rate}%</p>
          <p className="text-sm text-on-surface/60 mt-1">
            {promoted} / {total} {t("roadmap.analytics.promotionRate.promoted")}
          </p>
        </div>

        {/* Small progress ring */}
        <div>
            <PieChart width={80} height={80}>
              <Pie
                data={ringData}
                cx="50%"
                cy="50%"
                innerRadius="70%"
                outerRadius="100%"
                dataKey="value"
                startAngle={90}
                endAngle={-270}
                strokeWidth={0}
              >
                <Cell fill="#10B981" />
                <Cell fill="#e5e7eb" />
              </Pie>
            </PieChart>
        </div>
      </div>
    </ChartCard>
  );
}
