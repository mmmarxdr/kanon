import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { workspaceKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { Workspace } from "./use-workspace-query";

export interface CreateWorkspaceInput {
  name: string;
  slug: string;
}

// ---------------------------------------------------------------------------
// useCreateWorkspaceMutation
// Calls POST /api/workspaces { name, slug }
// Returns the created workspace (201 response).
// Invalidates: workspaceKeys.list() on success.
// ---------------------------------------------------------------------------

export function useCreateWorkspaceMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateWorkspaceInput) =>
      fetchApi<Workspace>("/api/workspaces", {
        method: "POST",
        body: JSON.stringify(input),
      }),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() });
    },

    onError: () => {
      useToastStore
        .getState()
        .addToast("Failed to create workspace.", "error");
    },
  });
}
