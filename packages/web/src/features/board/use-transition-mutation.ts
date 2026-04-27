import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { issueKeys, cycleKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { Issue } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";

interface TransitionVars {
  issueKey: string;
  toState: IssueState;
}

/**
 * Mutation that transitions an issue to a new state via
 * POST /api/issues/:key/transition { toState }.
 *
 * Implements TanStack Query optimistic updates:
 * - onMutate: snapshot cache, apply optimistic change
 * - onError: rollback to snapshot
 * - onSettled: invalidate to refetch the true server state
 */
export function useTransitionMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ issueKey, toState }: TransitionVars) =>
      fetchApi<void>(
        `/api/issues/${encodeURIComponent(issueKey)}/transition`,
        {
          method: "POST",
          body: JSON.stringify({ to_state: toState }),
        },
      ),

    onMutate: async ({ issueKey, toState }) => {
      // Cancel outgoing refetches so they don't overwrite our optimistic update
      await queryClient.cancelQueries({
        queryKey: issueKeys.list(projectKey),
      });

      // Snapshot the previous value for rollback
      const previousIssues = queryClient.getQueryData<Issue[]>(
        issueKeys.list(projectKey),
      );

      // Optimistically update the cache
      queryClient.setQueryData<Issue[]>(
        issueKeys.list(projectKey),
        (old) =>
          old?.map((issue) =>
            issue.key === issueKey ? { ...issue, state: toState } : issue,
          ),
      );

      return { previousIssues };
    },

    onError: (_err, vars, context) => {
      // Rollback to the snapshot on error
      if (context?.previousIssues) {
        queryClient.setQueryData(
          issueKeys.list(projectKey),
          context.previousIssues,
        );
      }

      // Show error toast (R-WEB-10)
      useToastStore
        .getState()
        .addToast(
          `Failed to move ${vars.issueKey} to ${vars.toState}. Change has been reverted.`,
          "error",
        );
    },

    onSettled: () => {
      // Always refetch after success or error to get the true server state
      void queryClient.invalidateQueries({
        queryKey: issueKeys.list(projectKey),
      });
      // F2: defensive duplicate of the SSE path (F1) for same-tab freshness
      // when SSE is degraded. TanStack coalesces invalidations within a tick
      // so this does not cause a double network roundtrip when F1 also fires.
      void queryClient.invalidateQueries({ queryKey: cycleKeys.all });
    },
  });
}
