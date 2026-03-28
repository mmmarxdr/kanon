import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { issueKeys } from "@/lib/query-keys";
import type { Issue } from "@/types/issue";

/**
 * Fetches ALL issues for a project (including children).
 * Unlike useIssuesQuery, this does NOT use parent_only=true.
 */
export function useBacklogQuery(projectKey: string) {
  return useQuery({
    queryKey: issueKeys.backlog(projectKey),
    queryFn: () =>
      fetchApi<Issue[]>(
        `/api/projects/${encodeURIComponent(projectKey)}/issues`,
      ),
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Re-export shared group hooks from the board module.
 * Both board and backlog use the same query keys, ensuring shared cache.
 */
export { useGroupsQuery, useGroupIssuesQuery } from "@/features/board/use-issues-query";
