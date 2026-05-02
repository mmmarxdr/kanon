import { useMemo } from "react";
import type { Horizon, RoadmapItem } from "@/types/roadmap";
import { ChartCard } from "./chart-card";

interface HorizonDistributionChartProps {
  items: RoadmapItem[];
}

/**
 * Single stacked horizontal bar — Now / Next / Later / Someday — matching
 * the redesign's `HorizonStack`. Tokens come straight from the design
 * system (var(--accent), var(--ai), var(--warn), var(--ink-4)) so the
 * chart inherits whatever variant (Mono, Cobalt, Dark, …) is active.
 *
 * Earlier version used hardcoded hex (emerald/amber/blue/gray) from
 * `chart-colors.ts` which broke Mono coherence — fixed.
 */

const HORIZON_ORDER: readonly Horizon[] = ["now", "next", "later", "someday"];

const HORIZON_CONFIG: Record<Horizon, { label: string; color: string }> = {
  now: { label: "Now", color: "var(--accent)" },
  next: { label: "Next", color: "var(--ai, var(--accent))" },
  later: { label: "Later", color: "var(--warn)" },
  someday: { label: "Someday", color: "var(--ink-4)" },
};

export function HorizonDistributionChart({
  items,
}: HorizonDistributionChartProps) {
  const buckets = useMemo(() => {
    const counts: Record<Horizon, number> = {
      now: 0,
      next: 0,
      later: 0,
      someday: 0,
    };
    for (const it of items) counts[it.horizon]++;
    return HORIZON_ORDER.map((h) => ({
      horizon: h,
      ...HORIZON_CONFIG[h],
      count: counts[h],
    }));
  }, [items]);

  const total = buckets.reduce((s, b) => s + b.count, 0);
  const hasData = total > 0;

  return (
    <ChartCard
      title="Horizon distribution"
      subtitle="by horizon · stacked"
      isEmpty={!hasData}
      emptyMessage="No roadmap items yet."
    >
      {/* Stacked bar — flex with `flex: count` so widths are proportional. */}
      <div
        className="flex w-full overflow-hidden"
        style={{
          height: 26,
          borderRadius: 4,
          border: "1px solid var(--line)",
        }}
        role="img"
        aria-label="Horizon distribution stacked bar"
      >
        {buckets.map((b) => {
          if (b.count === 0) return null;
          return (
            <div
              key={b.horizon}
              data-testid="horizon-segment"
              data-horizon={b.horizon}
              className="flex items-center justify-center font-mono"
              style={{
                flex: b.count,
                background: b.color,
                opacity: 0.85,
                minWidth: 28,
                color: "var(--bg, white)",
                fontSize: 11,
                fontWeight: 600,
              }}
              title={`${b.label}: ${b.count} (${Math.round((b.count / total) * 100)}%)`}
            >
              {b.count}
            </div>
          );
        })}
      </div>

      {/* Legend rows — dot · label · count · % */}
      <div className="mt-3 flex flex-col gap-2">
        {buckets.map((b) => {
          const pct = total > 0 ? Math.round((b.count / total) * 100) : 0;
          return (
            <div
              key={b.horizon}
              className="grid items-center gap-2.5"
              style={{ gridTemplateColumns: "8px 1fr auto auto" }}
            >
              <span
                className="inline-block rounded-full"
                style={{ width: 6, height: 6, background: b.color }}
              />
              <span className="text-[12px]" style={{ color: "var(--ink-2)" }}>
                {b.label}
              </span>
              <span
                className="font-mono text-[11px] text-right"
                style={{ color: "var(--ink-3)" }}
              >
                {b.count}
              </span>
              <span
                className="font-mono text-[11px] text-right"
                style={{ width: 40, color: "var(--ink-4)" }}
              >
                {pct}%
              </span>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}
