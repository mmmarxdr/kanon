import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { projectKeys } from "@/lib/query-keys";
import type { Project } from "@/types/project";

/**
 * Fetch projects for a given workspace.
 * workspaceId comes from route params, not from auth store.
 */
export function useProjectsQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: projectKeys.list(workspaceId ?? ""),
    queryFn: () =>
      fetchApi<Project[]>(`/api/workspaces/${workspaceId}/projects`),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
}
