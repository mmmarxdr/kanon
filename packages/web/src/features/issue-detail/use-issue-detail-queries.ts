import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { issueKeys, commentKeys, activityKeys } from "@/lib/query-keys";
import type { IssueDetail, Comment, ActivityLog } from "@/types/issue";

/** Shape returned by GET /api/issues/:key/context */
export interface SessionContext {
  id: number;
  date: string;
  goal: string;
  discoveries: string[];
  accomplished: string[];
  nextSteps: string[];
  relevantFiles: string[];
}

interface IssueContextResponse {
  sessions: SessionContext[];
  sessionCount: number;
}

/**
 * Fetches full issue details by key.
 * Enabled only when issueKey is truthy (panel is open).
 */
export function useIssueDetailQuery(issueKey: string | undefined) {
  return useQuery({
    queryKey: issueKeys.detail(issueKey ?? ""),
    queryFn: () =>
      fetchApi<IssueDetail>(
        `/api/issues/${encodeURIComponent(issueKey!)}`,
      ),
    enabled: !!issueKey,
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Fetches comments for an issue.
 * Enabled only when issueKey is truthy (panel is open).
 */
export function useCommentsQuery(issueKey: string | undefined) {
  return useQuery({
    queryKey: commentKeys.list(issueKey ?? ""),
    queryFn: () =>
      fetchApi<Comment[]>(
        `/api/issues/${encodeURIComponent(issueKey!)}/comments`,
      ),
    enabled: !!issueKey,
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Fetches activity log for an issue.
 * Enabled only when issueKey is truthy (panel is open).
 */
export function useActivityQuery(issueKey: string | undefined) {
  return useQuery({
    queryKey: activityKeys.list(issueKey ?? ""),
    queryFn: () =>
      fetchApi<ActivityLog[]>(
        `/api/issues/${encodeURIComponent(issueKey!)}/activity`,
      ),
    enabled: !!issueKey,
    staleTime: 1000 * 30, // 30 seconds
  });
}

/**
 * Fetches AI session context for an issue from Engram.
 * Enabled only when issueKey is truthy. Uses longer staleTime since
 * session history changes infrequently.
 */
export function useIssueContextQuery(issueKey: string | undefined) {
  return useQuery({
    queryKey: issueKeys.context(issueKey ?? ""),
    queryFn: () =>
      fetchApi<IssueContextResponse>(
        `/api/issues/${encodeURIComponent(issueKey!)}/context`,
      ),
    enabled: !!issueKey,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}
