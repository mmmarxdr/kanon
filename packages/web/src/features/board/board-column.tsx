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

/** Colored pill indicator per column (3px × 16px). */
const COLUMN_PILL_COLORS: Record<string, string> = {
  backlog: "bg-gray-400",
  analysis: "bg-primary",
  in_progress: "bg-blue-500",
  testing: "bg-amber-500",
  finished: "bg-emerald-500",
};

interface BoardColumnProps {
  column: BoardColumnType;
  issues: Issue[];
  onSelectIssue?: (key: string, element: HTMLElement) => void;
}

export function BoardColumn({ column, issues, onSelectIssue }: BoardColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });
  const [expanded, setExpanded] = useState(false);

  const states = COLUMN_STATE_MAP[column];
  const hasSubGroups = states.length > 1;

  return (
    <div
      data-testid={`board-column-${column}`}
      className={`flex flex-col w-72 min-w-[18rem] shrink-0 rounded-md bg-surface-container-low
        transition-all duration-200 ease-out
        ${isOver ? "bg-primary-fixed/20" : ""}`}
    >
      {/* Column header */}
      <div className="flex items-center justify-between px-3 py-3">
        <div className="flex items-center gap-2">
          <span
            className={`w-[3px] h-4 rounded-full ${COLUMN_PILL_COLORS[column] ?? "bg-gray-400"}`}
            aria-hidden="true"
          />
          {hasSubGroups && (
            <button
              type="button"
              onClick={() => setExpanded((prev) => !prev)}
              className="text-muted-foreground hover:text-on-surface transition-colors"
              aria-label={expanded ? "Collapse sub-groups" : "Expand sub-groups"}
            >
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 16 16"
                fill="currentColor"
                className={`w-3.5 h-3.5 transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
              >
                <path
                  fillRule="evenodd"
                  d="M6.22 4.22a.75.75 0 0 1 1.06 0l3.25 3.25a.75.75 0 0 1 0 1.06l-3.25 3.25a.75.75 0 0 1-1.06-1.06L8.94 8 6.22 5.28a.75.75 0 0 1 0-1.06Z"
                  clipRule="evenodd"
                />
              </svg>
            </button>
          )}
          <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-on-surface/60">
            {COLUMN_LABELS[column]}
          </h3>
        </div>
        <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-primary-container text-on-primary-container text-[10px] font-semibold tabular-nums">
          {issues.length}
        </span>
      </div>

      {/* Droppable area with sorted cards */}
      <div
        ref={setNodeRef}
        className="flex flex-col gap-3 px-2 pb-3 overflow-y-auto flex-1 min-h-[4rem]"
      >
        {expanded && hasSubGroups ? (
          /* Sub-grouped by DB state */
          states.map((state) => {
            const stateIssues = issues.filter((i) => i.state === state);
            return (
              <div key={state} className="flex flex-col gap-1 animate-fade-in">
                <div className="flex items-center justify-between px-1 pt-1">
                  <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                    {STATE_LABELS[state]}
                  </span>
                  <span className="text-xs text-muted-foreground tabular-nums">
                    {stateIssues.length}
                  </span>
                </div>
                <SortableContext
                  items={stateIssues.map((i) => i.key)}
                  strategy={verticalListSortingStrategy}
                >
                  {stateIssues.map((issue) => (
                    <IssueCard key={issue.key} issue={issue} onSelect={onSelectIssue} />
                  ))}
                </SortableContext>
              </div>
            );
          })
        ) : (
          /* Flat list (default / collapsed) */
          <SortableContext
            items={issues.map((i) => i.key)}
            strategy={verticalListSortingStrategy}
          >
            {issues.map((issue) => (
              <IssueCard key={issue.key} issue={issue} onSelect={onSelectIssue} />
            ))}
          </SortableContext>
        )}
      </div>
    </div>
  );
}
