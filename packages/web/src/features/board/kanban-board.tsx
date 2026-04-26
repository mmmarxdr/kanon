import { useCallback, useMemo, useState } from "react";
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
  onSelectIssue?: (key: string) => void;
  onAddIssue?: (column: BoardColumnType) => void;
}

export function KanbanBoard({ issues, projectKey, onSelectIssue, onAddIssue }: KanbanBoardProps) {
  const { hiddenColumns, filters } = useBoardStore();
  const transitionMutation = useTransitionMutation(projectKey);
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

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

  const grouped = useMemo(() => groupByColumn(filteredIssues), [filteredIssues]);

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

      let targetColumn: BoardColumnType;
      if (BOARD_COLUMNS.includes(over.id as BoardColumnType)) {
        targetColumn = over.id as BoardColumnType;
      } else {
        const overIssue = issues.find((i) => i.key === over.id);
        if (!overIssue) return;
        const found = BOARD_COLUMNS.find((col) =>
          COLUMN_STATE_MAP[col].includes(overIssue.state),
        );
        if (!found) return;
        targetColumn = found;
      }

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
      <div
        data-testid="kanban-board"
        className="kanban-scroll"
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${visibleColumns.length}, minmax(240px, 1fr))`,
          gap: 0,
          overflow: "auto",
          height: "100%",
          background: "var(--bg)",
        }}
      >
        {visibleColumns.map((col, i) => (
          <BoardColumn
            key={col}
            column={col}
            issues={grouped.get(col) ?? []}
            onSelectIssue={onSelectIssue}
            onAddIssue={onAddIssue}
            showRightDivider={i < visibleColumns.length - 1}
          />
        ))}
      </div>

      <DragOverlay dropAnimation={null}>
        {activeIssue ? (
          <div style={{ boxShadow: "var(--shadow-drag)", borderRadius: 5 }}>
            <IssueCard issue={activeIssue} />
          </div>
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
