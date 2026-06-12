import { useMemo, useCallback, useState, useEffect } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { boardRoute } from "./board";
import { useIssuesQuery, useGroupsQuery } from "@/features/board/use-issues-query";
import {
  useBoardStore,
  COLUMN_DEFAULT_STATE,
  type BoardColumn,
  type IssueState,
} from "@/stores/board-store";
import { KanbanBoard } from "@/features/board/kanban-board";
import { GroupedBoard } from "@/features/board/grouped-board";
import { FilterBar } from "@/features/board/filter-bar";
import { NewIssueModal } from "@/features/board/new-issue-modal";
import { PanelErrorBoundary } from "@/components/panel-error-boundary";

export default function BoardPage() {
  const { projectKey } = boardRoute.useParams();
  const { view } = boardRoute.useSearch();
  const navigate = useNavigate();
  const { data: issues, isLoading, error } = useIssuesQuery(projectKey);
  const { data: groups, isLoading: groupsLoading } = useGroupsQuery(projectKey);
  const viewMode = useBoardStore((s) => s.viewMode);
  const setViewMode = useBoardStore((s) => s.setViewMode);

  // Allow deep-linking / forcing the board view mode via ?view= search param.
  useEffect(() => {
    if (view) setViewMode(view);
  }, [view, setViewMode]);

  const [newIssueState, setNewIssueState] = useState<IssueState | null>(null);

  const handleSelectIssue = useCallback(
    (key: string) => {
      void navigate({
        to: "/issue/$key",
        params: { key },
        search: { from: "board" },
      });
    },
    [navigate],
  );

  const handleAddIssue = useCallback((column: BoardColumn) => {
    setNewIssueState(COLUMN_DEFAULT_STATE[column]);
  }, []);

  const handleCloseNewIssue = useCallback(() => {
    setNewIssueState(null);
  }, []);

  const assignees = useMemo(() => {
    if (!issues) return [];
    const map = new Map<string, { id: string; username: string }>();
    for (const issue of issues) {
      if (issue.assigneeId && issue.assignee) {
        map.set(issue.assigneeId, {
          id: issue.assigneeId,
          username: issue.assignee.username,
        });
      }
    }
    return Array.from(map.values()).sort((a, b) =>
      a.username.localeCompare(b.username),
    );
  }, [issues]);

  if (isLoading || (viewMode === "grouped" && groupsLoading)) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        Loading board…
      </div>
    );
  }

  if (!projectKey) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 12,
          color: "var(--ink-3)",
          fontSize: 12,
        }}
      >
        <p>No project selected.</p>
        <Link to="/" style={{ color: "var(--accent-ink)" }}>
          Go to project selection
        </Link>
      </div>
    );
  }

  if (error) {
    return (
      <div
        style={{
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--bad)",
          fontSize: 12,
        }}
      >
        Failed to load issues: {error.message}
      </div>
    );
  }

  const total = issues?.length ?? 0;
  const inProgress =
    issues?.filter((i) => i.state === "in_progress").length ?? 0;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        overflow: "hidden",
        background: "var(--bg)",
      }}
    >
      {/* Toolbar */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "10px 16px",
          borderBottom: "1px solid var(--line)",
          flexShrink: 0,
        }}
      >
        <FilterBar assignees={assignees} projectKey={projectKey} />
        <div style={{ flex: 1 }} />
        <span className="mono" style={{ fontSize: 11, color: "var(--ink-3)" }}>
          {total} issues · {inProgress} active
        </span>
      </div>

      {/* Board */}
      <div style={{ flex: 1, overflow: "hidden" }}>
        {viewMode === "grouped" ? (
          <PanelErrorBoundary label="Grouped board">
            <GroupedBoard
              groups={groups ?? []}
              issues={issues ?? []}
              projectKey={projectKey}
              onSelectIssue={handleSelectIssue}
              onAddIssue={handleAddIssue}
            />
          </PanelErrorBoundary>
        ) : (
          <PanelErrorBoundary label="Kanban board">
            <KanbanBoard
              issues={issues ?? []}
              projectKey={projectKey}
              onSelectIssue={handleSelectIssue}
              onAddIssue={handleAddIssue}
            />
          </PanelErrorBoundary>
        )}
      </div>

      {newIssueState && (
        <NewIssueModal
          projectKey={projectKey}
          defaultState={newIssueState}
          onClose={handleCloseNewIssue}
        />
      )}
    </div>
  );
}
