import { useEffect, useMemo, useRef, useState } from "react";
import type { RoadmapItem, RoadmapStatus } from "@/types/roadmap";
import { Icon } from "@/components/ui/icons";
import { Kbd } from "@/components/ui/primitives";
import { FloatingMcpCard } from "./floating-mcp-card";

interface GraphViewProps {
  items: RoadmapItem[];
  onSelectItem: (id: string) => void;
}

type Horizon = "now" | "next" | "later" | "someday";
const HORIZONS: Horizon[] = ["now", "next", "later", "someday"];
const HORIZON_LABELS: Record<Horizon, string> = {
  now: "Now",
  next: "Next",
  later: "Later",
  someday: "Someday",
};

const NODE_W = 220;
const NODE_H = 52;

function statusFill(s: RoadmapStatus | string) {
  switch (s) {
    case "in_progress":
      return "var(--accent)";
    case "planned":
      return "var(--ink-2)";
    case "done":
      return "var(--ok)";
    default:
      return "var(--ink-4)";
  }
}

function statusLabel(s: RoadmapStatus | string) {
  if (s === "in_progress") return "in progress";
  return s as string;
}

export default function GraphView({ items, onSelectItem }: GraphViewProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 1200, h: 700 });
  const [hover, setHover] = useState<string | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({
          w: Math.floor(e.contentRect.width),
          h: Math.floor(e.contentRect.height),
        });
      }
    });
    ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, []);

  // Layered layout by horizon
  const positions = useMemo(() => {
    const buckets: Record<Horizon, RoadmapItem[]> = {
      now: [],
      next: [],
      later: [],
      someday: [],
    };
    for (const it of items) {
      const h = (HORIZONS as string[]).includes(it.horizon)
        ? (it.horizon as Horizon)
        : "someday";
      buckets[h].push(it);
    }

    const W = Math.max(size.w, 900);
    const H = Math.max(size.h, 520);
    const colW = (W - 80) / 4;
    const map: Record<string, { x: number; y: number }> = {};

    HORIZONS.forEach((h, ci) => {
      const arr = buckets[h];
      const x = 40 + ci * colW + colW / 2;
      const slots = Math.max(arr.length, 1);
      const yStep = (H - 100) / slots;
      arr.forEach((it, i) => {
        const y =
          60 +
          i * yStep +
          yStep / 2 +
          (h === "next" ? 10 : h === "later" ? -10 : 0);
        map[it.id] = { x, y };
      });
    });
    return map;
  }, [items, size]);

  // Build edges from blocks relationships
  const edges = useMemo(() => {
    const out: {
      id: string;
      source: string;
      target: string;
      a: { x: number; y: number };
      b: { x: number; y: number };
    }[] = [];
    for (const item of items) {
      for (const dep of item.blocks ?? []) {
        const a = positions[item.id];
        const b = positions[dep.targetId];
        if (a && b) {
          out.push({
            id: dep.id,
            source: item.id,
            target: dep.targetId,
            a,
            b,
          });
        }
      }
    }
    return out;
  }, [items, positions]);

  if (items.length === 0) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-4)",
          fontSize: 12,
        }}
      >
        No roadmap items to display.
      </div>
    );
  }

  const W = Math.max(size.w, 900);
  const colW = (W - 80) / 4;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderBottom: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <span
          className="mono"
          style={{
            fontSize: 11,
            color: "var(--ink-3)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          Dependency graph
        </span>
        <span style={{ width: 1, height: 14, background: "var(--line)" }} />
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 5,
            padding: "3px 8px",
            border: "1px solid var(--line-2)",
            borderRadius: 4,
            fontSize: 11,
            color: "var(--ink-3)",
          }}
        >
          Layout: layered LR
        </span>
        <span style={{ flex: 1 }} />
        <GraphLegend />
      </div>

      {/* Canvas */}
      <div
        ref={containerRef}
        style={{
          flex: 1,
          position: "relative",
          overflow: "hidden",
          background: `
            linear-gradient(var(--grid) 1px, transparent 1px) 0 0 / 24px 24px,
            linear-gradient(90deg, var(--grid) 1px, transparent 1px) 0 0 / 24px 24px,
            var(--bg)
          `,
        }}
      >
        <svg
          width="100%"
          height="100%"
          style={{ position: "absolute", inset: 0 }}
        >
          <defs>
            <marker
              id="dep-arrow"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10z" fill="var(--accent)" />
            </marker>
            <marker
              id="dep-arrow-muted"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="6"
              markerHeight="6"
              orient="auto-start-reverse"
            >
              <path d="M0 0L10 5L0 10z" fill="var(--ink-4)" />
            </marker>
          </defs>

          {/* Horizon column ruler */}
          {HORIZONS.map((h, i) => {
            const x = 40 + i * colW + colW / 2;
            return (
              <g key={h}>
                <line
                  x1={x - colW / 2 + 12}
                  x2={x - colW / 2 + 12}
                  y1={20}
                  y2={size.h - 20}
                  stroke="var(--line)"
                  strokeDasharray="2 4"
                />
                <text
                  x={x}
                  y={36}
                  textAnchor="middle"
                  fill="var(--ink-3)"
                  fontSize="11"
                  fontFamily="JetBrains Mono"
                  letterSpacing="0.06em"
                  style={{ textTransform: "uppercase" }}
                >
                  {HORIZON_LABELS[h]}
                </text>
              </g>
            );
          })}

          {/* Edges */}
          {edges.map((e) => {
            const dx = (e.b.x - e.a.x) * 0.45;
            const path = `M${e.a.x + NODE_W / 2} ${e.a.y} C ${e.a.x + NODE_W / 2 + dx} ${e.a.y}, ${e.b.x - NODE_W / 2 - dx} ${e.b.y}, ${e.b.x - NODE_W / 2} ${e.b.y}`;
            const isHover = hover && (hover === e.source || hover === e.target);
            const dim = hover && !isHover;
            return (
              <path
                key={e.id}
                d={path}
                stroke={isHover ? "var(--accent)" : "var(--ink-4)"}
                strokeWidth={isHover ? 1.5 : 1}
                fill="none"
                opacity={dim ? 0.18 : 1}
                markerEnd={`url(#${isHover ? "dep-arrow" : "dep-arrow-muted"})`}
              />
            );
          })}

          {/* Nodes */}
          {items.map((item) => {
            const p = positions[item.id];
            if (!p) return null;
            const isHover = hover === item.id;
            const dim =
              hover &&
              !isHover &&
              !edges.some(
                (e) =>
                  (e.source === hover && e.target === item.id) ||
                  (e.target === hover && e.source === item.id),
              );
            return (
              <g
                key={item.id}
                transform={`translate(${p.x - NODE_W / 2}, ${p.y - NODE_H / 2})`}
                onMouseEnter={() => setHover(item.id)}
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelectItem(item.id)}
                style={{
                  cursor: "pointer",
                  opacity: dim ? 0.4 : 1,
                  transition: "opacity 120ms",
                }}
              >
                <rect
                  width={NODE_W}
                  height={NODE_H}
                  rx="5"
                  fill="var(--panel)"
                  stroke={isHover ? "var(--accent)" : "var(--line-2)"}
                  strokeWidth={isHover ? 1.5 : 1}
                />
                {/* Status stripe */}
                <rect
                  x="0"
                  y="0"
                  width="3"
                  height={NODE_H}
                  rx="1.5"
                  fill={statusFill(item.status)}
                />
                {/* Title */}
                <foreignObject x="12" y="6" width={NODE_W - 24} height="40">
                  <div
                    style={{
                      fontFamily: "Inter Tight",
                      fontSize: 12,
                      fontWeight: 500,
                      color: "var(--ink)",
                      lineHeight: 1.3,
                      display: "-webkit-box",
                      WebkitLineClamp: 2,
                      WebkitBoxOrient: "vertical",
                      overflow: "hidden",
                    }}
                  >
                    {item.title}
                  </div>
                </foreignObject>
                {/* Footer chips */}
                <foreignObject x="12" y="34" width={NODE_W - 24} height="14">
                  <div
                    style={{
                      fontFamily: "JetBrains Mono",
                      fontSize: 9.5,
                      color: "var(--ink-4)",
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                    }}
                  >
                    <span>
                      E{item.effort ?? "·"} · I{item.impact ?? "·"}
                    </span>
                    <span style={{ flex: 1 }} />
                    <span
                      style={{
                        color: statusFill(item.status),
                        textTransform: "uppercase",
                        letterSpacing: "0.06em",
                      }}
                    >
                      {statusLabel(item.status)}
                    </span>
                  </div>
                </foreignObject>
              </g>
            );
          })}
        </svg>

        {/* Mini hint top-right */}
        <div
          style={{
            position: "absolute",
            right: 16,
            top: 14,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--ink-4)",
          }}
        >
          <Icon.Spark style={{ color: "var(--ai)" }} />
          <span>Hover an item to isolate its dependency chain</span>
          <Kbd>esc</Kbd>
        </div>

        <FloatingMcpCard />

        {/* Empty edges hint */}
        {edges.length === 0 && (
          <div
            style={{
              position: "absolute",
              top: 64,
              left: "50%",
              transform: "translateX(-50%)",
              padding: "8px 14px",
              background: "color-mix(in oklch, var(--panel) 92%, transparent)",
              backdropFilter: "blur(8px)",
              border: "1px solid var(--line)",
              borderRadius: 6,
              fontSize: 12,
              color: "var(--ink-3)",
            }}
          >
            No dependencies yet. Open an item and add dependencies to see
            connections here.
          </div>
        )}
      </div>
    </div>
  );
}

function GraphLegend() {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        fontSize: 11,
        color: "var(--ink-3)",
      }}
    >
      <Dot color="var(--accent)" label="In progress" />
      <Dot color="var(--ink-2)" label="Planned" />
      <Dot color="var(--ok)" label="Done" />
      <Dot color="var(--ink-4)" label="Idea" />
    </div>
  );
}

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5 }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 2,
          background: color,
        }}
      />
      {label}
    </span>
  );
}
