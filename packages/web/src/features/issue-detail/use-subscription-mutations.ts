import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { issueKeys } from "@/lib/query-keys";
import { setIssueDetailSubscribed } from "@/lib/cache-mutations";
import { useToastStore } from "@/stores/toast-store";
import type { SubscriptionStatus } from "@kanon/bridge";
import type { IssueDetail } from "@/types/issue";

/**
 * Mutation to subscribe the current member to an issue.
 *
 * - PUT /api/issues/:key/subscription
 * - Optimistic update: sets `subscribed=true` on the detail cache immediately.
 * - Rollback: restores the previous IssueDetail on error.
 * - On settle: invalidates issueKeys.detail to sync with server truth.
 */
export function useSubscribeMutation(issueKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchApi<SubscriptionStatus>(
        `/api/issues/${encodeURIComponent(issueKey)}/subscription`,
        { method: "PUT" },
      ),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: issueKeys.detail(issueKey) });
      const previous = setIssueDetailSubscribed(queryClient, issueKey, true);
      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<IssueDetail>(
          issueKeys.detail(issueKey),
          context.previous,
        );
      }
      useToastStore
        .getState()
        .addToast(`Failed to subscribe to ${issueKey}.`, "error");
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: issueKeys.detail(issueKey),
      });
    },
  });
}

/**
 * Mutation to unsubscribe the current member from an issue.
 *
 * - DELETE /api/issues/:key/subscription
 * - Optimistic update: sets `subscribed=false` on the detail cache immediately.
 * - Rollback: restores the previous IssueDetail on error.
 * - On settle: invalidates issueKeys.detail to sync with server truth.
 */
export function useUnsubscribeMutation(issueKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchApi<SubscriptionStatus>(
        `/api/issues/${encodeURIComponent(issueKey)}/subscription`,
        { method: "DELETE" },
      ),

    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey: issueKeys.detail(issueKey) });
      const previous = setIssueDetailSubscribed(queryClient, issueKey, false);
      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<IssueDetail>(
          issueKeys.detail(issueKey),
          context.previous,
        );
      }
      useToastStore
        .getState()
        .addToast(`Failed to unsubscribe from ${issueKey}.`, "error");
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: issueKeys.detail(issueKey),
      });
    },
  });
}
