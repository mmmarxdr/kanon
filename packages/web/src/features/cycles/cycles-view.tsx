import { useMemo, useState } from "react";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useCyclesQuery, useCycleQuery } from "./use-cycles-query";
import type {
  Cycle,
  CycleDetail,
  CycleIssue,
  CycleRisk,
  CycleScopeEvent,
} from "@/types/cycle";
import type { IssueState } from "@/stores/board-store";
import { Icon } from "@/components/ui/icons";
import { Avatar, avatarInitials } from "@/components/ui/primitives";

export function CyclesView() {
  const { projectKey } = useParams({ from: "/_authenticated/cycles/$projectKey" });
  const { data: cycles, isLoading: cyclesLoading } = useCyclesQuery(projectKey);

  const activeCycle = useMemo(() => {
    const active = cycles?.find((c) => c.state === "active");
    return active ?? cycles?.[0];
  }, [cycles]);

  const [selectedCycleId, setSelectedCycleId] = useState<string | undefined>();
  const cycleId = selectedCycleId ?? activeCycle?.id;
  const { data: cycle, isLoading } = useCycleQuery(cycleId);

  if (!projectKey) {
    return <Empty>Pick a project to see cycles.</Empty>;
  }
  if (cyclesLoading) return <Empty>Loading cycles…</Empty>;
  if (!cycles || cycles.length === 0) {
    return (
      <Empty>
        No cycles yet. Create one to start planning the next iteration.
      </Empty>
    );
  }
  if (isLoading || !cycle) return <Empty>Loading cycle…</Empty>;

  const doneCycles = cycles.filter((c) => c.state === "done").reverse();

  return (
    <div
      style={{
        height: "100%",
        overflow: "auto",
        background: "var(--bg)",
      }}
    >
      <CycleHeader
        cycle={cycle}
        all={cycles}
        onPick={(id) => setSelectedCycleId(id)}
      />
      <div
        style={{
          padding: "0 28px 32px",
          display: "flex",
          flexDirection: "column",
          gap: 24,
        }}
      >
        <CycleStatStrip cycle={cycle} />
        <BurnupChart cycle={cycle} />
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1.3fr 1fr",
            gap: 20,
          }}
        >
          <CycleIssuesPanel issues={cycle.issues} />
          <RightColumn cycle={cycle} />
        </div>
        {doneCycles.length > 0 && <VelocityHistory cycles={doneCycles} />}
      </div>
    </div>
  );
}

/* ============================================================
   Header
   ============================================================ */

function CycleHeader({
  cycle,
  all,
  onPick,
}: {
  cycle: CycleDetail;
  all: Cycle[];
  onPick: (id: string) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div
      style={{
        position: "sticky",
        top: 0,
        zIndex: 2,
        background: "var(--bg)",
        padding: "20px 28px 12px",
        borderBottom: "1px solid var(--line)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexWrap: "wrap",
        }}
      >
        <div style={{ position: "relative" }}>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "6px 10px 6px 12px",
              border: "1px solid var(--line-2)",
              borderRadius: 5,
              background: "var(--panel)",
            }}
          >
            <CycleStateDot state={cycle.state} />
            <span
              style={{
                fontSize: 14,
                fontWeight: 600,
                letterSpacing: "-0.01em",
              }}
            >
              {cycle.name}
            </span>
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-4)" }}
            >
              {fmtDate(cycle.startDate)} → {fmtDate(cycle.endDate)}
            </span>
            <Icon.ChevD style={{ color: "var(--ink-4)" }} />
          </button>
          {open && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                minWidth: 280,
                padding: 4,
                zIndex: 5,
                background: "var(--panel)",
                border: "1px solid var(--line)",
                borderRadius: 6,
                boxShadow:
                  "0 8px 24px color-mix(in oklch, black 25%, transparent)",
              }}
            >
              {all.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => {
                    onPick(c.id);
                    setOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 10,
                    width: "100%",
                    padding: "8px 10px",
                    borderRadius: 4,
                    textAlign: "left",
                    background:
                      c.id === cycle.id ? "var(--bg-3)" : "transparent",
                  }}
                >
                  <CycleStateDot state={c.state} />
                  <span
                    style={{
                      fontSize: 12.5,
                      fontWeight: 500,
                      flex: 1,
                    }}
                  >
                    {c.name}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 10.5, color: "var(--ink-4)" }}
                  >
                    {fmtDate(c.startDate)}
                  </span>
                  {c.velocity != null && (
                    <span
                      className="mono"
                      style={{ fontSize: 10.5, color: "var(--ink-3)" }}
                    >
                      v{c.velocity}
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <span style={{ flex: 1 }} />

        <div style={{ display: "flex", gap: 6 }}>
          <button type="button" style={pillBtn(false)}>
            <Icon.Filter /> Filters
          </button>
          <button type="button" style={pillBtn(false)}>
            <Icon.Spark style={{ color: "var(--ai)" }} /> Plan next with Claude
          </button>
          <button type="button" style={pillBtn(true)}>
            Close cycle →
          </button>
        </div>
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 8,
          fontSize: 11.5,
          color: "var(--ink-3)",
        }}
      >
        <span>
          Day {cycle.dayIndex} of {cycle.days}
        </span>
        <span style={{ color: "var(--ink-4)" }}>·</span>
        <span>
          {cycle.completed} of {cycle.scope} pts done
        </span>
        <span style={{ color: "var(--ink-4)" }}>·</span>
        <span
          style={{
            color:
              cycle.scopeAdded > 3 ? "var(--warn)" : "var(--ink-3)",
          }}
        >
          +{cycle.scopeAdded}/−{cycle.scopeRemoved} scope changes
        </span>
      </div>
    </div>
  );
}

function pillBtn(primary: boolean): React.CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 6,
    height: 28,
    padding: "0 10px",
    borderRadius: 5,
    fontSize: 12,
    fontWeight: 500,
    background: primary ? "var(--accent)" : "var(--panel)",
    color: primary ? "var(--btn-ink)" : "var(--ink-2)",
    border: primary ? "none" : "1px solid var(--line)",
  };
}

function CycleStateDot({ state }: { state: Cycle["state"] }) {
  const c =
    state === "active"
      ? "var(--accent)"
      : state === "upcoming"
        ? "var(--ink-3)"
        : "var(--ok)";
  return (
    <span
      style={{
        width: 7,
        height: 7,
        borderRadius: "50%",
        background: c,
        boxShadow:
          state === "active"
            ? `0 0 0 3px color-mix(in oklch, ${c} 22%, transparent)`
            : "none",
      }}
    />
  );
}

/* ============================================================
   Stat strip
   ============================================================ */

function CycleStatStrip({ cycle }: { cycle: CycleDetail }) {
  const pct = cycle.scope > 0 ? Math.round((cycle.completed / cycle.scope) * 100) : 0;
  const elapsedPct = Math.round((cycle.dayIndex / cycle.days) * 100);
  const onTrack = pct >= elapsedPct - 8;
  const projected = Math.round(
    cycle.completed * (cycle.days / Math.max(cycle.dayIndex, 1)),
  );
  const drift = cycle.scopeAdded - cycle.scopeRemoved;

  const stats = [
    {
      label: "Completed",
      value: `${cycle.completed} / ${cycle.scope}`,
      sub: `${pct}% · ${onTrack ? "on track" : "behind"}`,
      tone: onTrack ? "ok" : "warn",
    },
    {
      label: "Time elapsed",
      value: `${elapsedPct}%`,
      sub: `Day ${cycle.dayIndex} of ${cycle.days}`,
      tone: "neutral",
    },
    {
      label: "Projected",
      value: `${projected}`,
      sub: "at current pace",
      tone: projected >= cycle.scope ? "ok" : "warn",
    },
    {
      label: "Scope drift",
      value: `${drift >= 0 ? "+" : ""}${drift}`,
      sub: `${cycle.scopeAdded} added · ${cycle.scopeRemoved} removed`,
      tone: drift > 3 ? "warn" : "neutral",
    },
    {
      label: "Risks",
      value: `${cycle.risks.length}`,
      sub: cycle.risks.length === 0 ? "none flagged" : `${cycle.risks.length} flagged`,
      tone: cycle.risks.some((r) => r.severity === "high")
        ? "warn"
        : "neutral",
    },
    {
      label: "Velocity",
      value: cycle.velocity != null ? `${cycle.velocity}` : "—",
      sub: cycle.state === "done" ? "final" : "in progress",
      tone: "neutral",
    },
  ] as const;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: `repeat(${stats.length}, 1fr)`,
        border: "1px solid var(--line)",
        borderRadius: 6,
        background: "var(--panel)",
        marginTop: 16,
      }}
    >
      {stats.map((s, i) => (
        <div
          key={s.label}
          style={{
            padding: 14,
            borderRight: i < stats.length - 1 ? "1px solid var(--line)" : "none",
            display: "flex",
            flexDirection: "column",
            gap: 4,
            minWidth: 0,
          }}
        >
          <span
            className="mono"
            style={{
              fontSize: 9.5,
              color: "var(--ink-4)",
              letterSpacing: "0.08em",
              textTransform: "uppercase",
            }}
          >
            {s.label}
          </span>
          <span
            style={{
              fontSize: 22,
              fontWeight: 600,
              fontVariantNumeric: "tabular-nums",
              letterSpacing: "-0.02em",
              color:
                s.tone === "warn"
                  ? "var(--warn)"
                  : s.tone === "ok"
                    ? "var(--ok)"
                    : "var(--ink)",
              fontFamily: "Inter Tight",
            }}
          >
            {s.value}
          </span>
          <span style={{ fontSize: 11, color: "var(--ink-3)" }}>{s.sub}</span>
        </div>
      ))}
    </div>
  );
}

/* ============================================================
   Burnup chart
   ============================================================ */

function BurnupChart({ cycle }: { cycle: CycleDetail }) {
  const W = 920;
  const H = 220;
  const P = { l: 36, r: 16, t: 16, b: 28 };
  const data = cycle.burnup;
  const scope = cycle.scopeLine;
  const max = Math.max(cycle.scope + 4, ...scope);
  const days = cycle.days;
  const xStep = (W - P.l - P.r) / Math.max(days, 1);
  const y = (v: number) =>
    P.t + (1 - v / Math.max(max, 1)) * (H - P.t - P.b);

  const burnPath = data
    .map((v, i) => `${i === 0 ? "M" : "L"} ${P.l + i * xStep} ${y(v)}`)
    .join(" ");
  const burnArea =
    burnPath +
    ` L ${P.l + (data.length - 1) * xStep} ${H - P.b} L ${P.l} ${H - P.b} Z`;
  const scopePath = scope
    .map((v, i) => `${i === 0 ? "M" : "L"} ${P.l + i * xStep} ${y(v)}`)
    .join(" ");
  const idealPath = `M ${P.l} ${y(0)} L ${P.l + days * xStep} ${y(cycle.scope)}`;
  const cur = Math.min(cycle.dayIndex, data.length - 1);
  const slope =
    cur >= 1
      ? (data[cur]! - data[Math.max(0, cur - 3)]!) / Math.min(3, cur)
      : 0;
  const projEnd = (data[cur] ?? 0) + slope * (days - cur);
  const projPath = `M ${P.l + cur * xStep} ${y(data[cur] ?? 0)} L ${P.l + days * xStep} ${y(projEnd)}`;

  return (
    <Card
      title="Burnup"
      sub={`${cycle.name} · scope vs. completed`}
      right={
        <Legend
          items={[
            { c: "var(--accent)", l: "Completed" },
            { c: "var(--ink-3)", l: "Scope" },
            { c: "var(--ok)", l: "Ideal", dash: true },
            { c: "var(--warn)", l: "Projected", dash: true },
          ]}
        />
      }
    >
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        <defs>
          <linearGradient id="burnFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.32" />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        {[0, 0.25, 0.5, 0.75, 1].map((t) => (
          <g key={t}>
            <line
              x1={P.l}
              x2={W - P.r}
              y1={P.t + t * (H - P.t - P.b)}
              y2={P.t + t * (H - P.t - P.b)}
              stroke="var(--line)"
              strokeWidth="0.5"
            />
            <text
              x={P.l - 6}
              y={P.t + t * (H - P.t - P.b) + 3}
              textAnchor="end"
              fontSize="10"
              fill="var(--ink-4)"
              fontFamily="JetBrains Mono"
            >
              {Math.round(max * (1 - t))}
            </text>
          </g>
        ))}
        {[0, Math.round(days * 0.25), Math.round(days * 0.5), Math.round(days * 0.75), days].map(
          (d) => (
            <text
              key={d}
              x={P.l + d * xStep}
              y={H - 10}
              textAnchor="middle"
              fontSize="10"
              fill="var(--ink-4)"
              fontFamily="JetBrains Mono"
            >
              D{d}
            </text>
          ),
        )}
        <line
          x1={P.l + cur * xStep}
          x2={P.l + cur * xStep}
          y1={P.t}
          y2={H - P.b}
          stroke="var(--accent)"
          strokeWidth="0.8"
          strokeDasharray="2 2"
          opacity="0.4"
        />
        <text
          x={P.l + cur * xStep}
          y={P.t - 4}
          textAnchor="middle"
          fontSize="9.5"
          fill="var(--accent)"
          fontFamily="JetBrains Mono"
        >
          today
        </text>
        <path
          d={idealPath}
          stroke="var(--ok)"
          strokeWidth="1"
          strokeDasharray="3 3"
          fill="none"
          opacity="0.55"
        />
        <path d={scopePath} stroke="var(--ink-3)" strokeWidth="1.2" fill="none" />
        <path d={burnArea} fill="url(#burnFill)" />
        <path d={burnPath} stroke="var(--accent)" strokeWidth="1.8" fill="none" />
        <path
          d={projPath}
          stroke="var(--warn)"
          strokeWidth="1.4"
          strokeDasharray="3 3"
          fill="none"
        />
        <circle
          cx={P.l + cur * xStep}
          cy={y(data[cur] ?? 0)}
          r="4"
          fill="var(--bg)"
          stroke="var(--accent)"
          strokeWidth="1.6"
        />
      </svg>
    </Card>
  );
}

/* ============================================================
   Right column
   ============================================================ */

function RightColumn({ cycle }: { cycle: CycleDetail }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <Card title="Scope timeline" sub="day-by-day changes">
        {cycle.scopeEvents.length === 0 ? (
          <EmptyHint>No scope changes recorded.</EmptyHint>
        ) : (
          <ScopeTimeline events={cycle.scopeEvents} />
        )}
      </Card>
      <Card
        title="Risks"
        sub="auto-flagged"
        right={
          <span className="mono" style={{ fontSize: 10, color: "var(--ai)" }}>
            updated now
          </span>
        }
      >
        {cycle.risks.length === 0 ? (
          <EmptyHint>No risks flagged.</EmptyHint>
        ) : (
          <Risks risks={cycle.risks} />
        )}
      </Card>
    </div>
  );
}

function ScopeTimeline({ events }: { events: CycleScopeEvent[] }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        position: "relative",
      }}
    >
      <div
        style={{
          position: "absolute",
          left: 9,
          top: 8,
          bottom: 8,
          width: 1,
          background: "var(--line)",
        }}
      />
      {events.map((e) => (
        <div
          key={e.id}
          style={{
            display: "grid",
            gridTemplateColumns: "20px 1fr auto",
            gap: 10,
            padding: "8px 0",
          }}
        >
          <span
            className="mono"
            style={{
              zIndex: 1,
              width: 18,
              height: 18,
              borderRadius: "50%",
              border: `1px solid ${e.kind === "add" ? "var(--ok)" : "var(--bad)"}`,
              background: "var(--panel)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: e.kind === "add" ? "var(--ok)" : "var(--bad)",
              fontSize: 11,
              fontWeight: 700,
              justifySelf: "start",
            }}
          >
            {e.kind === "add" ? "+" : "−"}
          </span>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 2,
              minWidth: 0,
            }}
          >
            <span style={{ fontSize: 12, color: "var(--ink)" }}>
              {e.kind === "add" ? "+" : "−"} {e.issueKey}
            </span>
            {e.reason && (
              <span style={{ fontSize: 10.5, color: "var(--ink-4)" }}>
                {e.reason}
              </span>
            )}
            {e.author && (
              <span
                className="mono"
                style={{ fontSize: 9.5, color: "var(--ink-4)" }}
              >
                by {e.author.username}
              </span>
            )}
          </div>
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: "var(--ink-4)",
              justifySelf: "end",
            }}
          >
            D{e.day}
          </span>
        </div>
      ))}
    </div>
  );
}

function Risks({ risks }: { risks: CycleRisk[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {risks.map((r) => {
        const c =
          r.severity === "high"
            ? "var(--bad)"
            : r.severity === "medium"
              ? "var(--warn)"
              : "var(--ok)";
        return (
          <div
            key={r.id}
            style={{
              display: "grid",
              gridTemplateColumns: "10px 1fr auto",
              gap: 10,
              padding: 10,
              border: "1px solid var(--line)",
              borderRadius: 5,
              background: "var(--bg-2)",
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: "50%",
                background: c,
                marginTop: 5,
                alignSelf: "start",
              }}
            />
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 2,
                minWidth: 0,
              }}
            >
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 500,
                  color: "var(--ink)",
                }}
              >
                {r.title}
              </span>
              <span
                style={{
                  fontSize: 10.5,
                  color: "var(--ink-3)",
                  lineHeight: 1.4,
                }}
              >
                {r.detail}
              </span>
            </div>
            {r.action && (
              <button
                type="button"
                style={{
                  fontSize: 11,
                  padding: "3px 8px",
                  borderRadius: 3,
                  border: "1px solid var(--line-2)",
                  color: "var(--ink-2)",
                  fontWeight: 500,
                  alignSelf: "start",
                  whiteSpace: "nowrap",
                }}
              >
                {r.action}
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

/* ============================================================
   Issues panel
   ============================================================ */

function CycleIssuesPanel({ issues }: { issues: CycleIssue[] }) {
  const navigate = useNavigate();
  const grouped = useMemo(() => groupByState(issues), [issues]);

  return (
    <Card
      title="Issues in this cycle"
      sub={`${issues.length} total`}
    >
      {issues.length === 0 ? (
        <EmptyHint>No issues attached to this cycle yet.</EmptyHint>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {grouped.map((g) => (
            <div
              key={g.id}
              style={{ display: "flex", flexDirection: "column", gap: 4 }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  marginBottom: 4,
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: g.id === "done" ? "50%" : 2,
                    background: stateColor(g.id),
                  }}
                />
                <span
                  style={{
                    fontSize: 11.5,
                    fontWeight: 500,
                    color: "var(--ink-2)",
                    letterSpacing: "-0.005em",
                  }}
                >
                  {g.label}
                </span>
                <span
                  className="mono"
                  style={{ fontSize: 10, color: "var(--ink-4)" }}
                >
                  {g.items.length}
                </span>
              </div>
              {g.items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  onClick={() =>
                    void navigate({
                      to: "/issue/$key",
                      params: { key: it.key },
                      search: { from: "cycles" },
                    })
                  }
                  style={{
                    display: "grid",
                    gridTemplateColumns: "70px 1fr 32px 22px 50px",
                    gap: 10,
                    alignItems: "center",
                    padding: "7px 8px",
                    borderRadius: 4,
                    textAlign: "left",
                    cursor: "pointer",
                  }}
                  onMouseEnter={(e) =>
                    (e.currentTarget.style.background = "var(--bg-3)")
                  }
                  onMouseLeave={(e) =>
                    (e.currentTarget.style.background = "transparent")
                  }
                >
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: "var(--ink-3)" }}
                  >
                    {it.key}
                  </span>
                  <span
                    style={{
                      fontSize: 12.5,
                      color: "var(--ink)",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {it.title}
                  </span>
                  <span
                    className="mono"
                    style={{
                      fontSize: 9.5,
                      color: prioColor(it.priority),
                      textAlign: "center",
                      padding: "1px 4px",
                      border: "1px solid var(--line-2)",
                      borderRadius: 3,
                    }}
                  >
                    {it.priority.charAt(0).toUpperCase()}
                  </span>
                  {it.assignee ? (
                    <Avatar
                      initials={avatarInitials(it.assignee.username, "?")}
                      name={it.assignee.username}
                      size={18}
                    />
                  ) : (
                    <span />
                  )}
                  <span
                    className="mono"
                    style={{
                      fontSize: 10,
                      color: "var(--ink-4)",
                      textAlign: "right",
                    }}
                  >
                    {it.estimate != null ? `${it.estimate}pt` : "—"}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function groupByState(issues: CycleIssue[]) {
  const order: IssueState[] = [
    "in_progress",
    "review",
    "todo",
    "backlog",
    "done",
  ];
  const labels: Record<IssueState, string> = {
    in_progress: "In progress",
    review: "In review",
    todo: "Todo",
    backlog: "Backlog",
    done: "Done",
  };
  return order
    .map((s) => ({
      id: s,
      label: labels[s],
      items: issues.filter((i) => i.state === s),
    }))
    .filter((g) => g.items.length > 0);
}

function stateColor(s: IssueState) {
  return s === "in_progress"
    ? "var(--accent)"
    : s === "review"
      ? "var(--ai)"
      : s === "done"
        ? "var(--ok)"
        : "var(--ink-4)";
}

function prioColor(p: string) {
  return p === "critical"
    ? "var(--bad)"
    : p === "high"
      ? "var(--warn)"
      : "var(--ink-3)";
}

/* ============================================================
   Velocity history
   ============================================================ */

function VelocityHistory({ cycles }: { cycles: Cycle[] }) {
  const data = cycles.filter((c) => c.velocity != null) as Array<
    Cycle & { velocity: number }
  >;
  if (data.length === 0) return null;
  const max = Math.max(...data.map((c) => c.velocity));
  const W = 920;
  const H = 200;
  const P = { l: 36, r: 16, t: 12, b: 28 };
  const slot = (W - P.l - P.r) / data.length;
  const barW = slot * 0.5;
  const y = (v: number) => P.t + (1 - v / Math.max(max, 1)) * (H - P.t - P.b);
  const avg = Math.round(
    data.reduce((s, c) => s + c.velocity, 0) / data.length,
  );

  return (
    <Card
      title="Velocity history"
      sub={`last ${data.length} cycles · avg ${avg} pts`}
      right={
        <Legend
          items={[
            { c: "var(--accent)", l: "Completed" },
            { c: "var(--ai)", l: "Avg", dash: true },
          ]}
        />
      }
    >
      <svg
        width="100%"
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        style={{ display: "block" }}
      >
        {[0, 0.5, 1].map((t) => (
          <line
            key={t}
            x1={P.l}
            x2={W - P.r}
            y1={P.t + t * (H - P.t - P.b)}
            y2={P.t + t * (H - P.t - P.b)}
            stroke="var(--line)"
            strokeWidth="0.5"
          />
        ))}
        <line
          x1={P.l}
          x2={W - P.r}
          y1={y(avg)}
          y2={y(avg)}
          stroke="var(--ai)"
          strokeWidth="1"
          strokeDasharray="3 3"
          opacity="0.7"
        />
        {data.map((c, i) => {
          const cx = P.l + slot * (i + 0.5);
          return (
            <g key={c.id}>
              <rect
                x={cx - barW / 2}
                y={y(c.velocity)}
                width={barW}
                height={H - P.b - y(c.velocity)}
                fill="var(--accent)"
                opacity="0.9"
                rx="2"
              />
              <text
                x={cx}
                y={H - 12}
                textAnchor="middle"
                fontSize="10"
                fill="var(--ink-4)"
                fontFamily="JetBrains Mono"
              >
                {c.name.replace(/^Cycle\s+/i, "c")}
              </text>
              <text
                x={cx}
                y={y(c.velocity) - 4}
                textAnchor="middle"
                fontSize="10"
                fill="var(--ink-2)"
                fontFamily="JetBrains Mono"
                fontWeight="500"
              >
                {c.velocity}
              </text>
            </g>
          );
        })}
      </svg>
    </Card>
  );
}

/* ============================================================
   Generic helpers
   ============================================================ */

function Card({
  title,
  sub,
  right,
  children,
}: {
  title: string;
  sub?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        border: "1px solid var(--line)",
        borderRadius: 6,
        background: "var(--panel)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          justifyContent: "space-between",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--line)",
        }}
      >
        <div
          style={{ display: "flex", alignItems: "baseline", gap: 8 }}
        >
          <h3
            style={{
              margin: 0,
              fontSize: 13,
              fontWeight: 600,
              letterSpacing: "-0.01em",
            }}
          >
            {title}
          </h3>
          {sub && (
            <span
              className="mono"
              style={{ fontSize: 11, color: "var(--ink-4)" }}
            >
              {sub}
            </span>
          )}
        </div>
        {right}
      </div>
      <div style={{ padding: 16 }}>{children}</div>
    </div>
  );
}

function Legend({
  items,
}: {
  items: { c: string; l: string; dash?: boolean }[];
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        fontSize: 11,
        color: "var(--ink-3)",
      }}
    >
      {items.map((it, i) => (
        <span
          key={i}
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
          }}
        >
          <span
            style={{
              width: 10,
              height: it.dash ? 0 : 2,
              borderTop: it.dash ? `1.5px dashed ${it.c}` : "none",
              background: it.dash ? "transparent" : it.c,
            }}
          />
          {it.l}
        </span>
      ))}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ink-4)",
        fontSize: 12,
        padding: 24,
        textAlign: "center",
      }}
    >
      {children}
    </div>
  );
}

function EmptyHint({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 12,
        color: "var(--ink-4)",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso;
  }
}
