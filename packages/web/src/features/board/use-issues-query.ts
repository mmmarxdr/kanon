import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { issueKeys } from "@/lib/query-keys";
import type { Issue, GroupSummary } from "@/types/issue";
import type { BoardColumn, IssueState } from "@/stores/board-store";
import { BOARD_COLUMNS, COLUMN_STATE_MAP } from "@/stores/board-store";

/**
 * Fetches all issues for a project.
 * The full list is fetched once; filtering and grouping happen client-side.
 */
export function useIssuesQuery(projectKey: string) {
  return useQuery({
    queryKey: issueKeys.list(projectKey),
    queryFn: () =>
      fetchApi<Issue[]>(`/api/projects/${encodeURIComponent(projectKey)}/issues?parent_only=true`),
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Fetches group summaries for a project (grouped view).
 * Returns one GroupSummary per groupKey with count, latest state, title.
 */
export function useGroupsQuery(projectKey: string, enabled = true) {
  return useQuery({
    queryKey: issueKeys.groups(projectKey),
    queryFn: () =>
      fetchApi<GroupSummary[]>(
        `/api/projects/${encodeURIComponent(projectKey)}/issues/groups`,
      ),
    staleTime: 1000 * 60, // 1 minute
    enabled,
  });
}

/**
 * Fetches all issues belonging to a specific group (drill-down view).
 */
export function useGroupIssuesQuery(
  projectKey: string,
  groupKey: string,
  enabled = true,
) {
  return useQuery({
    queryKey: issueKeys.groupIssues(projectKey, groupKey),
    queryFn: () =>
      fetchApi<Issue[]>(
        `/api/projects/${encodeURIComponent(projectKey)}/issues?group_key=${encodeURIComponent(groupKey)}`,
      ),
    staleTime: 1000 * 60,
    enabled: enabled && !!groupKey,
  });
}

/**
 * Groups a flat list of issues into a Map keyed by IssueState.
 * Every state gets an entry (possibly empty array) so columns always render.
 */
export function groupByState(
  issues: Issue[],
): Map<IssueState, Issue[]> {
  const grouped = new Map<IssueState, Issue[]>();

  // Initialize all states with empty arrays
  const allStates: IssueState[] = [
    "backlog",
    "todo",
    "in_progress",
    "review",
    "done",
  ];
  for (const state of allStates) {
    grouped.set(state, []);
  }

  // Distribute issues into their state buckets
  for (const issue of issues) {
    const bucket = grouped.get(issue.state);
    if (bucket) {
      bucket.push(issue);
    }
  }

  return grouped;
}

/**
 * Build a reverse lookup: IssueState → BoardColumn.
 * Computed once at module load so groupByColumn stays O(n).
 */
const STATE_TO_COLUMN: Record<IssueState, BoardColumn> = (() => {
  const map = {} as Record<IssueState, BoardColumn>;
  for (const col of BOARD_COLUMNS) {
    for (const state of COLUMN_STATE_MAP[col]) {
      map[state] = col;
    }
  }
  return map;
})();

/**
 * Groups a flat list of issues into a Map keyed by BoardColumn.
 * Every column gets an entry (possibly empty array) so the board always renders
 * all columns. Each issue is placed in the column whose COLUMN_STATE_MAP
 * contains that issue's state.
 */
export function groupByColumn(
  issues: Issue[],
): Map<BoardColumn, Issue[]> {
  const grouped = new Map<BoardColumn, Issue[]>();

  // Initialize every column with an empty array
  for (const col of BOARD_COLUMNS) {
    grouped.set(col, []);
  }

  // Distribute issues into their column buckets
  for (const issue of issues) {
    const col = STATE_TO_COLUMN[issue.state];
    if (col) {
      grouped.get(col)!.push(issue);
    }
  }

  return grouped;
}

/**
 * Groups GroupSummary items into a Map keyed by BoardColumn,
 * based on each group's latestState.
 */
export function groupSummariesByColumn(
  groups: GroupSummary[],
): Map<BoardColumn, GroupSummary[]> {
  const grouped = new Map<BoardColumn, GroupSummary[]>();

  for (const col of BOARD_COLUMNS) {
    grouped.set(col, []);
  }

  for (const group of groups) {
    const col = STATE_TO_COLUMN[group.latestState];
    if (col) {
      grouped.get(col)!.push(group);
    }
  }

  return grouped;
}
