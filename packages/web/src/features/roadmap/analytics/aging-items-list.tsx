import type { RoadmapItem } from "@/types/roadmap";
import { HORIZON_CHART_COLORS } from "./chart-colors";
import { HORIZON_LABELS } from "@/stores/roadmap-store";
import { ChartCard } from "./chart-card";
import { useAgingData } from "./use-analytics-data";

interface AgingItemsListProps {
  items: RoadmapItem[];
  thresholdDays?: number;
}

export function AgingItemsList({ items, thresholdDays = 30 }: AgingItemsListProps) {
  const agingItems = useAgingData(items, thresholdDays);

  return (
    <ChartCard
      title="Aging Ideas"
      subtitle={`Items in "idea" status for ${thresholdDays}+ days`}
      isEmpty={agingItems.length === 0}
      emptyMessage="No aging items — roadmap is fresh!"
    >
      <ul className="space-y-2 max-h-60 overflow-y-auto">
        {agingItems.map((item) => (
          <li
            key={item.id}
            className="flex items-center gap-3 py-2 px-2 rounded hover:bg-primary-fixed/10 transition-colors"
          >
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-on-surface truncate">
                {item.title}
              </p>
              <p className="text-xs text-on-surface/50">
                {item.ageDays} day{item.ageDays !== 1 ? "s" : ""} old
              </p>
            </div>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold text-white shrink-0"
              style={{ backgroundColor: HORIZON_CHART_COLORS[item.horizon] }}
            >
              {HORIZON_LABELS[item.horizon]}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
