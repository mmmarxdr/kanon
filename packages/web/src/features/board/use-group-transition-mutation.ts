import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { issueKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { GroupSummary } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";

interface GroupTransitionVars {
  groupKey: string;
  toState: IssueState;
}

/**
 * Mutation that batch-transitions all issues in a group to a new state via
 * PATCH /api/projects/:key/issues/groups/:groupKey/transition { to_state }.
 *
 * Implements optimistic updates on the groups query cache with rollback on error.
 */
export function useGroupTransitionMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ groupKey, toState }: GroupTransitionVars) =>
      fetchApi<{ count: number; groupKey: string; state: string }>(
        `/api/projects/${encodeURIComponent(projectKey)}/issues/groups/${encodeURIComponent(groupKey)}/transition`,
        {
          method: "PATCH",
          body: JSON.stringify({ to_state: toState }),
        },
      ),

    onMutate: async ({ groupKey, toState }) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({
        queryKey: issueKeys.groups(projectKey),
      });

      // Snapshot for rollback
      const previousGroups = queryClient.getQueryData<GroupSummary[]>(
        issueKeys.groups(projectKey),
      );

      // Optimistically update the group's latestState
      queryClient.setQueryData<GroupSummary[]>(
        issueKeys.groups(projectKey),
        (old) =>
          old?.map((group) =>
            group.groupKey === groupKey
              ? { ...group, latestState: toState }
              : group,
          ),
      );

      return { previousGroups };
    },

    onError: (_err, vars, context) => {
      // Rollback
      if (context?.previousGroups) {
        queryClient.setQueryData(
          issueKeys.groups(projectKey),
          context.previousGroups,
        );
      }

      useToastStore
        .getState()
        .addToast(
          `Failed to transition group "${vars.groupKey}" to ${vars.toState}. Change has been reverted.`,
          "error",
        );
    },

    onSettled: () => {
      // Invalidate both groups and issues lists to get true server state
      void queryClient.invalidateQueries({
        queryKey: issueKeys.groups(projectKey),
      });
      void queryClient.invalidateQueries({
        queryKey: issueKeys.list(projectKey),
      });
    },
  });
}
