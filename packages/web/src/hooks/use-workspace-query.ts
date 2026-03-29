import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { workspaceKeys } from "@/lib/query-keys";

interface Workspace {
  id: string;
  name: string;
  slug: string;
  createdAt: string;
}

/**
 * Fetch the current user's workspaces.
 * Returns the list and a convenience `activeWorkspaceId` (first workspace).
 *
 * Since routes don't include workspaceId in the URL, components that need
 * a workspaceId (sidebar, useCurrentProject, etc.) use this hook instead
 * of trying to extract it from route params.
 */
export function useWorkspacesQuery() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => fetchApi<Workspace[]>("/api/workspaces"),
    staleTime: 10 * 60 * 1000, // workspaces rarely change
  });
}

/**
 * Convenience hook that returns just the active workspace ID.
 * Uses the first workspace in the user's list.
 */
export function useActiveWorkspaceId(): string | undefined {
  const { data: workspaces } = useWorkspacesQuery();
  return workspaces?.[0]?.id;
}
