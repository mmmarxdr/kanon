import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { projectKeys } from "@/lib/query-keys";
import type { Project } from "@/types/project";

export interface CreateProjectInput {
  /** Uppercase alphanumeric project key, max 6 chars, e.g. "KAN". */
  key: string;
  name: string;
  description?: string;
}

// ---------------------------------------------------------------------------
// useCreateProjectMutation
// Calls POST /api/workspaces/:workspaceId/projects { key, name, description? }
// Returns the created project (201 response).
// Invalidates: projectKeys.list(workspaceId) on success.
// ---------------------------------------------------------------------------

export function useCreateProjectMutation(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateProjectInput) =>
      fetchApi<Project>(`/api/workspaces/${workspaceId}/projects`, {
        method: "POST",
        body: JSON.stringify(input),
      }),

    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectKeys.list(workspaceId),
      });
    },
  });
}
