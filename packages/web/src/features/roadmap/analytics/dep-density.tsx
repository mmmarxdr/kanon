import { useMemo } from "react";
import type { RoadmapItem } from "@/types/roadmap";
import { ChartCard } from "./chart-card";

interface DepDensityProps {
  items: RoadmapItem[];
}

/**
 * Dependency hotspots — surfaces the items that BLOCK the most others
 * (critical path candidates) and the items that are MOST BLOCKED
 * (downstream chokepoints). Real data: derived from `blocks` + `dependsOn`.
 *
 * Question answered: "Where is the dependency risk concentrated?"
 * Action enabled: protect blockers; unblock the chokepoints.
 */
export function DepDensity({ items }: DepDensityProps) {
  const { topBlockers, mostBlocked, worstBlocker } = useMemo(() => {
    const blockerScore = (it: RoadmapItem) => it.blocks?.length ?? 0;
    const blockedScore = (it: RoadmapItem) => it.dependsOn?.length ?? 0;

    const topBlockers = [...items]
      .map((it) => ({ item: it, count: blockerScore(it) }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    const mostBlocked = [...items]
      .map((it) => ({ item: it, count: blockedScore(it) }))
      .filter((x) => x.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return {
      topBlockers,
      mostBlocked,
      worstBlocker: topBlockers[0],
    };
  }, [items]);

  const isEmpty = topBlockers.length === 0 && mostBlocked.length === 0;

  return (
    <ChartCard
      title="Dependency hotspots"
      subtitle="who blocks · who's blocked"
      isEmpty={isEmpty}
      emptyMessage="No dependencies recorded yet."
    >
      <div className="grid grid-cols-2 gap-5">
        <Column
          label="Top blockers"
          rows={topBlockers}
          countLabel={(n) => `blocks ${n}`}
          countTone="var(--color-accent, var(--accent))"
        />
        <Column
          label="Most blocked"
          rows={mostBlocked}
          countLabel={(n) => `← ${n}`}
          countTone="var(--color-warn, var(--warn))"
        />
      </div>

      {worstBlocker && (
        <div
          className="mt-4 flex items-start gap-2 rounded p-2.5 text-[12px]"
          style={{
            background: "var(--color-bg-2, var(--bg-2))",
            color: "var(--color-ink-2, var(--ink-2))",
          }}
        >
          <span
            className="inline-flex items-center justify-center font-bold flex-shrink-0"
            style={{
              width: 16,
              height: 16,
              borderRadius: 3,
              background: "var(--color-accent, var(--accent))",
              color: "var(--color-bg, var(--bg))",
              fontSize: 10,
            }}
          >
            ✦
          </span>
          <span>
            <span className="font-mono text-[11px]">{shortId(worstBlocker.item.id)}</span>
            {" · "}
            <span className="font-medium">{worstBlocker.item.title}</span>
            {" "}is the heaviest blocker — it gates{" "}
            <span className="font-semibold">
              {worstBlocker.count} downstream item{worstBlocker.count === 1 ? "" : "s"}
            </span>
            . Move first.
          </span>
        </div>
      )}
    </ChartCard>
  );
}

interface ColumnProps {
  label: string;
  rows: { item: RoadmapItem; count: number }[];
  countLabel: (n: number) => string;
  countTone: string;
}

function Column({ label, rows, countLabel, countTone }: ColumnProps) {
  return (
    <div>
      <div
        className="font-mono text-[10.5px] uppercase mb-2"
        style={{
          color: "var(--color-ink-4, var(--ink-4))",
          letterSpacing: "0.08em",
        }}
      >
        {label}
      </div>
      {rows.length === 0 ? (
        <div
          className="text-[11px]"
          style={{ color: "var(--color-ink-4, var(--ink-4))" }}
        >
          —
        </div>
      ) : (
        <ul className="flex flex-col">
          {rows.map(({ item, count }) => (
            <li
              key={item.id}
              className="grid items-center gap-2 py-1.5"
              style={{
                gridTemplateColumns: "1fr auto",
                borderBottom: "1px solid var(--color-line, var(--line))",
              }}
            >
              <div className="min-w-0">
                <div
                  className="text-[12px] truncate"
                  style={{ color: "var(--color-ink-2, var(--ink-2))" }}
                >
                  {item.title}
                </div>
                <div
                  className="font-mono text-[10px] mt-0.5"
                  style={{ color: "var(--color-ink-4, var(--ink-4))" }}
                >
                  {shortId(item.id)} · {item.horizon}
                </div>
              </div>
              <span
                className="font-mono text-[11px]"
                style={{ color: countTone }}
              >
                {countLabel(count)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function shortId(id: string): string {
  return id.slice(0, 8);
}
