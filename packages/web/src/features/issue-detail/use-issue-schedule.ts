/**
 * KAN-98 / PR4 — Real TanStack Query hook for IssueSchedule.
 *
 * Wires to GET /api/issues/:key/schedule and parses the response with the
 * shared issueScheduleSchema. Decimal convention: estimateHours is a string
 * at the API boundary ("8.00"). Call Number(estimateHours) only at display edges.
 *
 * 404 handling: an issue may have no IssueSchedule row yet (schedule was never
 * upserted). The hook treats 404 as a valid "no schedule" state and returns
 * { data: null, isSuccess: true } rather than propagating an error. All other
 * HTTP errors bubble as query errors for the caller to handle.
 */

import { useQuery } from "@tanstack/react-query";
import { fetchApiValidated, ApiError } from "@/lib/api-client";
import { scheduleKeys } from "@/lib/query-keys";
import { issueScheduleSchema } from "@kanon/shared";
import type { IssueSchedule } from "@kanon/shared";

export type { IssueSchedule };

/**
 * Fetches the IssueSchedule for a given issue key.
 *
 * Returns:
 *  - data: IssueSchedule — when the issue has a schedule row
 *  - data: null           — when the issue has no schedule yet (404)
 *  - isLoading: true      — while the request is in-flight
 *
 * The query is disabled when issueKey is empty (guards against open panels
 * with no key loaded yet).
 */
export function useIssueSchedule(issueKey: string) {
  return useQuery({
    queryKey: scheduleKeys.detail(issueKey),
    queryFn: async (): Promise<IssueSchedule | null> => {
      try {
        return await fetchApiValidated(
          `/api/issues/${encodeURIComponent(issueKey)}/schedule`,
          issueScheduleSchema,
        );
      } catch (err) {
        // 404 = no schedule row yet — valid state, return null
        if (err instanceof ApiError && err.status === 404) {
          return null;
        }
        throw err;
      }
    },
    enabled: !!issueKey,
    staleTime: 1000 * 60, // 1 minute — schedule data is low-churn
  });
}
