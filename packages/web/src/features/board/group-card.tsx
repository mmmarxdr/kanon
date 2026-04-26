import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { GroupSummary } from "@/types/issue";
import { STATE_LABELS, type IssueState } from "@/stores/board-store";
import { humanizeGroupKey } from "@/lib/humanize-group-key";

const STATE_DOT: Record<IssueState, string> = {
  backlog:     "var(--ink-4)",
  todo:        "var(--ink-3)",
  in_progress: "var(--accent)",
  review:      "var(--ai)",
  done:        "var(--ok)",
};

interface GroupCardProps {
  group: GroupSummary;
  onClick?: (groupKey: string) => void;
}

export function GroupCard({ group, onClick }: GroupCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: `group:${group.groupKey}` });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    background: "var(--panel)",
    border: "1px solid var(--line)",
    borderTop: "none",
    borderRadius: 0,
    padding: "10px 10px 10px 12px",
    display: "flex",
    flexDirection: "column",
    gap: 6,
    cursor: isDragging ? "grabbing" : "grab",
    position: "relative",
    opacity: isDragging ? 0.5 : 1,
    boxShadow: isDragging ? "var(--shadow-drag)" : undefined,
  };

  const handleClick = () => {
    if (!isDragging && onClick) {
      onClick(group.groupKey);
    }
  };

  const displayTitle = group.title || humanizeGroupKey(group.groupKey);
  const dot = STATE_DOT[group.latestState] ?? "var(--ink-4)";

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`group-card-${group.groupKey}`}
      onClick={handleClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--panel)")}
    >
      {/* Top row: group glyph + key + count badge */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          className="mono"
          aria-hidden
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            width: 14,
            height: 14,
            borderRadius: 3,
            background: "color-mix(in oklch, var(--accent) 22%, transparent)",
            color: "var(--accent)",
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          G
        </span>
        <span
          className="mono"
          style={{
            fontSize: 10.5,
            color: "var(--ink-3)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            maxWidth: 140,
          }}
        >
          {group.groupKey}
        </span>
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          title={`${group.count} issue${group.count === 1 ? "" : "s"} in group`}
          style={{
            padding: "0 5px",
            borderRadius: 3,
            background: "var(--bg-3)",
            color: "var(--ink-3)",
            fontSize: 9.5,
            fontWeight: 600,
          }}
        >
          {group.count}
        </span>
      </div>

      {/* Title */}
      <div
        style={{
          fontSize: 12.5,
          color: "var(--ink)",
          fontWeight: 450,
          lineHeight: 1.35,
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
          overflow: "hidden",
        }}
      >
        {displayTitle}
      </div>

      {/* Bottom row: state indicator */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            background: dot,
            boxShadow: `0 0 0 2px color-mix(in oklch, ${dot} 16%, transparent)`,
          }}
        />
        <span
          className="mono"
          style={{
            fontSize: 9.5,
            color: "var(--ink-4)",
            letterSpacing: "0.06em",
            textTransform: "uppercase",
          }}
        >
          {STATE_LABELS[group.latestState]}
        </span>
      </div>
    </div>
  );
}
