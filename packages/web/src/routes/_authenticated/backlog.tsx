import { useState, useCallback, useRef } from "react";
import { createRoute, useNavigate, redirect, Link } from "@tanstack/react-router";
import { authenticatedRoute } from "../_authenticated";
import { useBacklogQuery, useGroupsQuery } from "@/features/backlog/use-backlog-query";
import { BacklogTable } from "@/features/backlog/backlog-table";
import { IssueDetailPanel } from "@/features/issue-detail/issue-detail-panel";
import { NewIssueModal } from "@/features/board/new-issue-modal";
import { useBoardStore } from "@/stores/board-store";
import { useCurrentProject } from "@/hooks/use-current-project";

interface BacklogSearchParams {
  issue?: string;
}

export const backlogRoute = createRoute({
  path: "/backlog/$projectKey",
  getParentRoute: () => authenticatedRoute,
  component: BacklogPage,
  validateSearch: (search: Record<string, unknown>): BacklogSearchParams => ({
    issue: typeof search.issue === "string" ? search.issue : undefined,
  }),
  beforeLoad: ({ params }) => {
    if (!params.projectKey || params.projectKey.trim() === "") {
      throw redirect({ to: "/" });
    }
  },
});

function BacklogPage() {
  const { projectKey } = backlogRoute.useParams();
  const { issue: selectedIssueKey } = backlogRoute.useSearch();
  const navigate = useNavigate();
  const { project: currentProject } = useCurrentProject();
  const { data: issues, isLoading, error } = useBacklogQuery(projectKey);
  const triggerElementRef = useRef<HTMLElement | null>(null);
  const [search, setSearch] = useState("");
  const [showNewIssue, setShowNewIssue] = useState(false);

  const viewMode = useBoardStore((s) => s.viewMode);
  const showUngrouped = useBoardStore((s) => s.showUngrouped);
  const setViewMode = useBoardStore((s) => s.setViewMode);
  const setShowUngrouped = useBoardStore((s) => s.setShowUngrouped);

  // Fetch groups only when in grouped mode
  const { data: groups } = useGroupsQuery(projectKey, viewMode === "grouped");

  const handleSelectIssue = useCallback(
    (key: string, element: HTMLElement) => {
      triggerElementRef.current = element;
      void navigate({
        from: backlogRoute.fullPath,
        search: (prev) => ({ ...prev, issue: key }),
      });
    },
    [navigate],
  );

  const handleClosePanel = useCallback(() => {
    void navigate({
      from: backlogRoute.fullPath,
      search: (prev) => {
        const { issue: _, ...rest } = prev;
        return rest;
      },
    });
  }, [navigate]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-full p-8">
        <p className="text-muted-foreground">Loading backlog...</p>
      </div>
    );
  }

  if (!projectKey) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 gap-3">
        <p className="text-muted-foreground">No project selected.</p>
        <Link to="/" className="text-sm text-primary hover:underline">
          Go to project selection
        </Link>
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
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* Header */}
      <div className="shrink-0 px-6 pt-5 pb-3">
        {/* Breadcrumb & Title */}
        <div className="mb-3">
          <p className="text-xs text-muted-foreground mb-0.5">
            Workspace &rsaquo; {currentProject?.name ?? projectKey}
          </p>
          <h1 className="text-xl font-semibold text-foreground">Backlog</h1>
        </div>

        {/* Search + Filters + New Issue */}
        <div className="flex items-center gap-3">
          {/* Search input */}
          <div className="relative flex-1 max-w-sm">
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
            >
              <circle cx="7" cy="7" r="4.5" />
              <path d="M10.5 10.5L14 14" />
            </svg>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search issues..."
              className="w-full pl-9 pr-3 py-2 rounded-md border border-border bg-card text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary transition-all"
              data-testid="backlog-search"
            />
          </div>

          {/* Issue count */}
          <span className="text-xs text-muted-foreground">
            {issues?.length ?? 0} issues
          </span>

          {/* View mode toggle */}
          <div className="flex items-center rounded-md bg-[#E8E8E8] p-0.5">
            <button
              type="button"
              data-testid="backlog-view-grouped"
              onClick={() => setViewMode("grouped")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "grouped"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Grouped
            </button>
            <button
              type="button"
              data-testid="backlog-view-flat"
              onClick={() => setViewMode("flat")}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${
                viewMode === "flat"
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Flat
            </button>
          </div>

          {/* Show ungrouped toggle (only visible in grouped mode) */}
          {viewMode === "grouped" && (
            <label className="flex items-center gap-1.5 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={showUngrouped}
                onChange={(e) => setShowUngrouped(e.target.checked)}
                className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
                data-testid="backlog-show-ungrouped"
              />
              <span className="text-xs text-muted-foreground">
                Show ungrouped
              </span>
            </label>
          )}

          {/* New Issue button */}
          <button
            type="button"
            onClick={() => setShowNewIssue(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-md text-sm font-medium bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
            data-testid="backlog-new-issue"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
            >
              <path d="M7 2v10M2 7h10" />
            </svg>
            New Issue
          </button>
        </div>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto px-6">
        <BacklogTable
          issues={issues ?? []}
          search={search}
          onSelectIssue={handleSelectIssue}
          groups={groups}
        />
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

      {/* New Issue modal */}
      {showNewIssue && (
        <NewIssueModal
          projectKey={projectKey}
          onClose={() => setShowNewIssue(false)}
        />
      )}
    </div>
  );
}
