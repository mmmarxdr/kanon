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
import type { ScheduleTimelineRow, ScheduleTimelineResponse } from "@kanon/shared";

export type { ScheduleTimelineRow, ScheduleTimelineResponse };

/** KAN-153: server-side scope params. Empty → server applies its default scope. */
export interface ScheduleTimelineParams {
  cycleId?: string;
  from?: string;
  to?: string;
}

/**
 * Fetches the scoped schedule-timeline for a project (KAN-153).
 *
 * Returns the envelope `{ rows, total, truncated }`:
 *  - rows: the issues in scope (+ 1-hop dependency neighbors, flagged isNeighbor)
 *  - total: in-scope count before neighbor expansion / cap (for "showing N of M")
 *  - truncated: true when the result hit the server's hard cap
 *
 * `params` drives server-side scoping; an empty object lets the server pick its
 * default (active cycle, else a window around today, else everything for small
 * projects).
 */
export function useProjectScheduleTimeline(
  projectKey: string,
  params: ScheduleTimelineParams = {},
) {
  const qs = new URLSearchParams();
  if (params.cycleId) qs.set("cycleId", params.cycleId);
  if (params.from) qs.set("from", params.from);
  if (params.to) qs.set("to", params.to);
  const suffix = qs.toString() ? `?${qs.toString()}` : "";

  return useQuery({
    queryKey: [...scheduleTimelineKeys.project(projectKey), params],
    queryFn: async (): Promise<ScheduleTimelineResponse> => {
      return fetchApiValidated(
        `/api/projects/${encodeURIComponent(projectKey)}/schedule-timeline${suffix}`,
        scheduleTimelineResponseSchema,
      );
    },
    enabled: !!projectKey,
    staleTime: 1000 * 60, // 1 minute — schedule data is low-churn
  });
}
