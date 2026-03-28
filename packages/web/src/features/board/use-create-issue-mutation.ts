import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { issueKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { Issue, IssueType, IssuePriority } from "@/types/issue";

/**
 * Input shape for creating a new issue via POST /api/projects/:key/issues.
 */
export interface CreateIssueInput {
  title: string;
  description?: string;
  type?: IssueType;
  priority?: IssuePriority;
  labels?: string[];
  assigneeId?: string;
  parentId?: string;
  dueDate?: string;
}

/**
 * Mutation hook for creating a new issue.
 *
 * On success: invalidates the project issue list and shows a success toast.
 * On error: shows an error toast with the failure message.
 */
export function useCreateIssueMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateIssueInput) =>
      fetchApi<Issue>(
        `/api/projects/${encodeURIComponent(projectKey)}/issues`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),

    onSuccess: (data) => {
      // Invalidate the issue list so the board re-fetches
      void queryClient.invalidateQueries({
        queryKey: issueKeys.list(projectKey),
      });

      useToastStore
        .getState()
        .addToast(`Created issue ${data.key}`, "success");
    },

    onError: (error: Error) => {
      useToastStore
        .getState()
        .addToast(
          `Failed to create issue: ${error.message}`,
          "error",
        );
    },
  });
}
