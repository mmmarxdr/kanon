import type { RoadmapItem } from "@/types/roadmap";
import { AnalyticsKPIStrip } from "./kpi-strip";
import { EffortImpactChart } from "./effort-impact-chart";
import { HorizonDistributionChart } from "./horizon-distribution-chart";
import { PipelineFunnel } from "./pipeline-funnel";
import { DepDensity } from "./dep-density";
import { ThroughputChart } from "./throughput-chart";
import { ConfidenceTable } from "./confidence-table";
import { predictShipDates } from "./predict-ship-dates";

interface AnalyticsDashboardProps {
  items: RoadmapItem[];
}

/**
 * Roadmap analytics — KPI strip on top, then 3 rows of 2-column chart cards
 * matching the redesign layout. Every tile answers a single question.
 *
 * Row 1: portfolio shape (Effort × Impact) + delivery flow (Pipeline funnel)
 * Row 2: where dependencies hurt (Dep density) + how fast we ship (Throughput)
 * Row 3: horizon mix (Horizon distribution) + AI ETAs (Confidence table)
 */
export function AnalyticsDashboard({ items }: AnalyticsDashboardProps) {
  return (
    <div className="flex flex-col gap-4 p-1 pb-6 h-full overflow-y-auto">
      <AnalyticsKPIStrip items={items} />

      <div className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-4">
        <EffortImpactChart items={items} />
        <PipelineFunnel items={items} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <DepDensity items={items} />
        <ThroughputChart items={items} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_1.3fr] gap-4">
        <HorizonDistributionChart items={items} />
        <ConfidenceTable items={items} predictions={predictShipDates(items)} />
      </div>
    </div>
  );
}
