import type { RoadmapItem } from "@/types/roadmap";
import { ChartCard } from "./chart-card";

interface ConfidenceTableProps {
  items: RoadmapItem[];
  /**
   * Optional list of AI-derived predictions. When absent, the table renders a
   * structural skeleton + an honest empty state so the user understands
   * "this needs the Claude MCP integration to populate". We intentionally do
   * NOT fabricate ETAs.
   */
  predictions?: ShipPrediction[];
}

export interface ShipPrediction {
  itemId: string;
  /** Week label like "w 12" or ISO date string. */
  eta: string;
  /** 0..1 — confidence score from the predictor. */
  confidence: number;
}

/**
 * Predicted ship dates — Claude / MCP forecasted ETA per roadmap item with a
 * confidence band. We render the structure + a "connect Claude MCP" empty
 * state until the predictor wiring lands, rather than show synthetic numbers.
 *
 * Question answered: "When will item X likely ship?"
 * Action enabled: communicate dates to stakeholders with a confidence tag.
 */
export function ConfidenceTable({ items, predictions = [] }: ConfidenceTableProps) {
  const rows = predictions
    .map((p) => {
      const item = items.find((it) => it.id === p.itemId);
      if (!item) return null;
      return { item, prediction: p };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null)
    .slice(0, 8);

  return (
    <ChartCard
      title="Predicted ship dates"
      subtitle={
        rows.length > 0
          ? "rule-based · horizon + effort + blockers"
          : "Claude · MCP"
      }
      headerRight={
        <span
          className="font-mono text-[10px]"
          style={{ color: "var(--color-ink-4, var(--ink-4))" }}
        >
          {rows.length > 0 ? `top ${rows.length} earliest` : "not connected"}
        </span>
      }
    >
      <div
        className="grid items-center gap-2.5 pb-2"
        style={{
          gridTemplateColumns: "70px 1fr 90px 70px 90px",
          borderBottom: "1px solid var(--color-line, var(--line))",
        }}
      >
        {["Id", "Item", "Horizon", "ETA", "Confidence"].map((h) => (
          <span
            key={h}
            className="font-mono text-[9.5px] uppercase"
            style={{
              color: "var(--color-ink-4, var(--ink-4))",
              letterSpacing: "0.08em",
            }}
          >
            {h}
          </span>
        ))}
      </div>

      {rows.length === 0 ? (
        <div className="py-8 flex flex-col items-center justify-center gap-2 text-center">
          <span
            className="font-mono text-[10.5px] uppercase"
            style={{
              color: "var(--color-ink-4, var(--ink-4))",
              letterSpacing: "0.08em",
            }}
          >
            No predictions yet
          </span>
          <p
            className="text-[12px] max-w-xs"
            style={{ color: "var(--color-ink-3, var(--ink-3))" }}
          >
            Connect the Claude MCP forecaster to surface AI-derived ETAs and
            confidence bands here. Until then this stays empty rather than
            invent numbers.
          </p>
        </div>
      ) : (
        rows.map(({ item, prediction }) => (
          <div
            key={item.id}
            className="grid items-center gap-2.5 py-2"
            style={{
              gridTemplateColumns: "70px 1fr 90px 70px 90px",
              borderBottom: "1px solid var(--color-line, var(--line))",
            }}
          >
            <span
              className="font-mono text-[10.5px]"
              style={{ color: "var(--color-ink-3, var(--ink-3))" }}
            >
              {item.id.slice(0, 8)}
            </span>
            <span className="text-[12.5px] truncate">{item.title}</span>
            <span
              className="text-[11px] inline-flex items-center gap-1.5"
              style={{ color: "var(--color-ink-3, var(--ink-3))" }}
            >
              <span
                className="block w-1.5 h-1.5 rounded-full"
                style={{ background: horizonTone(item.horizon) }}
              />
              {item.horizon}
            </span>
            <span
              className="font-mono text-[11px]"
              style={{ color: "var(--color-ink-2, var(--ink-2))" }}
            >
              {prediction.eta}
            </span>
            <ConfBar v={prediction.confidence} />
          </div>
        ))
      )}
    </ChartCard>
  );
}

function ConfBar({ v }: { v: number }) {
  const pct = Math.round(v * 100);
  const tone =
    v > 0.8
      ? "var(--color-ok, var(--ok))"
      : v > 0.6
        ? "var(--color-accent, var(--accent))"
        : "var(--color-warn, var(--warn))";
  return (
    <div className="flex items-center gap-1.5">
      <div
        className="flex-1 h-1.5 rounded overflow-hidden"
        style={{ background: "var(--color-bg-3, var(--bg-3))" }}
      >
        <div className="h-full" style={{ width: `${pct}%`, background: tone }} />
      </div>
      <span
        className="font-mono text-[10px] text-right"
        style={{ color: "var(--color-ink-3, var(--ink-3))", width: 28 }}
      >
        {pct}%
      </span>
    </div>
  );
}

function horizonTone(h: RoadmapItem["horizon"]): string {
  switch (h) {
    case "now":
      return "var(--color-accent, var(--accent))";
    case "next":
      return "var(--color-ai, var(--ai, var(--accent)))";
    case "later":
      return "var(--color-warn, var(--warn))";
    default:
      return "var(--color-ink-4, var(--ink-4))";
  }
}
