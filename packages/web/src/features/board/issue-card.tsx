import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type { Issue } from "@/types/issue";
import { Avatar, Prio, Tag, TypeGlyph, avatarInitials } from "@/components/ui/primitives";

interface IssueCardProps {
  issue: Issue;
  onSelect?: (key: string) => void;
}

export function IssueCard({ issue, onSelect }: IssueCardProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: issue.key });

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
    if (!isDragging && onSelect) {
      onSelect(issue.key);
    }
  };

  const hasAgent = (issue.activeWorkers ?? []).some((w) => w.isAgent);
  const workers = (issue.activeWorkers ?? []).slice(0, 3);

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      data-testid={`issue-card-${issue.key}`}
      onClick={handleClick}
      onMouseEnter={(e) => (e.currentTarget.style.background = "var(--bg-2)")}
      onMouseLeave={(e) => (e.currentTarget.style.background = "var(--panel)")}
    >
      {hasAgent && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 2,
            background: "var(--ai)",
          }}
        />
      )}

      {/* Top row: type + key + priority */}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <TypeGlyph value={issue.type} />
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
          {issue.key}
        </span>
        {issue.children && issue.children.length > 0 && (
          <span
            className="mono"
            title={`${issue.children.length} child issue${issue.children.length === 1 ? "" : "s"}`}
            style={{
              padding: "0 4px",
              borderRadius: 3,
              background: "var(--bg-3)",
              color: "var(--ink-3)",
              fontSize: 9.5,
              fontWeight: 600,
            }}
          >
            {issue.children.length}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <Prio value={issue.priority} />
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
        {issue.title}
      </div>

      {/* Bottom: labels + workers + assignee */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          flexWrap: "wrap",
        }}
      >
        {issue.labels.slice(0, 3).map((l) => (
          <Tag
            key={l}
            kind={l.startsWith("sdd:") ? "sdd" : l === "ai" ? "ai" : "default"}
          >
            {l}
          </Tag>
        ))}
        <span style={{ flex: 1 }} />
        {workers.length > 0 && (
          <span style={{ display: "inline-flex", marginRight: 4 }}>
            {workers.map((w, i) => (
              <span key={w.memberId} style={{ marginLeft: i === 0 ? 0 : -4 }}>
                <Avatar
                  initials={avatarInitials(w.username, "?")}
                  name={w.username}
                  size={16}
                  isAgent={w.isAgent}
                />
              </span>
            ))}
          </span>
        )}
        {issue.assignee && (
          <Avatar
            initials={avatarInitials(issue.assignee.username, "?")}
            name={issue.assignee.username}
            size={18}
          />
        )}
      </div>
    </div>
  );
}
