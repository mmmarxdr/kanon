import { PieChart, Pie, Cell } from "recharts";
import type { RoadmapItem } from "@/types/roadmap";
import { ChartCard } from "./chart-card";
import { usePromotionData } from "./use-analytics-data";

interface PromotionRateCardProps {
  items: RoadmapItem[];
}

export function PromotionRateCard({ items }: PromotionRateCardProps) {
  const { promoted, total, rate } = usePromotionData(items);

  const ringData = [
    { name: "Promoted", value: promoted },
    { name: "Remaining", value: Math.max(total - promoted, 0) },
  ];

  return (
    <ChartCard
      title="Promotion Rate"
      subtitle="Roadmap items promoted to issues"
      isEmpty={total === 0}
      emptyMessage="No roadmap items yet."
    >
      <div className="flex items-center gap-6">
        {/* Large percentage */}
        <div className="flex-1">
          <p className="text-4xl font-bold text-on-surface">{rate}%</p>
          <p className="text-sm text-on-surface/60 mt-1">
            {promoted} / {total} promoted
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
