import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { cycleKeys, issueKeys } from "@/lib/query-keys";
import {
  invalidateAfterCycleMembership,
  setIssueDetailCycle,
  type CycleMembershipContext,
} from "@/lib/cache-mutations";
import { useToastStore } from "@/stores/toast-store";
import type { Cycle, CycleDetail } from "@/types/cycle";
import type { IssueDetail } from "@/types/issue";

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export interface CreateCycleInput {
  name: string;
  goal?: string;
  // Date-only strings from <input type="date"> (e.g. "2026-05-01"). The hook
  // normalizes these to ISO 8601 datetime before POSTing — the API schema is
  // z.string().datetime() and rejects bare YYYY-MM-DD.
  startDate: string;
  endDate: string;
  state?: "upcoming" | "active" | "done";
}

function toIsoDatetime(dateOnlyOrIso: string): string {
  // Idempotent: if already a full ISO datetime, return as-is.
  if (dateOnlyOrIso.includes("T")) return dateOnlyOrIso;
  return new Date(`${dateOnlyOrIso}T00:00:00.000Z`).toISOString();
}

export interface AttachIssueVariables {
  cycleId: string;
  issueKey: string;
  reason?: string;
  /** REQUIRED: which screen context triggered this mutation. Controls
   *  which cache keys are invalidated after settle. */
  context: CycleMembershipContext;
  /**
   * INTERNAL-USE-ONLY for batch flows (e.g. close-cycle-dialog).
   * When true, `onSettled` skips `invalidateAfterCycleMembership` entirely.
   * The caller is responsible for a single post-batch invalidation pass.
   */
  skipInvalidation?: boolean;
}

// Re-export for convenient use in test files
export type { CycleMembershipContext };

// ---------------------------------------------------------------------------
// useCreateCycleMutation
// Calls POST /api/projects/:projectKey/cycles
// Invalidates: ["cycles", projectKey]
// ---------------------------------------------------------------------------

export function useCreateCycleMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateCycleInput) =>
      fetchApi<Cycle>(`/api/projects/${encodeURIComponent(projectKey)}/cycles`, {
        method: "POST",
        body: JSON.stringify({
          ...input,
          startDate: toIsoDatetime(input.startDate),
          endDate: toIsoDatetime(input.endDate),
        }),
      }),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cycleKeys.list(projectKey) });
    },

    onError: () => {
      useToastStore
        .getState()
        .addToast("Failed to create cycle.", "error");
    },
  });
}

// ---------------------------------------------------------------------------
// useCloseCycleMutation
// Calls POST /api/cycles/:cycleId/close
// Invalidates: ["cycles", projectKey], ["cycle", cycleId]
// ---------------------------------------------------------------------------

export function useCloseCycleMutation(cycleId: string, projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchApi<Cycle>(`/api/cycles/${encodeURIComponent(cycleId)}/close`, {
        method: "POST",
      }),

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: cycleKeys.list(projectKey) });
      void queryClient.invalidateQueries({ queryKey: cycleKeys.detail(cycleId) });
    },

    onError: () => {
      useToastStore
        .getState()
        .addToast("Failed to close cycle.", "error");
    },
  });
}

// ---------------------------------------------------------------------------
// useAttachIssueMutation
// cycleId is passed at mutate()-call time via variables (not hook param)
// because the caller may not know the target cycle at hook-construction time.
// Calls POST /api/cycles/:cycleId/issues with { add: [issueKey] }
// Invalidates: ["cycles", projectKey], ["cycle", cycleId],
//              issueKeys.detail(issueKey), issueKeys.list(projectKey)
// ---------------------------------------------------------------------------

export function useAttachIssueMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ cycleId, issueKey, reason }: AttachIssueVariables) =>
      fetchApi<CycleDetail>(
        `/api/cycles/${encodeURIComponent(cycleId)}/issues`,
        {
          method: "POST",
          body: JSON.stringify({
            add: [issueKey],
            ...(reason ? { reason } : {}),
          }),
        },
      ),

    onMutate: async (variables) => {
      const { cycleId, issueKey, context } = variables;

      // Only write optimistically to issue-detail cache when that page is mounted
      if (context === "issue-detail" || context === "all") {
        await queryClient.cancelQueries({ queryKey: issueKeys.detail(issueKey) });

        // Try to resolve the cycle name from the cache for the optimistic label
        const cycleDetail = queryClient.getQueryData<Cycle>(cycleKeys.detail(cycleId));
        const cycleName = cycleDetail?.name ?? "";

        const previousDetail = setIssueDetailCycle(queryClient, issueKey, {
          id: cycleId,
          name: cycleName,
        });

        return { previousDetail };
      }

      return { previousDetail: undefined as IssueDetail | undefined };
    },

    onError: (_err, variables, context) => {
      const { issueKey } = variables;
      // Rollback optimistic update if we made one
      if (context?.previousDetail !== undefined) {
        queryClient.setQueryData(issueKeys.detail(issueKey), context.previousDetail);
      }

      useToastStore
        .getState()
        .addToast("Failed to attach issue to cycle.", "error");
    },

    onSettled: (_data, _err, variables) => {
      if (variables.skipInvalidation) return;

      invalidateAfterCycleMembership(queryClient, {
        cycleId: variables.cycleId,
        issueKey: variables.issueKey,
        projectKey,
        context: variables.context,
      });
    },
  });
}

// ---------------------------------------------------------------------------
// useDetachIssueMutation
// Mirror of useAttachIssueMutation — uses { remove: [issueKey] } body.
// Same invalidation matrix as attach.
// ---------------------------------------------------------------------------

export function useDetachIssueMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ cycleId, issueKey, reason }: AttachIssueVariables) =>
      fetchApi<CycleDetail>(
        `/api/cycles/${encodeURIComponent(cycleId)}/issues`,
        {
          method: "POST",
          body: JSON.stringify({
            remove: [issueKey],
            ...(reason ? { reason } : {}),
          }),
        },
      ),

    onMutate: async (variables) => {
      const { issueKey, context } = variables;

      // Only write optimistically to issue-detail cache when that page is mounted
      if (context === "issue-detail" || context === "all") {
        await queryClient.cancelQueries({ queryKey: issueKeys.detail(issueKey) });

        const previousDetail = setIssueDetailCycle(queryClient, issueKey, null);

        return { previousDetail };
      }

      return { previousDetail: undefined as IssueDetail | undefined };
    },

    onError: (_err, variables, context) => {
      const { issueKey } = variables;
      // Rollback optimistic update if we made one
      if (context?.previousDetail !== undefined) {
        queryClient.setQueryData(issueKeys.detail(issueKey), context.previousDetail);
      }

      useToastStore
        .getState()
        .addToast("Failed to detach issue from cycle.", "error");
    },

    onSettled: (_data, _err, variables) => {
      if (variables.skipInvalidation) return;

      invalidateAfterCycleMembership(queryClient, {
        cycleId: variables.cycleId,
        issueKey: variables.issueKey,
        projectKey,
        context: variables.context,
      });
    },
  });
}
