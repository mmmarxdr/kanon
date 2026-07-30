import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import type { RoadmapItem } from "@/types/roadmap";
import { ChartCard } from "./chart-card";

interface ThroughputChartProps {
  items: RoadmapItem[];
}

const WEEKS = 12;
const MS_PER_WEEK = 7 * 24 * 60 * 60 * 1000;

/**
 * Throughput projection — items shipped per week over the last 12 weeks,
 * with a target reference line (median of the window) and an overlaid trend
 * line. Three mini KPIs below project ETA for the current Now and Now+Next
 * scope using the rolling average.
 *
 * Question answered: "Are we accelerating, stable, or slowing down?"
 * Action enabled: capacity planning + early warning when throughput drops.
 *
 * Real data: a roadmap item counts as "shipped" when status === "done";
 * we bucket by `updatedAt` (best proxy for completion timestamp until a
 * dedicated `completedAt` field lands).
 */
export function ThroughputChart({ items }: ThroughputChartProps) {
  const { t } = useTranslation("roadmap");
  const { weeks, target, avg, etaNow, etaNowNext } = useMemo(() => {
    // Bucket completed items into the last 12 weeks (week 0 = current week).
    const now = Date.now();
    const bucket = new Array<number>(WEEKS).fill(0);

    for (const it of items) {
      if (it.status !== "done") continue;
      const ts = new Date(it.updatedAt).getTime();
      const weeksAgo = Math.floor((now - ts) / MS_PER_WEEK);
      if (weeksAgo >= 0 && weeksAgo < WEEKS) {
        const idx = WEEKS - 1 - weeksAgo;
        bucket[idx] = (bucket[idx] ?? 0) + 1;
      }
    }

    const total = bucket.reduce((s, v) => s + v, 0);
    const avg = total / WEEKS;
    const sorted = [...bucket].sort((a, b) => a - b);
    const median = sorted[Math.floor(WEEKS / 2)] ?? 0;
    const target = Math.max(median, 1);

    const nowItems = items.filter((it) => it.horizon === "now" && it.status !== "done").length;
    const nextItems = items.filter((it) => it.horizon === "next" && it.status !== "done").length;
    const etaNow = avg > 0 ? nowItems / avg : null;
    const etaNowNext = avg > 0 ? (nowItems + nextItems) / avg : null;

    return { weeks: bucket, target, avg, etaNow, etaNowNext };
  }, [items]);

  const W = 540;
  const H = 200;
  const PAD = { l: 30, r: 16, t: 14, b: 26 };
  const max = Math.max(...weeks, target) + 2;
  const slot = (W - PAD.l - PAD.r) / WEEKS;
  const yfn = (v: number) => PAD.t + (1 - v / max) * (H - PAD.t - PAD.b);

  const trendD = weeks
    .map((v, i) => `${i === 0 ? "M" : "L"} ${PAD.l + slot * (i + 0.5)} ${yfn(v)}`)
    .join(" ");

  const isEmpty = weeks.every((v) => v === 0);

  return (
    <ChartCard
      title={t("analyticsThroughput")}
      subtitle={`items shipped per week · last ${WEEKS}`}
      isEmpty={isEmpty}
      emptyMessage={t("emptyThroughput")}
    >
      <svg width="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet">
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={PAD.l}
            x2={W - PAD.r}
            y1={PAD.t + t * (H - PAD.t - PAD.b)}
            y2={PAD.t + t * (H - PAD.t - PAD.b)}
            stroke="var(--color-line, var(--line))"
            strokeWidth="0.5"
          />
        ))}
        <line
          x1={PAD.l}
          x2={W - PAD.r}
          y1={yfn(target)}
          y2={yfn(target)}
          stroke="var(--color-ink-3, var(--ink-3))"
          strokeDasharray="3 3"
          strokeWidth="1"
          opacity="0.7"
        />
        <text
          x={W - PAD.r - 4}
          y={yfn(target) - 4}
          fontSize="10"
          fontFamily="JetBrains Mono"
          textAnchor="end"
          fill="var(--color-ink-3, var(--ink-3))"
        >
          target {target}
        </text>

        {weeks.map((v, i) => {
          const cx = PAD.l + slot * (i + 0.5);
          const barW = slot * 0.55;
          const tone =
            v >= target ? "var(--color-ok, var(--ok))" : "var(--color-warn, var(--warn))";
          return (
            <g key={i}>
              <rect
                x={cx - barW / 2}
                y={yfn(v)}
                width={barW}
                height={Math.max(0, H - PAD.b - yfn(v))}
                rx="2"
                fill={tone}
                opacity="0.85"
              />
              <text
                x={cx}
                y={H - 10}
                textAnchor="middle"
                fontSize="9.5"
                fontFamily="JetBrains Mono"
                fill="var(--color-ink-4, var(--ink-4))"
              >
                w{i + 1 - WEEKS}
              </text>
            </g>
          );
        })}

        <path
          d={trendD}
          stroke="var(--color-accent, var(--accent))"
          strokeWidth="1.5"
          fill="none"
          opacity="0.6"
        />
      </svg>

      <div className="mt-2 grid grid-cols-3 gap-2.5">
        <Mini label="Avg / wk" value={avg.toFixed(1)} sub={`target ${target}/wk`} />
        <Mini
          label="ETA · all Now"
          value={etaNow != null ? `${etaNow.toFixed(1)} wks` : "—"}
          sub="if pace holds"
        />
        <Mini
          label="ETA · Now+Next"
          value={etaNowNext != null ? `${etaNowNext.toFixed(1)} wks` : "—"}
          sub="open scope"
        />
      </div>
    </ChartCard>
  );
}

function Mini({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div
      className="flex flex-col gap-0.5 rounded p-2.5"
      style={{ background: "var(--color-bg-2, var(--bg-2))" }}
    >
      <span
        className="font-mono text-[9.5px] uppercase"
        style={{ color: "var(--color-ink-4, var(--ink-4))", letterSpacing: "0.08em" }}
      >
        {label}
      </span>
      <span
        className="text-[16px] font-semibold tracking-[-0.02em]"
        style={{ fontVariantNumeric: "tabular-nums" }}
      >
        {value}
      </span>
      <span className="text-[10.5px]" style={{ color: "var(--color-ink-3, var(--ink-3))" }}>
        {sub}
      </span>
    </div>
  );
}
