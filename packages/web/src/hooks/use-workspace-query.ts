import { useCallback, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { projectKeys, workspaceKeys } from "@/lib/query-keys";
import {
  resolveActiveWorkspaceId,
  useWorkspaceStore,
} from "@/stores/workspace-store";

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  allowedDomains: string[];
  createdAt: string;
}

/**
 * Fetch the current user's workspaces.
 */
export function useWorkspacesQuery() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: () => fetchApi<Workspace[]>("/api/workspaces"),
    staleTime: 10 * 60 * 1000,
  });
}

/**
 * Active workspace id: persisted selection if still a member, else first workspace.
 * Rewrites storage when falling back from a stale id.
 */
export function useActiveWorkspaceId(): string | undefined {
  const { data: workspaces } = useWorkspacesQuery();
  const storedId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

  const ids = workspaces?.map((w) => w.id) ?? [];
  const { id, shouldPersist } = resolveActiveWorkspaceId(storedId, ids);

  useEffect(() => {
    if (!workspaces) return;
    if (shouldPersist) {
      setActiveWorkspaceId(id ?? null);
    }
  }, [workspaces, shouldPersist, id, setActiveWorkspaceId]);

  return id;
}

/**
 * Set the active workspace and invalidate project list caches.
 */
export function useSetActiveWorkspace() {
  const queryClient = useQueryClient();
  const setActiveWorkspaceId = useWorkspaceStore((s) => s.setActiveWorkspaceId);

  return useCallback(
    (workspaceId: string) => {
      setActiveWorkspaceId(workspaceId);
      void queryClient.invalidateQueries({ queryKey: projectKeys.lists() });
    },
    [queryClient, setActiveWorkspaceId],
  );
}
