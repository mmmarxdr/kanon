import { useState, type CSSProperties } from "react";
import { useTranslation } from "react-i18next";
import type { IssueNode } from "@/lib/build-issue-forest";
import { IssueCard } from "./issue-card";
import { Icon } from "@/components/ui/icons";

const STATE_DOT: Record<string, string> = {
  backlog: "var(--ink-4)",
  analysis: "var(--ink-3)",
  todo: "var(--ink-3)",
  in_progress: "var(--accent)",
  review: "var(--ai)",
  done: "var(--ok)",
};

interface HierarchyIssueBlockProps {
  node: IssueNode;
  onSelectIssue?: (key: string) => void;
  depth?: number;
}

/**
 * Root: sortable IssueCard + optional disclosure.
 * Nested: compact non-sortable row with further disclosure.
 */
export function HierarchyIssueBlock({
  node,
  onSelectIssue,
  depth = 0,
}: HierarchyIssueBlockProps) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation("board");
  const hasChildren = node.children.length > 0;
  const isRoot = depth === 0;

  const disclosure = hasChildren
    ? {
        expanded,
        count: node.descendantCount,
        onToggle: (e: React.MouseEvent) => {
          e.stopPropagation();
          setExpanded((v) => !v);
        },
      }
    : undefined;

  return (
    <div data-testid={`hierarchy-block-${node.key}`}>
      {isRoot ? (
        <IssueCard
          issue={node}
          onSelect={onSelectIssue}
          disclosure={disclosure}
        />
      ) : (
        <ChildIssueRow
          node={node}
          expanded={expanded}
          hasChildren={hasChildren}
          depth={depth}
          onToggle={() => setExpanded((v) => !v)}
          onSelect={onSelectIssue}
          expandLabel={t("expandDescendants", { count: node.descendantCount })}
          collapseLabel={t("collapseDescendants")}
        />
      )}
      {expanded &&
        hasChildren &&
        node.children.map((child) => (
          <HierarchyIssueBlock
            key={child.id}
            node={child}
            onSelectIssue={onSelectIssue}
            depth={depth + 1}
          />
        ))}
    </div>
  );
}

function ChildIssueRow({
  node,
  expanded,
  hasChildren,
  depth,
  onToggle,
  onSelect,
  expandLabel,
  collapseLabel,
}: {
  node: IssueNode;
  expanded: boolean;
  hasChildren: boolean;
  depth: number;
  onToggle: () => void;
  onSelect?: (key: string) => void;
  expandLabel: string;
  collapseLabel: string;
}) {
  const { t } = useTranslation("common");
  const rowStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    gap: 8,
    marginLeft: Math.min(depth, 6) * 12,
    padding: "6px 10px",
    borderLeft: "2px solid var(--line)",
    background: "var(--bg-2)",
    cursor: "pointer",
    fontSize: 12,
    color: "var(--ink-2)",
  };

  return (
    <div
      role="button"
      tabIndex={0}
      data-testid={`hierarchy-child-${node.key}`}
      data-issue-key={node.key}
      style={rowStyle}
      onClick={() => onSelect?.(node.key)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onSelect?.(node.key);
        }
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--bg-3)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--bg-2)";
      }}
    >
      {hasChildren ? (
        <button
          type="button"
          data-testid={`hierarchy-toggle-${node.key}`}
          aria-expanded={expanded}
          aria-label={expanded ? collapseLabel : expandLabel}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          style={{
            color: "var(--ink-4)",
            padding: 2,
            display: "inline-flex",
            transform: expanded ? "rotate(90deg)" : "none",
            transition: "transform 120ms",
          }}
        >
          <Icon.ChevR style={{ width: 11, height: 11 }} />
        </button>
      ) : (
        <span style={{ width: 15 }} />
      )}
      <span
        style={{
          width: 7,
          height: 7,
          borderRadius: "50%",
          background: STATE_DOT[node.state] ?? "var(--ink-4)",
          flexShrink: 0,
        }}
        title={t(`state.${node.state}`)}
      />
      <span className="mono" style={{ fontSize: 10.5, color: "var(--ink-3)" }}>
        {node.key}
      </span>
      <span
        style={{
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          color: "var(--ink)",
        }}
      >
        {node.title}
      </span>
      <span className="mono" style={{ fontSize: 10, color: "var(--ink-4)" }}>
        {t(`state.${node.state}`)}
      </span>
    </div>
  );
}
