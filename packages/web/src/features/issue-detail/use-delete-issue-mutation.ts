import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { activityKeys, commentKeys, issueKeys } from "@/lib/query-keys";
import type { DeleteIssueResult } from "@kanon/shared";
import type { Issue } from "@/types/issue";

export interface DeleteIssueInput {
  confirmationKey?: string;
}

export function useDeleteIssueMutation(issueKey: string, projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: DeleteIssueInput) =>
      fetchApi<DeleteIssueResult>(`/api/issues/${encodeURIComponent(issueKey)}`, {
        method: "DELETE",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      queryClient.removeQueries({ queryKey: issueKeys.detail(issueKey), exact: true });
      queryClient.removeQueries({ queryKey: issueKeys.documents(issueKey), exact: true });
      queryClient.removeQueries({ queryKey: commentKeys.list(issueKey), exact: true });
      queryClient.removeQueries({ queryKey: activityKeys.list(issueKey), exact: true });
      queryClient.setQueriesData<Issue[]>({ queryKey: issueKeys.lists() }, (issues) =>
        issues?.filter((issue) => issue.key !== issueKey),
      );
      void queryClient.invalidateQueries({ queryKey: issueKeys.list(projectKey) });
      void queryClient.invalidateQueries({ queryKey: issueKeys.groups(projectKey) });
      void queryClient.invalidateQueries({ queryKey: issueKeys.backlog(projectKey) });
    },
  });
}
