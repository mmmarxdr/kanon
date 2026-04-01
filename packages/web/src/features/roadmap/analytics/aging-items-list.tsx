import type { RoadmapItem } from "@/types/roadmap";
import { HORIZON_CHART_COLORS } from "./chart-colors";
import { ChartCard } from "./chart-card";
import { useAgingData } from "./use-analytics-data";
import { useI18n } from "@/hooks/use-i18n";

interface AgingItemsListProps {
  items: RoadmapItem[];
  thresholdDays?: number;
}

export function AgingItemsList({ items, thresholdDays = 30 }: AgingItemsListProps) {
  const { t } = useI18n();
  const agingItems = useAgingData(items, thresholdDays);

  return (
    <ChartCard
      title={t("roadmap.analytics.aging.title")}
      subtitle={`${t("roadmap.analytics.aging.subtitlePrefix")} ${thresholdDays}+ ${t("roadmap.analytics.aging.subtitleSuffix")}`}
      isEmpty={agingItems.length === 0}
      emptyMessage={t("roadmap.analytics.aging.empty")}
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
                {item.ageDays}{" "}
                {item.ageDays === 1
                  ? t("roadmap.analytics.aging.dayOne")
                  : t("roadmap.analytics.aging.dayOther")}
              </p>
            </div>
            <span
              className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold text-white shrink-0"
              style={{ backgroundColor: HORIZON_CHART_COLORS[item.horizon] }}
            >
              {item.horizon === "now"
                ? t("roadmap.horizon.now")
                : item.horizon === "next"
                  ? t("roadmap.horizon.next")
                  : item.horizon === "later"
                    ? t("roadmap.horizon.later")
                    : t("roadmap.horizon.someday")}
            </span>
          </li>
        ))}
      </ul>
    </ChartCard>
  );
}
