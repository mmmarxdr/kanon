import type { RoadmapItem, RoadmapStatus } from "@/types/roadmap";
import { ChartCard } from "./chart-card";
import { useStatusData } from "./use-analytics-data";

interface PipelineFunnelProps {
  items: RoadmapItem[];
}

const STAGE_ORDER: readonly RoadmapStatus[] = [
  "idea",
  "planned",
  "in_progress",
  "done",
] as const;

const STAGE_TOKEN_COLOR: Record<RoadmapStatus, string> = {
  idea: "var(--ink-4)",
  planned: "var(--ink-2)",
  in_progress: "var(--accent)",
  done: "var(--ok)",
};

const STAGE_LABELS: Record<RoadmapStatus, string> = {
  idea: "Idea",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
};

/**
 * Pipeline — distribution of items across the four roadmap statuses, drawn
 * as a horizontal stage stack. Bar width is proportional to the largest
 * stage; the right-hand percent shows share of total.
 *
 * Question answered: "Where does our roadmap mass currently sit?"
 * Action enabled: spot a stalled stage (e.g. lots in `planned`, few in
 * `in_progress` — pull more work into delivery).
 *
 * Note on conversion math: an earlier version showed "↳ X%" between stages
 * computed as `next.count / prev.count`. That value is meaningless on a
 * snapshot — when more items have shipped historically than are currently
 * in idea, it produces values like 1000%. Real conversion needs flow
 * tracking (state-change events with timestamps) which we don't have yet,
 * so we deliberately do NOT show it. The funnel is honest about being a
 * state distribution, not a flow.
 */
export function PipelineFunnel({ items }: PipelineFunnelProps) {
  const data = useStatusData(items);
  const total = data.reduce((sum, d) => sum + d.count, 0);
  const hasData = total > 0;

  const byStatus = new Map(data.map((d) => [d.status, d]));
  const stages = STAGE_ORDER.map((s) => {
    const bucket = byStatus.get(s);
    return {
      status: s,
      label: STAGE_LABELS[s],
      count: bucket?.count ?? 0,
      color: STAGE_TOKEN_COLOR[s],
    };
  });

  const max = Math.max(...stages.map((s) => s.count), 1);

  // Honest insight: which stage holds the most items, and what share?
  // Surfaces stalls (e.g. "63% of items are in planned") without inventing
  // a flow-conversion number we can't actually compute.
  const dominantStage = [...stages].sort((a, b) => b.count - a.count)[0];
  const dominantShare =
    dominantStage && total > 0
      ? Math.round((dominantStage.count / total) * 100)
      : 0;
  const wipCount = byStatus.get("in_progress")?.count ?? 0;
  const wipShare = total > 0 ? Math.round((wipCount / total) * 100) : 0;

  return (
    <ChartCard
      title="Pipeline"
      subtitle="state distribution · all horizons"
      isEmpty={!hasData}
      emptyMessage="No roadmap items yet. Add items to see the pipeline."
    >
      <div className="flex flex-col gap-1.5">
        {stages.map((s) => {
          const widthPct = max > 0 ? (s.count / max) * 100 : 0;
          const sharePct = total > 0 ? Math.round((s.count / total) * 100) : 0;
          return (
            <div
              key={s.status}
              className="grid items-center gap-2"
              style={{ gridTemplateColumns: "100px 1fr 60px" }}
            >
              <span
                className="text-xs flex items-center gap-1.5"
                style={{ color: "var(--ink-2)" }}
              >
                <span
                  className="inline-block"
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: 1,
                    backgroundColor: s.color,
                  }}
                />
                {s.label}
              </span>
              <div
                data-testid="pipeline-stage"
                data-status={s.status}
                className="relative overflow-hidden"
                style={{
                  height: 22,
                  background: "var(--bg-2)",
                  borderRadius: 3,
                  minWidth: 0,
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    width: `${widthPct}%`,
                    backgroundColor: s.color,
                    opacity: 0.2,
                  }}
                />
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: "100%",
                    width: `${widthPct}%`,
                    borderRight: `2px solid ${s.color}`,
                  }}
                />
                <span
                  className="font-mono"
                  style={{
                    position: "absolute",
                    left: 8,
                    top: 0,
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    fontSize: 11,
                    color: "var(--ink-2)",
                    whiteSpace: "nowrap",
                  }}
                >
                  {s.count}
                </span>
              </div>
              <span
                className="font-mono text-[11px] text-right"
                style={{ color: "var(--ink-3)" }}
              >
                {sharePct}%
              </span>
            </div>
          );
        })}
      </div>

      {dominantStage && (
        <div
          data-testid="pipeline-insight"
          className="mt-4 rounded"
          style={{
            padding: 12,
            background: "var(--bg-2)",
            border: "1px solid var(--line)",
          }}
        >
          <div
            className="font-mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              letterSpacing: "0.06em",
              textTransform: "uppercase",
              marginBottom: 6,
            }}
          >
            Where the work is
          </div>
          <div
            className="text-xs"
            style={{ color: "var(--ink-2)", lineHeight: 1.5 }}
          >
            <span style={{ fontWeight: 600 }}>{dominantShare}%</span> of items
            are in <span style={{ fontWeight: 600 }}>{dominantStage.label.toLowerCase()}</span>
            {dominantStage.status !== "in_progress" && wipCount > 0 && (
              <>
                {" "}
                · only{" "}
                <span style={{ fontWeight: 600 }}>{wipShare}%</span> in
                progress
              </>
            )}
            .
          </div>
        </div>
      )}
    </ChartCard>
  );
}
