import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, fetchApi } from "@/lib/api-client";
import { issueKeys, cycleKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { Issue } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";
import {
  RECONCILIATION_ERROR_CODE,
  reconcileTime,
  toFiniteHours,
} from "./reconcile-api";

interface TransitionVars {
  issueKey: string;
  toState: IssueState;
}

/**
 * State surfaced when a transition to "done" is blocked by
 * 409 RECONCILIATION_REQUIRED — the caller renders <ReconcileModal> from this.
 */
export interface ReconcileState {
  issueKey: string;
  totalHours: number;
}

/**
 * Mutation that transitions an issue to a new state via
 * POST /api/issues/:key/transition { to_state }.
 *
 * Implements TanStack Query optimistic updates:
 * - onMutate: snapshot cache, apply optimistic change
 * - onError: rollback to snapshot
 * - onSettled: invalidate to refetch the true server state
 */
export function useTransitionMutation(projectKey: string) {
  const queryClient = useQueryClient();
  const [reconcileState, setReconcileState] = useState<ReconcileState | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const mutation = useMutation({
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

    onError: (err, vars, context) => {
      // Rollback to the snapshot on error (unconditional — reconcile or not)
      if (context?.previousIssues) {
        queryClient.setQueryData(
          issueKeys.list(projectKey),
          context.previousIssues,
        );
      }

      // 409 RECONCILIATION_REQUIRED: surface a reconcile prompt instead of the
      // generic revert toast — the transition can still succeed once the user
      // confirms captured hours (KAN-188).
      if (err instanceof ApiError && err.code === RECONCILIATION_ERROR_CODE) {
        const totalHours = toFiniteHours(err.details?.totalHours);
        if (totalHours !== null) {
          setReconcileState({ issueKey: vars.issueKey, totalHours });
          return;
        }
        // Malformed 409 payload (no usable hours) — fall through to the
        // generic toast rather than silently dropping the error.
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
      // KAN-88 S1: gate cycle invalidation on active observer — avoids
      // unconditional cache busts when no Cycles view is mounted.
      // This defensive duplicate of the SSE path (F1) still fires for
      // same-tab freshness when SSE is degraded, but only if cycles are visible.
      if (queryClient.getQueryCache().findAll({ queryKey: cycleKeys.all, type: "active" }).length > 0) {
        void queryClient.invalidateQueries({ queryKey: cycleKeys.all });
      }
    },
  });

  const confirmReconcile = useCallback(
    async (confirmedTotalHours: number) => {
      if (!reconcileState) return;
      const { issueKey } = reconcileState;
      setIsSubmitting(true);
      try {
        await reconcileTime(issueKey, confirmedTotalHours);
        await mutation.mutateAsync({ issueKey, toState: "done" });
        // Only clear the modal once BOTH the reconcile and the retried
        // transition have succeeded — clearing earlier would strand the
        // user with no way back into the flow if the retry then rejected.
        setReconcileState(null);
      } catch {
        // Either the reconcile POST or the retried transition rejected
        // (e.g. 409 RECONCILE_NO_ANCHOR for a downward correction with no
        // approved anchor). Surface feedback via the same toast mechanism
        // used elsewhere and keep the modal open/actionable — do NOT leave
        // the user with a stuck modal and zero feedback (KAN-188).
        useToastStore
          .getState()
          .addToast(
            `Failed to confirm captured time for ${issueKey}. Please try again.`,
            "error",
          );
      } finally {
        setIsSubmitting(false);
      }
    },
    [reconcileState, mutation],
  );

  const cancelReconcile = useCallback(() => {
    setReconcileState(null);
  }, []);

  return {
    ...mutation,
    reconcileState,
    confirmReconcile,
    cancelReconcile,
    isSubmitting,
  };
}
