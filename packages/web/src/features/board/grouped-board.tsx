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
import { useDroppable } from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import {
  useBoardStore,
  BOARD_COLUMNS,
  COLUMN_DEFAULT_STATE,
  COLUMN_LABELS,
  COLUMN_STATE_MAP,
  type BoardColumn as BoardColumnType,
} from "@/stores/board-store";
import type { GroupSummary, Issue } from "@/types/issue";
import { groupSummariesByColumn, groupByColumn } from "./use-issues-query";
import { useGroupTransitionMutation } from "./use-group-transition-mutation";
import { useTransitionMutation } from "./use-transition-mutation";
import { GroupCard } from "./group-card";
import { IssueCard } from "./issue-card";
import { GroupDrillDown } from "./group-drill-down";

/** Colored pill indicator per column (3px x 16px). */
const COLUMN_PILL_COLORS: Record<string, string> = {
  backlog: "bg-gray-400",
  analysis: "bg-primary",
  in_progress: "bg-blue-500",
  testing: "bg-amber-500",
  finished: "bg-emerald-500",
};

// --------------------------------------------------------------------------
// GroupedColumn — a single column rendering GroupCards (+ ungrouped issues)
// --------------------------------------------------------------------------

interface GroupedColumnProps {
  column: BoardColumnType;
  groups: GroupSummary[];
  ungroupedIssues: Issue[];
  showUngrouped: boolean;
  onSelectGroup: (groupKey: string, element: HTMLElement) => void;
  onSelectIssue?: (key: string, element: HTMLElement) => void;
}

function GroupedColumn({
  column,
  groups,
  ungroupedIssues,
  showUngrouped,
  onSelectGroup,
  onSelectIssue,
}: GroupedColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });

  const totalCount =
    groups.reduce((sum, g) => sum + g.count, 0) +
    (showUngrouped ? ungroupedIssues.length : 0);

  const sortableIds = [
    ...groups.map((g) => `group:${g.groupKey}`),
    ...(showUngrouped ? ungroupedIssues.map((i) => i.key) : []),
  ];

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
          <h3 className="text-[0.6875rem] font-semibold uppercase tracking-wider text-on-surface/60">
            {COLUMN_LABELS[column]}
          </h3>
        </div>
        <span className="inline-flex items-center justify-center px-1.5 py-0.5 rounded-md bg-primary-container text-on-primary-container text-[10px] font-semibold tabular-nums">
          {totalCount}
        </span>
      </div>

      {/* Droppable area */}
      <div
        ref={setNodeRef}
        className="flex flex-col gap-3 px-2 pb-3 overflow-y-auto flex-1 min-h-[4rem]"
      >
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {/* Group cards */}
          {groups.map((group) => (
            <GroupCard
              key={group.groupKey}
              group={group}
              onClick={onSelectGroup}
            />
          ))}

          {/* Ungrouped issues (shown only when toggled on) */}
          {showUngrouped &&
            ungroupedIssues.map((issue) => (
              <IssueCard
                key={issue.key}
                issue={issue}
                onSelect={onSelectIssue}
              />
            ))}
        </SortableContext>
      </div>
    </div>
  );
}

// --------------------------------------------------------------------------
// GroupedBoard — main export
// --------------------------------------------------------------------------

interface GroupedBoardProps {
  groups: GroupSummary[];
  issues: Issue[];
  projectKey: string;
  onSelectIssue?: (key: string, element: HTMLElement) => void;
}

export function GroupedBoard({
  groups,
  issues,
  projectKey,
  onSelectIssue,
}: GroupedBoardProps) {
  const { hiddenColumns, showUngrouped } = useBoardStore();
  const groupTransition = useGroupTransitionMutation(projectKey);
  const transitionMutation = useTransitionMutation(projectKey);
  const [activeGroup, setActiveGroup] = useState<GroupSummary | null>(null);
  const [activeIssue, setActiveIssue] = useState<Issue | null>(null);
  const [drillDownGroupKey, setDrillDownGroupKey] = useState<string | null>(
    null,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 8 },
    }),
  );

  // Group summaries by board column
  const groupedSummaries = useMemo(
    () => groupSummariesByColumn(groups),
    [groups],
  );

  // Ungrouped issues by column (issues with null/undefined groupKey)
  const ungroupedByColumn = useMemo(() => {
    const ungrouped = issues.filter(
      (i) => !i.groupKey,
    );
    return groupByColumn(ungrouped);
  }, [issues]);

  // Visible columns
  const visibleColumns = useMemo(
    () => BOARD_COLUMNS.filter((col) => !hiddenColumns.has(col)),
    [hiddenColumns],
  );

  const handleDragStart = useCallback(
    (event: DragStartEvent) => {
      const id = event.active.id as string;
      if (id.startsWith("group:")) {
        const groupKey = id.slice("group:".length);
        const found = groups.find((g) => g.groupKey === groupKey);
        setActiveGroup(found ?? null);
        setActiveIssue(null);
      } else {
        const found = issues.find((i) => i.key === id);
        setActiveIssue(found ?? null);
        setActiveGroup(null);
      }
    },
    [groups, issues],
  );

  const handleDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveGroup(null);
      setActiveIssue(null);

      const { active, over } = event;
      if (!over) return;

      const activeId = active.id as string;
      const overId = over.id as string;

      // Helper: determine target column from overId
      const resolveTargetColumn = (): BoardColumnType | null => {
        if (BOARD_COLUMNS.includes(overId as BoardColumnType)) {
          return overId as BoardColumnType;
        } else if (overId.startsWith("group:")) {
          const overGroupKey = overId.slice("group:".length);
          const overGroup = groups.find((g) => g.groupKey === overGroupKey);
          if (!overGroup) return null;
          return BOARD_COLUMNS.find((col) =>
            COLUMN_STATE_MAP[col].includes(overGroup.latestState),
          ) ?? null;
        } else {
          const overIssue = issues.find((i) => i.key === overId);
          if (!overIssue) return null;
          return BOARD_COLUMNS.find((col) =>
            COLUMN_STATE_MAP[col].includes(overIssue.state),
          ) ?? null;
        }
      };

      if (activeId.startsWith("group:")) {
        // --- Group card drag ---
        const groupKey = activeId.slice("group:".length);
        const group = groups.find((g) => g.groupKey === groupKey);
        if (!group) return;

        const targetColumn = resolveTargetColumn();
        if (!targetColumn) return;

        // Same-column drop is a no-op
        if (COLUMN_STATE_MAP[targetColumn].includes(group.latestState)) return;

        groupTransition.mutate({
          groupKey: group.groupKey,
          toState: COLUMN_DEFAULT_STATE[targetColumn],
        });
      } else {
        // --- Ungrouped issue drag ---
        const issue = issues.find((i) => i.key === activeId);
        if (!issue) return;

        const targetColumn = resolveTargetColumn();
        if (!targetColumn) return;

        // Same-column drop is a no-op
        if (COLUMN_STATE_MAP[targetColumn].includes(issue.state)) return;

        transitionMutation.mutate({
          issueKey: issue.key,
          toState: COLUMN_DEFAULT_STATE[targetColumn],
        });
      }
    },
    [groups, issues, groupTransition, transitionMutation],
  );

  const handleSelectGroup = useCallback(
    (groupKey: string, _element: HTMLElement) => {
      setDrillDownGroupKey(groupKey);
    },
    [],
  );

  const handleCloseDrillDown = useCallback(() => {
    setDrillDownGroupKey(null);
  }, []);

  return (
    <>
      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={handleDragStart}
        onDragEnd={handleDragEnd}
      >
        <div
          data-testid="grouped-board"
          className="flex gap-4 overflow-x-auto pb-4 h-full bg-surface [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:bg-outline-variant/30 [&::-webkit-scrollbar-thumb]:rounded-full"
        >
          {visibleColumns.map((col) => (
            <GroupedColumn
              key={col}
              column={col}
              groups={groupedSummaries.get(col) ?? []}
              ungroupedIssues={ungroupedByColumn.get(col) ?? []}
              showUngrouped={showUngrouped}
              onSelectGroup={handleSelectGroup}
              onSelectIssue={onSelectIssue}
            />
          ))}
        </div>

        {/* Drag overlay renders the card being dragged above everything */}
        <DragOverlay dropAnimation={null}>
          {activeGroup ? (
            <div className="shadow-[var(--shadow-drag)] rounded-md">
              <GroupCard group={activeGroup} />
            </div>
          ) : null}
          {activeIssue ? (
            <div className="shadow-[var(--shadow-drag)] rounded-md">
              <IssueCard issue={activeIssue} />
            </div>
          ) : null}
        </DragOverlay>
      </DndContext>

      {/* Drill-down panel */}
      {drillDownGroupKey && (
        <GroupDrillDown
          projectKey={projectKey}
          groupKey={drillDownGroupKey}
          onClose={handleCloseDrillDown}
          onSelectIssue={onSelectIssue}
        />
      )}
    </>
  );
}
