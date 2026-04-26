import { useRef } from "react";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { RoadmapItem, RoadmapStatus } from "@/types/roadmap";
import { ScoreBar, Tag } from "@/components/ui/primitives";

const STATUS_DOT: Record<RoadmapStatus, string> = {
  idea: "var(--ink-4)",
  planned: "var(--ink-3)",
  in_progress: "var(--accent)",
  done: "var(--ok)",
};

const STATUS_LABEL: Record<RoadmapStatus, string> = {
  idea: "Idea",
  planned: "Planned",
  in_progress: "In progress",
  done: "Done",
};

interface RoadmapCardProps {
  item: RoadmapItem;
  onSelect?: (id: string) => void;
}

export function RoadmapCard({ item, onSelect }: RoadmapCardProps) {
  const cardRef = useRef<HTMLDivElement>(null);
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: item.id });

  const setRefs = (node: HTMLDivElement | null) => {
    setNodeRef(node);
    (cardRef as React.MutableRefObject<HTMLDivElement | null>).current = node;
  };

  const handleClick = () => {
    if (!isDragging && onSelect) {
      onSelect(item.id);
    }
  };

  const totalScore =
    item.impact != null && item.effort != null
      ? item.impact - item.effort
      : null;

  const dot = STATUS_DOT[item.status];

  return (
    <div
      ref={setRefs}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 6,
        padding: "9px 11px",
        display: "flex",
        flexDirection: "column",
        gap: 6,
        cursor: isDragging ? "grabbing" : "grab",
        opacity: isDragging ? 0.5 : item.status === "done" ? 0.7 : 1,
        boxShadow: isDragging ? "var(--shadow-drag)" : undefined,
      }}
      {...attributes}
      {...listeners}
      data-testid={`roadmap-card-${item.id}`}
      onClick={handleClick}
    >
      {/* Status pip + status label */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            color: "var(--ink-2)",
          }}
        >
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: dot,
              boxShadow: `0 0 0 2px color-mix(in oklch, ${dot} 16%, transparent)`,
            }}
          />
          {STATUS_LABEL[item.status]}
        </span>
        <span style={{ flex: 1 }} />
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 12.5,
          color: "var(--ink)",
          fontWeight: 500,
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {item.title}
      </div>

      {/* Score bars + delta */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginTop: 2,
        }}
      >
        <ScoreBar label="E" value={item.effort} max={5} tone="warn" />
        <ScoreBar label="I" value={item.impact} max={5} tone="ok" />
        <span style={{ flex: 1 }} />
        {totalScore != null && (
          <span
            className="mono"
            style={{
              fontSize: 10,
              color: totalScore >= 0 ? "var(--ok)" : "var(--ink-4)",
            }}
          >
            {totalScore >= 0 ? "+" : ""}
            {totalScore}
          </span>
        )}
      </div>

      {/* Labels */}
      {item.labels.length > 0 && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            flexWrap: "wrap",
          }}
        >
          {item.labels.slice(0, 4).map((l) => (
            <Tag key={l} kind={l.startsWith("sdd:") ? "sdd" : "default"}>
              {l}
            </Tag>
          ))}
          {item.labels.length > 4 && (
            <span
              className="mono"
              style={{ fontSize: 10, color: "var(--ink-4)" }}
            >
              +{item.labels.length - 4}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
