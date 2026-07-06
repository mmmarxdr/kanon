import { useCallback, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ApiError, fetchApi } from "@/lib/api-client";
import { issueKeys, cycleKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { GroupSummary } from "@/types/issue";
import type { IssueState } from "@/stores/board-store";
import {
  RECONCILIATION_ERROR_CODE,
  reconcileTime,
  toFiniteHours,
} from "./reconcile-api";

interface GroupTransitionVars {
  groupKey: string;
  toState: IssueState;
}

/** A single issue blocked from a group transition by unconfirmed captured time. */
export interface BlockedIssue {
  key: string;
  totalHours: number;
}

function parseBlockedIssues(details: Record<string, unknown> | undefined): BlockedIssue[] | null {
  const raw = details?.blockedIssues;
  if (!Array.isArray(raw)) return null;

  const parsed: BlockedIssue[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const obj = entry as Record<string, unknown>;
    const key = obj.key;
    const totalHours = toFiniteHours(obj.totalHours);
    if (typeof key === "string" && totalHours !== null) {
      parsed.push({ key, totalHours });
    }
  }
  return parsed.length > 0 ? parsed : null;
}

/** POST /api/issues/:key/transition { to_state } — per-issue retry after reconcile. */
function transitionIssue(issueKey: string, toState: IssueState) {
  return fetchApi<void>(`/api/issues/${encodeURIComponent(issueKey)}/transition`, {
    method: "POST",
    body: JSON.stringify({ to_state: toState }),
  });
}

/**
 * Mutation that batch-transitions all issues in a group to a new state via
 * PATCH /api/projects/:key/issues/groups/:groupKey/transition { to_state }.
 *
 * Implements optimistic updates on the groups query cache with rollback on error.
 */
export function useGroupTransitionMutation(projectKey: string) {
  const queryClient = useQueryClient();
  const [blockedIssues, setBlockedIssues] = useState<BlockedIssue[] | null>(
    null,
  );
  const [isSubmitting, setIsSubmitting] = useState(false);

  const invalidate = useCallback(() => {
    // Only invalidate the groups query — the list view is not mounted when
    // the board is visible, and the server-truth for group latestState is
    // served by the groups key alone.
    void queryClient.invalidateQueries({
      queryKey: issueKeys.groups(projectKey),
    });
    // KAN-88 S1: gate cycle invalidation on active observer — avoids
    // unconditional cache busts when no Cycles view is mounted.
    // This defensive duplicate of the SSE path (F1) still fires for
    // same-tab freshness when SSE is degraded, but only if cycles are visible.
    if (
      queryClient.getQueryCache().findAll({ queryKey: cycleKeys.all, type: "active" })
        .length > 0
    ) {
      void queryClient.invalidateQueries({ queryKey: cycleKeys.all });
    }
  }, [queryClient, projectKey]);

  const mutation = useMutation({
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

    onError: (err, vars, context) => {
      // Rollback (unconditional — reconcile or not)
      if (context?.previousGroups) {
        queryClient.setQueryData(
          issueKeys.groups(projectKey),
          context.previousGroups,
        );
      }

      // 409 RECONCILIATION_REQUIRED: surface per-issue reconcile prompts
      // instead of the generic revert toast (KAN-188).
      if (err instanceof ApiError && err.code === RECONCILIATION_ERROR_CODE) {
        const parsed = parseBlockedIssues(err.details);
        if (parsed !== null) {
          setBlockedIssues(parsed);
          return;
        }
        // Malformed 409 payload (no usable blockedIssues) — fall through to
        // the generic toast rather than silently dropping the error.
      }

      useToastStore
        .getState()
        .addToast(
          `Failed to transition group "${vars.groupKey}" to ${vars.toState}. Change has been reverted.`,
          "error",
        );
    },

    onSettled: () => {
      invalidate();
    },
  });

  const confirmReconcile = useCallback(
    async (issueKey: string, confirmedTotalHours: number) => {
      const blocked = blockedIssues?.find((b) => b.key === issueKey);
      if (!blocked) return;

      setIsSubmitting(true);
      try {
        await reconcileTime(issueKey, confirmedTotalHours);
        await transitionIssue(issueKey, "done");

        setBlockedIssues((prev) =>
          (prev ?? []).filter((b) => b.key !== issueKey),
        );
        invalidate();
      } catch {
        // Either the reconcile POST or the per-issue transition retry
        // rejected (e.g. 409 RECONCILE_NO_ANCHOR). The per-issue retry runs
        // outside useMutation, so this catch is the only place this
        // rejection is observed. Surface feedback via the same toast
        // mechanism and leave the issue in blockedIssues so it can be
        // retried — never silently drop or half-transition it (KAN-188).
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
    [blockedIssues, invalidate],
  );

  const cancelReconcile = useCallback((issueKey: string) => {
    setBlockedIssues((prev) =>
      prev ? prev.filter((b) => b.key !== issueKey) : prev,
    );
  }, []);

  return {
    ...mutation,
    blockedIssues,
    confirmReconcile,
    cancelReconcile,
    isSubmitting,
  };
}
