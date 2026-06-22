/**
 * KAN-105 PR3 — useUpsertPlanMutation: TanStack Query mutation for
 * persisting a drag-rescheduled plan to PUT /api/issues/:key/schedule.
 *
 * Follows the optimistic-update + rollback + invalidate pattern from
 * use-issue-mutations.ts (useUpdateIssueMutation).
 *
 * Provenance note: the web client uses cookie-based auth. The PUT handler
 * derives provenance server-side from the authenticated session/via field —
 * no X-Kanon-Via header exists in api-client.ts. We simply call the endpoint;
 * the server records provenance automatically.
 */

import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { scheduleTimelineKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type { ScheduleTimelineRow } from "./use-project-schedule-timeline";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface UpsertPlanPayload {
  issueKey: string;
  projectKey: string;
  startDate: string;
  dueDate: string;
}

interface PutScheduleBody {
  startDate?: string;
  dueDate?: string;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

/**
 * Mutation hook for updating an issue's plan dates via PUT /api/issues/:key/schedule.
 *
 * Optimistic update: immediately patches the scheduleTimeline cache for the
 * given projectKey so the drag result appears instant.
 * Rollback: restores previous cache on error.
 * Invalidate: always refetches from server on settled to sync truth.
 */
export function useUpsertPlanMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ issueKey, startDate, dueDate }: UpsertPlanPayload) => {
      const body: PutScheduleBody = { startDate, dueDate };
      return fetchApi<unknown>(
        `/api/issues/${encodeURIComponent(issueKey)}/schedule`,
        {
          method: "PUT",
          body: JSON.stringify(body),
        },
      );
    },

    onMutate: async ({ issueKey, projectKey, startDate, dueDate }) => {
      // Cancel outgoing refetches for this project's timeline
      await queryClient.cancelQueries({
        queryKey: scheduleTimelineKeys.project(projectKey),
      });

      // Snapshot for rollback
      const previousRows = queryClient.getQueryData<ScheduleTimelineRow[]>(
        scheduleTimelineKeys.project(projectKey),
      );

      // Optimistically patch the matching row
      if (previousRows) {
        queryClient.setQueryData<ScheduleTimelineRow[]>(
          scheduleTimelineKeys.project(projectKey),
          previousRows.map((row) =>
            row.issueKey === issueKey
              ? { ...row, startDate, dueDate }
              : row,
          ),
        );
      }

      return { previousRows, projectKey };
    },

    onError: (_err, _payload, context) => {
      // Rollback to snapshot
      if (context?.previousRows !== undefined) {
        queryClient.setQueryData(
          scheduleTimelineKeys.project(context.projectKey),
          context.previousRows,
        );
      }

      useToastStore
        .getState()
        .addToast(
          `Failed to reschedule ${_payload.issueKey}. Change has been reverted.`,
          "error",
        );
    },

    onSettled: (_data, _err, _payload, context) => {
      const projectKey = context?.projectKey ?? _payload.projectKey;
      void queryClient.invalidateQueries({
        queryKey: scheduleTimelineKeys.project(projectKey),
      });
    },
  });
}
