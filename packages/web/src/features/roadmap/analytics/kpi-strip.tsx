import { useMemo } from "react";
import type { RoadmapItem } from "@/types/roadmap";

interface AnalyticsKPIStripProps {
  items: RoadmapItem[];
}

interface KPI {
  key: string;
  label: string;
  value: string;
  sub?: string;
  tone?: string;
}

const DASH = "—";

function meanOrDash(nums: Array<number | null | undefined>, decimals = 1): string {
  const values = nums.filter((n): n is number => typeof n === "number");
  if (values.length === 0) return DASH;
  const mean = values.reduce((s, n) => s + n, 0) / values.length;
  return mean.toFixed(decimals);
}

/**
 * Six-card KPI strip rendered above the analytics chart grid.
 * Cells: Items / In progress / Dependency edges / Avg effort /
 * Avg impact / Now/Next ratio.
 *
 * Empty / null guards: if there are no items, every value renders as a dash.
 */
export function AnalyticsKPIStrip({ items }: AnalyticsKPIStripProps) {
  const kpis = useMemo<KPI[]>(() => {
    const total = items.length;

    if (total === 0) {
      const empty = (key: string, label: string, sub: string): KPI => ({
        key,
        label,
        value: DASH,
        sub,
      });
      return [
        empty("items", "Items", "across 4 horizons"),
        empty("in-progress", "In progress", "% of total"),
        empty("dependency-edges", "Dependency edges", "graph edges"),
        empty("avg-effort", "Avg effort", "scale 1–5"),
        empty("avg-impact", "Avg impact", "scale 1–5"),
        empty("now-next-ratio", "Now / Next ratio", "healthy < 1 : 2"),
      ];
    }

    const inProgressCount = items.filter((i) => i.status === "in_progress").length;
    const inProgressPct = Math.round((inProgressCount / total) * 100);

    // TODO: `RoadmapItem` doesn't expose a `dependencies` field — we use
    // `blocks` (outgoing edges) as the canonical edge count. If we ever
    // expose a richer field this should be updated to read it directly.
    const dependencyEdges = items.reduce(
      (sum, i) => sum + (i.blocks?.length ?? 0),
      0,
    );

    const avgEffort = meanOrDash(items.map((i) => i.effort), 1);
    const avgImpact = meanOrDash(items.map((i) => i.impact), 1);

    const nowCount = items.filter((i) => i.horizon === "now").length;
    const nextCount = items.filter((i) => i.horizon === "next").length;
    const ratio = `${Math.round(nowCount)} : ${Math.round(Math.max(1, nextCount))}`;

    return [
      {
        key: "items",
        label: "Items",
        value: String(total),
        sub: "across 4 horizons",
      },
      {
        key: "in-progress",
        label: "In progress",
        value: `${inProgressPct}%`,
        sub: `${inProgressCount} of ${total}`,
        tone: "var(--accent)",
      },
      {
        key: "dependency-edges",
        label: "Dependency edges",
        value: String(dependencyEdges),
        sub: dependencyEdges === 1 ? "graph edge" : "graph edges",
      },
      {
        key: "avg-effort",
        label: "Avg effort",
        value: avgEffort,
        sub: "scale 1–5",
      },
      {
        key: "avg-impact",
        label: "Avg impact",
        value: avgImpact,
        sub: "scale 1–5",
      },
      {
        key: "now-next-ratio",
        label: "Now / Next ratio",
        value: ratio,
        sub: "healthy < 1 : 2",
      },
    ];
  }, [items]);

  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
        border: "1px solid var(--line)",
        borderRadius: 6,
        background: "var(--panel)",
      }}
    >
      {kpis.map((k, i) => (
        <div
          key={k.key}
          data-kpi={k.key}
          className="flex flex-col gap-[3px]"
          style={{
            padding: 14,
            borderRight: i < kpis.length - 1 ? "1px solid var(--line)" : "none",
            minWidth: 0,
          }}
        >
          <span
            className="font-mono uppercase"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: "0.08em",
            }}
          >
            {k.label}
          </span>
          <span
            data-testid="kpi-value"
            style={{
              fontSize: 24,
              fontWeight: 600,
              letterSpacing: "-0.02em",
              fontVariantNumeric: "tabular-nums",
              color: k.tone ?? "var(--ink)",
            }}
          >
            {k.value}
          </span>
          {k.sub && (
            <span
              className="font-mono"
              style={{ fontSize: 11, color: "var(--ink-3)" }}
            >
              {k.sub}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}
