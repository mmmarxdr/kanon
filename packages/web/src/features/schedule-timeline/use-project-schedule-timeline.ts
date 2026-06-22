/**
 * KAN-105 PR1 — TanStack Query hook for per-project schedule-timeline data.
 *
 * Wires to GET /api/projects/:key/schedule-timeline and parses the response
 * with the shared scheduleTimelineResponseSchema.
 *
 * Returns ScheduleTimelineRow[] — all issues for the project with their
 * three-plane schedule data (plan + baseline + forecast). Issues with no
 * schedule or forecast row appear with null date fields (LEFT-JOIN semantics).
 *
 * The hook is disabled when projectKey is empty (guards against components
 * that mount before a project is selected).
 */

import { useQuery } from "@tanstack/react-query";
import { fetchApiValidated } from "@/lib/api-client";
import { scheduleTimelineKeys } from "@/lib/query-keys";
import { scheduleTimelineResponseSchema } from "@kanon/shared";
import type { ScheduleTimelineRow } from "@kanon/shared";

export type { ScheduleTimelineRow };

/**
 * Fetches the schedule-timeline rows for all issues in a project.
 *
 * Returns:
 *  - data: ScheduleTimelineRow[] — when the API responds 200 (may be [])
 *  - isLoading: true             — while in-flight
 *  - isError: true               — on any HTTP error
 */
export function useProjectScheduleTimeline(projectKey: string) {
  return useQuery({
    queryKey: scheduleTimelineKeys.project(projectKey),
    queryFn: async (): Promise<ScheduleTimelineRow[]> => {
      return fetchApiValidated(
        `/api/projects/${encodeURIComponent(projectKey)}/schedule-timeline`,
        scheduleTimelineResponseSchema,
      );
    },
    enabled: !!projectKey,
    staleTime: 1000 * 60, // 1 minute — schedule data is low-churn
  });
}
