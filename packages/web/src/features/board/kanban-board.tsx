import { useCallback, useMemo } from "react";
import {
  DndContext,
  DragOverlay,
  closestCorners,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from "@dnd-kit/core";
import { useState } from "react";
import {
  useBoardStore,
  BOARD_COLUMNS,
  COLUMN_DEFAULT_STATE,
  COLUMN_STATE_MAP,
  type BoardColumn as BoardColumnType,
} from "@/stores/board-store";
import type { Issue } from "@/types/issue";
import { groupByColumn } from "./use-issues-query";
import { useTransitionMutation } from "./use-transition-mutation";
import { BoardColumn } from "./board-column";
import { IssueCard } from "./issue-card";

interface KanbanBoardProps {
  issues: Issue[];
  projectKey: string;
  onSelectIssue?: (key: string, element: HTMLElement) => void;
}

export function KanbanBoard({ issues, projectKey, onSelectIssue }: KanbanBoardProps) {
  const { hiddenColumns, filters } = useBoardStore();
  const transitionMutation = useTransitionMutation(projectKey);
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  // Apply client-side filters
  const filteredIssues = useMemo(() => {
    return issues.filter((issue) => {
      if (filters.type && issue.type !== filters.type) return false;
      if (filters.priority && issue.priority !== filters.priority) return false;
      if (filters.assigneeId && issue.assigneeId !== filters.assigneeId)
        return false;
      if (filters.search) {
        const q = filters.search.toLowerCase();
        if (
          !issue.key.toLowerCase().includes(q) &&
          !issue.title.toLowerCase().includes(q)
        ) {
          return false;
        }
      }
      return true;
    });
  }, [issues, filters]);

  // Group filtered issues by board column
  const grouped = useMemo(() => groupByColumn(filteredIssues), [filteredIssues]);

  // Visible columns (respecting toggle state)
  const visibleColumns = useMemo(
    () => BOARD_COLUMNS.filter((col) => !hiddenColumns.has(col)),
    [hiddenColumns],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const issueKey = event.active.id as string;
      const found = issues.find((i) => i.key === issueKey);
      setActiveIssue(found ?? null);
    },
    [issues],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveIssue(null);

      const { active, over } = event;
      if (!over) return;

      const issueKey = active.id as string;
      const issue = issues.find((i) => i.key === issueKey);
      if (!issue) return;

      // Determine the target board column.
      // `over.id` can be either a column droppable ID (a BoardColumn)
      // or another card's key. If it's a card, find that card's column.
      let targetColumn: BoardColumnType;
      if (BOARD_COLUMNS.includes(over.id as BoardColumnType)) {
        targetColumn = over.id as BoardColumnType;
      } else {
        const overIssue = issues.find((i) => i.key === over.id);
        if (!overIssue) return;
        // Find which column the over-issue belongs to
        const found = BOARD_COLUMNS.find((col) =>
          COLUMN_STATE_MAP[col].includes(overIssue.state),
        );
        if (!found) return;
        targetColumn = found;
      }

      // Same-column drop is a no-op: don't transition if the issue
      // is already in a state belonging to the target column.
      if (COLUMN_STATE_MAP[targetColumn].includes(issue.state)) return;

      transitionMutation.mutate({
        issueKey: issue.key,
        toState: COLUMN_DEFAULT_STATE[targetColumn],
      });
    },
    [issues, transitionMutation],
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div data-testid="kanban-board" className="flex gap-4 overflow-x-auto pb-4 h-full bg-surface [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-outline-variant/30 [&::-webkit-scrollbar-thumb]:rounded-full">
        {visibleColumns.map((col) => (
          <BoardColumn
            key={col}
            column={col}
            issues={grouped.get(col) ?? []}
            onSelectIssue={onSelectIssue}
          />
        ))}
      </div>

      {/* Drag overlay renders the card being dragged above everything */}
      <DragOverlay dropAnimation={null}>
        {activeIssue ? (
          <div className="shadow-[var(--shadow-drag)] rounded-md">
            <IssueCard issue={activeIssue} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
