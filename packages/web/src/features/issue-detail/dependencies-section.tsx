import type { IssueDependencyEdge } from "@/types/issue";
import { StatePip } from "@/components/ui/primitives";


interface DependenciesSectionProps {
  blocks: IssueDependencyEdge[];
  blockedBy: IssueDependencyEdge[];
}

export function DependenciesSection({
  blocks,
  blockedBy,
}: DependenciesSectionProps) {
  if (blocks.length === 0 && blockedBy.length === 0) {
    return null;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <span
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--ink-4)",
          letterSpacing: "0.06em",
          textTransform: "uppercase",
        }}
      >
        Dependencies
      </span>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 16,
        }}
      >
        <DepCol title="Blocked by" dir="←" items={blockedBy} side="source" />
        <DepCol title="Blocks" dir="→" items={blocks} side="target" />
      </div>
    </div>
  );
}

function DepCol({
  title,
  dir,
  items,
  side,
}: {
  title: string;
  dir: string;
  items: IssueDependencyEdge[];
  side: "source" | "target";
}) {
  return (
    <div>
      <div
        className="mono"
        style={{
          fontSize: 10,
          color: "var(--ink-4)",
          marginBottom: 6,
          letterSpacing: "0.06em",
        }}
      >
        {dir} {title.toUpperCase()}
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {items.length === 0 ? (
          <span
            style={{
              fontSize: 11,
              color: "var(--ink-4)",
              fontStyle: "italic",
            }}
          >
            none
          </span>
        ) : (
          items.map((dep) => {
            const ref = dep[side];
            if (!ref) return null;
            return (
              <div
                key={dep.id}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  padding: "8px 10px",
                  border: "1px solid var(--line)",
                  borderRadius: 4,
                  background: "var(--panel)",
                }}
              >
                <StatePip state={ref.state} hideLabel />
                <span
                  className="mono"
                  style={{ fontSize: 11, color: "var(--accent)" }}
                >
                  {ref.key}
                </span>
                <span
                  style={{
                    fontSize: 12,
                    color: "var(--ink)",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {ref.title}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
