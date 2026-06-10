/**
 * CurrentCycleCard — Inbox right-rail RailCard showing active cycle KPIs.
 *
 * KAN-27 / inbox-redesign-cycle-c / Phase B
 * Refs: REQ-INBOX-CYCLE-005, REQ-INBOX-CYCLE-006, design §4.1
 *
 * States:
 * - isLoading=true  → skeleton (not implemented in this batch — isLoading
 *   is accepted but skeleton render is minimal)
 * - activeCycle=null → empty state with data-testid="current-cycle-empty"
 * - normal → sparkline + 3 mini KPIs
 *
 * Sparkline is local to this file (NOT exported). It is an inline SVG area
 * chart with viewBox="0 0 280 36", monotone linear path, stroke=var(--accent),
 * fill=var(--accent-2).
 */

import type { ActiveCycleKPIs } from "@kanon/shared";

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Format an ISO datetime string to a short locale date.
 * "2026-04-21T00:00:00.000Z" → "Apr 21" (locale-dependent, uses env locale)
 */
function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

// ─── Sparkline ────────────────────────────────────────────────────────────────

/**
 * Local-only sparkline — NOT exported.
 * Renders a filled area SVG from a points array (burnup values).
 * viewBox: 0 0 280 36
 * Empty/all-zero → renders flat baseline (no path crash).
 */
function Sparkline({ values }: { values: number[] }) {
  const W = 280;
  const H = 36;

  if (values.length === 0) {
    // Empty state: flat baseline path at bottom
    return (
      <svg
        data-testid="sparkline"
        viewBox={`0 0 ${W} ${H}`}
        style={{ width: "100%", height: H, display: "block" }}
        aria-hidden="true"
      >
        <path
          d={`M 0,${H} L ${W},${H}`}
          stroke="var(--accent)"
          strokeWidth={1.5}
          fill="none"
        />
      </svg>
    );
  }

  const max = Math.max(...values, 1); // prevent div-by-zero on all-zeros
  const step = W / Math.max(values.length - 1, 1);

  // Build SVG points: normalize y to [0, H], y-axis flipped (0=bottom)
  const pts = values.map((v, i) => ({
    x: i * step,
    y: H - (v / max) * (H - 4), // 4px top padding
  }));

  // Line path: M x0,y0 L x1,y1 ...
  const linePath = pts
    .map((p, i) => `${i === 0 ? "M" : "L"} ${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  // Area path: same line, then close to bottom-right → bottom-left
  const areaPath =
    linePath +
    ` L ${(pts[pts.length - 1]?.x ?? W).toFixed(1)},${H}` +
    ` L 0,${H} Z`;

  return (
    <svg
      data-testid="sparkline"
      viewBox={`0 0 ${W} ${H}`}
      style={{ width: "100%", height: H, display: "block" }}
      aria-hidden="true"
    >
      {/* Area fill */}
      <path
        d={areaPath}
        fill="var(--accent-2)"
        fillOpacity={0.3}
        stroke="none"
      />
      {/* Stroke line */}
      <path
        d={linePath}
        stroke="var(--accent)"
        strokeWidth={1.5}
        fill="none"
      />
    </svg>
  );
}

// ─── CurrentCycleCard ─────────────────────────────────────────────────────────

export interface CurrentCycleCardProps {
  activeCycle: ActiveCycleKPIs | null;
  multipleActiveProjects: boolean;
  isLoading: boolean;
}

export function CurrentCycleCard({
  activeCycle,
  multipleActiveProjects,
  isLoading: _isLoading,
}: CurrentCycleCardProps) {
  // Empty state
  if (activeCycle === null) {
    return (
      <div
        data-testid="current-cycle-empty"
        style={{
          padding: "10px 12px",
          fontSize: 12,
          color: "var(--ink-4)",
          fontStyle: "italic",
        }}
      >
        No active cycle
      </div>
    );
  }

  // Build subtitle: "{cycleName} · {startDate} – {endDate}" + " ({projectName})" if multiple
  const subtitle =
    `${activeCycle.name} · ${formatDate(activeCycle.startDate)} – ${formatDate(activeCycle.endDate)}` +
    (multipleActiveProjects ? ` (${activeCycle.projectName})` : "");

  // Avg lead display
  const avgLeadText =
    activeCycle.avgLeadDays === null
      ? "—"
      : `${activeCycle.avgLeadDays.toFixed(1)}d`;

  return (
    <div data-testid="current-cycle-card">
      {/* Sparkline */}
      <div style={{ marginBottom: 8 }}>
        <Sparkline values={activeCycle.burnup} />
      </div>

      {/* Subtitle */}
      <div
        data-testid="cycle-subtitle"
        style={{
          fontSize: 11,
          color: "var(--ink-4)",
          marginBottom: 10,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {subtitle}
      </div>

      {/* KPI mini strip */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 4,
        }}
      >
        <MiniKPI
          label="Done"
          value={<span data-testid="done-pct-value">{activeCycle.donePct}%</span>}
        />
        <MiniKPI
          label="Avg lead"
          value={<span data-testid="avg-lead-value">{avgLeadText}</span>}
        />
        <MiniKPI
          label="Velocity"
          value={
            <span data-testid="velocity-value">
              {activeCycle.velocity > 0 ? `+${activeCycle.velocity}` : activeCycle.velocity}
            </span>
          }
        />
      </div>
    </div>
  );
}

function MiniKPI({
  label,
  value,
}: {
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-3)",
        borderRadius: 4,
        padding: "6px 8px",
        textAlign: "center",
      }}
    >
      <div
        style={{
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ink)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 10, color: "var(--ink-4)", marginTop: 2 }}>
        {label}
      </div>
    </div>
  );
}
