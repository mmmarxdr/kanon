import { useMemo, useCallback, useRef } from "react";
import { createRoute, useNavigate, Link } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { useIssuesQuery, useGroupsQuery } from "@/features/board/use-issues-query";
import { useBoardStore } from "@/stores/board-store";
import { KanbanBoard } from "@/features/board/kanban-board";
import { GroupedBoard } from "@/features/board/grouped-board";
import { FilterBar } from "@/features/board/filter-bar";
import { IssueDetailPanel } from "@/features/issue-detail/issue-detail-panel";
import { useCurrentProject } from "@/hooks/use-current-project";

interface BoardSearchParams {
  issue?: string;
}

export const boardRoute = createRoute({
  path: "/board/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: BoardPage,
  validateSearch: (search: Record<string, unknown>): BoardSearchParams => ({
    issue: typeof search.issue === "string" ? search.issue : undefined,
  }),
});

function BoardPage() {
  const { projectKey } = boardRoute.useParams();
  const { issue: selectedIssueKey } = boardRoute.useSearch();
  const navigate = useNavigate();
  const { project: currentProject } = useCurrentProject();
  const { data: issues, isLoading, error } = useIssuesQuery(projectKey);
  const { data: groups, isLoading: groupsLoading } = useGroupsQuery(projectKey);
  const viewMode = useBoardStore((s) => s.viewMode);
  const triggerElementRef = useRef<HTMLElement | null>(null);

  const handleSelectIssue = useCallback(
    (key: string, element: HTMLElement) => {
      triggerElementRef.current = element;
      void navigate({
        from: boardRoute.fullPath,
        search: (prev) => ({ ...prev, issue: key }),
      });
    },
    [navigate],
  );

  const handleClosePanel = useCallback(() => {
    void navigate({
      from: boardRoute.fullPath,
      search: (prev) => {
        const { issue: _, ...rest } = prev;
        return rest;
      },
    });
  }, [navigate]);

  // Extract unique assignees from issue set for the filter bar
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
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-muted-foreground">Loading board...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-destructive-foreground">
          Failed to load issues: {error.message}
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col flex-1 overflow-hidden bg-surface">
      {/* Top bar: breadcrumb + title + tabs + filters */}
      <div className="shrink-0 px-6 pt-5 pb-3">
        {/* Breadcrumb & Title */}
        <div className="mb-4">
          <p className="text-[0.6875rem] text-on-surface/40 uppercase tracking-wider mb-1">
            Workspace &rsaquo; {currentProject?.name ?? projectKey}
          </p>
          <h1 className="text-xl font-semibold text-on-surface">
            {projectKey}
          </h1>
        </div>

        {/* Tabs row */}
        <div className="flex items-center gap-0 mb-4">
          <button
            type="button"
            className="px-3 py-2 text-sm font-medium text-on-surface border-b-2 border-primary transition-colors"
          >
            Issues
          </button>
          <button
            type="button"
            className="px-3 py-2 text-sm text-on-surface/50 hover:text-on-surface border-b-2 border-transparent transition-colors"
          >
            Views
          </button>
          <Link
            to="/roadmap/$projectKey"
            params={{ projectKey }}
            className="px-3 py-2 text-sm text-on-surface/50 hover:text-on-surface border-b-2 border-transparent transition-colors"
          >
            Roadmap
          </Link>
        </div>

        {/* Filter bar with column toggle and New Issue */}
        <FilterBar assignees={assignees} projectKey={projectKey} />
      </div>

      {/* Board */}
      <div className="flex-1 overflow-hidden px-6">
        {viewMode === "grouped" ? (
          <GroupedBoard
            groups={groups ?? []}
            issues={issues ?? []}
            projectKey={projectKey}
            onSelectIssue={handleSelectIssue}
          />
        ) : (
          <KanbanBoard
            issues={issues ?? []}
            projectKey={projectKey}
            onSelectIssue={handleSelectIssue}
          />
        )}
      </div>

      {/* Issue detail slide-over panel */}
      {selectedIssueKey && (
        <IssueDetailPanel
          issueKey={selectedIssueKey}
          projectKey={projectKey}
          onClose={handleClosePanel}
          triggerElement={triggerElementRef.current}
        />
      )}
    </div>
  );
}
