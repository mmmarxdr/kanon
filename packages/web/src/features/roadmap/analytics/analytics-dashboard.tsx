import type { RoadmapItem } from "@/types/roadmap";
import { EffortImpactChart } from "./effort-impact-chart";
import { HorizonDistributionChart } from "./horizon-distribution-chart";
import { StatusBreakdownChart } from "./status-breakdown-chart";
import { PromotionRateCard } from "./promotion-rate-card";
import { AgingItemsList } from "./aging-items-list";

interface AnalyticsDashboardProps {
  items: RoadmapItem[];
}

/**
 * Analytics dashboard — responsive grid of chart cards.
 * 2 columns on desktop (>=768px), 1 column on mobile.
 */
export function AnalyticsDashboard({ items }: AnalyticsDashboardProps) {
  return (
    <div
      className="grid gap-4 pb-6 overflow-y-auto"
      style={{
        gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 360px), 1fr))",
      }}
    >
      <EffortImpactChart items={items} />
      <HorizonDistributionChart items={items} />
      <StatusBreakdownChart items={items} />
      <PromotionRateCard items={items} />
      <AgingItemsList items={items} />
    </div>
  );
}
