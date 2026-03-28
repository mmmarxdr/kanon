import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { projectKeys } from "@/lib/query-keys";
import { useAuthStore } from "@/stores/auth-store";
import type { Project } from "@/types/project";

export function useProjectsQuery() {
  const workspaceId = useAuthStore((s) => s.user?.workspaceId);

  return useQuery({
    queryKey: projectKeys.list(workspaceId ?? ""),
    queryFn: () =>
      fetchApi<Project[]>(`/api/workspaces/${workspaceId}/projects`),
    enabled: !!workspaceId,
    staleTime: 5 * 60 * 1000,
  });
}
