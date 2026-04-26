import { useState } from "react";
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import type { BoardColumn as BoardColumnType } from "@/stores/board-store";
import {
  COLUMN_LABELS,
  COLUMN_STATE_MAP,
  STATE_LABELS,
} from "@/stores/board-store";
import type { Issue } from "@/types/issue";
import { IssueCard } from "./issue-card";
import { Icon } from "@/components/ui/icons";

/** Status dot color per kanban column. */
const COLUMN_DOT: Record<string, string> = {
  backlog:     "var(--ink-4)",
  todo:        "var(--ink-3)",
  in_progress: "var(--accent)",
  review:      "var(--ai)",
  done:        "var(--ok)",
};

interface BoardColumnProps {
  column: BoardColumnType;
  issues: Issue[];
  onSelectIssue?: (key: string) => void;
  onAddIssue?: (column: BoardColumnType) => void;
  showRightDivider?: boolean;
}

export function BoardColumn({
  column,
  issues,
  onSelectIssue,
  onAddIssue,
  showRightDivider = false,
}: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const [expanded, setExpanded] = useState(false);

  const states = COLUMN_STATE_MAP[column];
  const hasSubGroups = states.length > 1;
  const dot = COLUMN_DOT[column] ?? "var(--ink-4)";

  return (
    <div
      data-testid={`board-column-${column}`}
      style={{
        display: "flex",
        flexDirection: "column",
        minHeight: 0,
        borderRight: showRightDivider ? "1px solid var(--line)" : "none",
        background: isOver ? "var(--bg-2)" : "transparent",
        transition: "background 120ms ease-out",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "10px 14px 8px",
          position: "sticky",
          top: 0,
          background: "var(--bg)",
          zIndex: 1,
        }}
      >
        {hasSubGroups && (
          <button
            type="button"
            onClick={() => setExpanded((p) => !p)}
            style={{
              color: "var(--ink-4)",
              transform: expanded ? "rotate(90deg)" : "none",
              transition: "transform 120ms",
            }}
            aria-label={expanded ? "Collapse sub-groups" : "Expand sub-groups"}
          >
            <Icon.ChevR style={{ width: 11, height: 11 }} />
          </button>
        )}
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            color: "var(--ink-2)",
            fontSize: 12,
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
          {COLUMN_LABELS[column]}
        </span>
        <span style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-4)" }}>
          {issues.length}
        </span>
        <button
          type="button"
          onClick={() => onAddIssue?.(column)}
          style={{ color: "var(--ink-4)" }}
          title="Add issue"
          aria-label={`Add issue to ${COLUMN_LABELS[column]}`}
        >
          <Icon.Plus />
        </button>
      </div>

      {/* Cards */}
      <div
        ref={setNodeRef}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 0,
          padding: "0 8px 12px",
          overflowY: "auto",
          flex: 1,
          minHeight: 64,
        }}
      >
        {expanded && hasSubGroups ? (
          states.map((state) => {
            const stateIssues = issues.filter((i) => i.state === state);
            return (
              <div
                key={state}
                style={{ display: "flex", flexDirection: "column", gap: 4 }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    padding: "4px 4px 0",
                  }}
                >
                  <span
                    className="mono"
                    style={{
                      fontSize: 9.5,
                      color: "var(--ink-4)",
                      letterSpacing: "0.06em",
                      textTransform: "uppercase",
                    }}
                  >
                    {STATE_LABELS[state]}
                  </span>
                  <span
                    className="mono"
                    style={{ fontSize: 9.5, color: "var(--ink-4)" }}
                  >
                    {stateIssues.length}
                  </span>
                </div>
                <SortableContext
                  items={stateIssues.map((i) => i.key)}
                  strategy={verticalListSortingStrategy}
                >
                  {stateIssues.map((issue) => (
                    <IssueCard
                      key={issue.key}
                      issue={issue}
                      onSelect={onSelectIssue}
                    />
                  ))}
                </SortableContext>
              </div>
            );
          })
        ) : (
          <SortableContext
            items={issues.map((i) => i.key)}
            strategy={verticalListSortingStrategy}
          >
            {issues.map((issue) => (
              <IssueCard
                key={issue.key}
                issue={issue}
                onSelect={onSelectIssue}
              />
            ))}
          </SortableContext>
        )}

        {issues.length === 0 && (
          <div
            style={{
              margin: "12px 8px",
              padding: "16px 8px",
              textAlign: "center",
              color: "var(--ink-4)",
              fontSize: 11,
              border: "1px dashed var(--line)",
              borderRadius: 5,
            }}
          >
            Empty
          </div>
        )}
      </div>
    </div>
  );
}
