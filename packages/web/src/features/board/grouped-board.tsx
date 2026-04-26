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
import { Icon } from "@/components/ui/icons";

/** Status dot color per kanban column. */
const COLUMN_DOT: Record<string, string> = {
  backlog:     "var(--ink-4)",
  todo:        "var(--ink-3)",
  in_progress: "var(--accent)",
  review:      "var(--ai)",
  done:        "var(--ok)",
};

// --------------------------------------------------------------------------
// GroupedColumn — a single column rendering GroupCards (+ ungrouped issues)
// --------------------------------------------------------------------------

interface GroupedColumnProps {
  column: BoardColumnType;
  groups: GroupSummary[];
  ungroupedIssues: Issue[];
  showUngrouped: boolean;
  onSelectGroup: (groupKey: string) => void;
  onSelectIssue?: (key: string) => void;
  onAddIssue?: (column: BoardColumnType) => void;
  showRightDivider?: boolean;
}

function GroupedColumn({
  column,
  groups,
  ungroupedIssues,
  showUngrouped,
  onSelectGroup,
  onSelectIssue,
  onAddIssue,
  showRightDivider = false,
}: GroupedColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: column });

  const totalCount =
    groups.reduce((sum, g) => sum + g.count, 0) +
    (showUngrouped ? ungroupedIssues.length : 0);

  const sortableIds = [
    ...groups.map((g) => `group:${g.groupKey}`),
    ...(showUngrouped ? ungroupedIssues.map((i) => i.key) : []),
  ];

  const dot = COLUMN_DOT[column] ?? "var(--ink-4)";
  const isEmpty = groups.length === 0 && (!showUngrouped || ungroupedIssues.length === 0);

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
          {totalCount}
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
        <SortableContext items={sortableIds} strategy={verticalListSortingStrategy}>
          {groups.map((group) => (
            <GroupCard
              key={group.groupKey}
              group={group}
              onClick={onSelectGroup}
            />
          ))}

          {showUngrouped &&
            ungroupedIssues.map((issue) => (
              <IssueCard
                key={issue.key}
                issue={issue}
                onSelect={onSelectIssue}
              />
            ))}
        </SortableContext>

        {isEmpty && (
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

// --------------------------------------------------------------------------
// GroupedBoard — main export
// --------------------------------------------------------------------------

interface GroupedBoardProps {
  groups: GroupSummary[];
  issues: Issue[];
  projectKey: string;
  onSelectIssue?: (key: string) => void;
  onAddIssue?: (column: BoardColumnType) => void;
}

export function GroupedBoard({
  groups,
  issues,
  projectKey,
  onSelectIssue,
  onAddIssue,
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

  const handleSelectGroup = useCallback((groupKey: string) => {
    setDrillDownGroupKey(groupKey);
  }, []);

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
            <GroupedColumn
              key={col}
              column={col}
              groups={groupedSummaries.get(col) ?? []}
              ungroupedIssues={ungroupedByColumn.get(col) ?? []}
              showUngrouped={showUngrouped}
              onSelectGroup={handleSelectGroup}
              onSelectIssue={onSelectIssue}
              onAddIssue={onAddIssue}
              showRightDivider={i < visibleColumns.length - 1}
            />
          ))}
        </div>

        <DragOverlay dropAnimation={null}>
          {activeGroup ? (
            <div style={{ boxShadow: "var(--shadow-drag)" }}>
              <GroupCard group={activeGroup} />
            </div>
          ) : null}
          {activeIssue ? (
            <div style={{ boxShadow: "var(--shadow-drag)" }}>
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
