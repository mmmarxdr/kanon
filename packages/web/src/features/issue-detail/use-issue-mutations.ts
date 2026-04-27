import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { issueKeys, commentKeys, activityKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { IssueDetail, Comment } from "@/types/issue";
import type { Issue } from "@/types/issue";

/**
 * Partial update payload for PATCH /api/issues/:key.
 * Each field is optional — mutations send only the changed field.
 * State transitions are NOT handled here (use useTransitionMutation instead).
 *
 * NOTE: `cycleId` MUST NOT be added here. Cycle assignment changes MUST go
 * through `useAttachIssueMutation` / `useDetachIssueMutation` via the
 * cycle-scoped endpoints (`POST /api/cycles/:id/issues`) so that
 * `CycleScopeEvent` history is preserved for velocity tracking.
 *
 * TODO(estimate-edit): `estimate` is NOT yet on this payload — only
 * title | description | type | priority | labels | assigneeId are present.
 * F4 cycle invalidation (invalidate cycleKeys when estimate changes) is
 * gated on estimate landing here. See the TODO comment in onSettled below.
 * Do NOT add `estimate` until the estimate-edit feature ships both the UI
 * and the backend PATCH /api/issues/:key support for the field.
 */
type IssueUpdatePayload = Partial<
  Pick<
    Issue,
    "title" | "description" | "type" | "priority" | "labels" | "assigneeId"
  >
>;

/**
 * Mutation for updating issue fields via PATCH /api/issues/:key.
 *
 * Implements optimistic updates on both the detail cache and the project
 * issues list cache. On error, rolls back both caches and shows an error toast.
 * On settle, invalidates both caches to sync with server truth.
 */
export function useUpdateIssueMutation(
  issueKey: string,
  projectKey: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (payload: IssueUpdatePayload) =>
      fetchApi<IssueDetail>(
        `/api/issues/${encodeURIComponent(issueKey)}`,
        {
          method: "PATCH",
          body: JSON.stringify(payload),
        },
      ),

    onMutate: async (payload) => {
      // Cancel outgoing refetches so they don't overwrite optimistic update
      await queryClient.cancelQueries({
        queryKey: issueKeys.detail(issueKey),
      });
      await queryClient.cancelQueries({
        queryKey: issueKeys.list(projectKey),
      });

      // Snapshot previous values for rollback
      const previousDetail = queryClient.getQueryData<IssueDetail>(
        issueKeys.detail(issueKey),
      );
      const previousList = queryClient.getQueryData<Issue[]>(
        issueKeys.list(projectKey),
      );

      // Optimistically update the detail cache
      if (previousDetail) {
        queryClient.setQueryData<IssueDetail>(
          issueKeys.detail(issueKey),
          { ...previousDetail, ...payload },
        );
      }

      // Optimistically update the list cache
      if (previousList) {
        queryClient.setQueryData<Issue[]>(
          issueKeys.list(projectKey),
          previousList.map((issue) =>
            issue.key === issueKey ? { ...issue, ...payload } : issue,
          ),
        );
      }

      return { previousDetail, previousList };
    },

    onError: (_err, _payload, context) => {
      // Rollback detail cache
      if (context?.previousDetail) {
        queryClient.setQueryData(
          issueKeys.detail(issueKey),
          context.previousDetail,
        );
      }
      // Rollback list cache
      if (context?.previousList) {
        queryClient.setQueryData(
          issueKeys.list(projectKey),
          context.previousList,
        );
      }

      useToastStore
        .getState()
        .addToast(
          `Failed to update ${issueKey}. Change has been reverted.`,
          "error",
        );
    },

    onSettled: (_data, _err, _payload, _context) => {
      // Always refetch to sync with server truth
      void queryClient.invalidateQueries({
        queryKey: issueKeys.detail(issueKey),
      });
      void queryClient.invalidateQueries({
        queryKey: issueKeys.list(projectKey),
      });

      // TODO(estimate-edit): activate this block when `estimate` is added to
      // IssueUpdatePayload and the estimate-edit UI ships. Until then, leaving
      // this as a comment block so the logic is ready to uncomment atomically.
      //
      // F4: estimate is the ONLY field on this mutation that affects cycle math.
      // State transitions are owned by useTransitionMutation (F2/F3 + F1 SSE).
      // Cycle attach/detach go through useAttachIssueMutation / useDetachIssueMutation.
      //
      // if (_payload.estimate !== undefined) {
      //   // Read cycleId from the onMutate snapshot — avoids race with
      //   // optimistic update or server refetch that may have mutated the cache.
      //   // IssueDetail.cycle?.id is the correct path (IssueDetail.cycleId
      //   // does NOT exist as a top-level field on the TS type).
      //   const cycleId = _context?.previousDetail?.cycle?.id;
      //   if (cycleId) {
      //     // Narrow invalidation: only the specific cycle whose scope changed.
      //     void queryClient.invalidateQueries({
      //       queryKey: cycleKeys.detail(cycleId),
      //     });
      //   } else {
      //     // Snapshot empty (mutation fired pre-fetch) or issue not in any cycle.
      //     // Fall back to broad invalidation to honor the freshness contract.
      //     void queryClient.invalidateQueries({ queryKey: cycleKeys.all });
      //   }
      // }
      //
      // Also: import { cycleKeys } from "@/lib/query-keys" and update the
      // onSettled signature to: (_data, _err, payload, context) — removing
      // the leading underscores when activating.
    },
  });
}

/**
 * Mutation for adding a comment via POST /api/issues/:key/comments.
 *
 * Uses invalidation-based updates (not optimistic) because the server
 * generates the comment ID, author, and timestamp. On success, invalidates
 * both the comment list and activity list (new comment creates activity).
 */
export function useAddCommentMutation(issueKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: string) =>
      fetchApi<Comment>(
        `/api/issues/${encodeURIComponent(issueKey)}/comments`,
        {
          method: "POST",
          body: JSON.stringify({ body }),
        },
      ),

    onSuccess: () => {
      // Invalidate comments and activity (adding a comment generates activity)
      void queryClient.invalidateQueries({
        queryKey: commentKeys.list(issueKey),
      });
      void queryClient.invalidateQueries({
        queryKey: activityKeys.list(issueKey),
      });
    },

    onError: () => {
      useToastStore
        .getState()
        .addToast(
          `Failed to add comment to ${issueKey}.`,
          "error",
        );
    },
  });
}
