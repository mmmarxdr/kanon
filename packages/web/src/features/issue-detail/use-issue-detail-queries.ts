import { useQuery } from "@tanstack/react-query";
import { fetchApi, fetchApiValidated } from "@/lib/api-client";
import { issueKeys, commentKeys, activityKeys } from "@/lib/query-keys";
import { issueDetailSchema, type IssueDetail } from "@kanon/shared";
import type { Comment, ActivityLog, IssueDocument } from "@/types/issue";

/**
 * Fetches full issue details by key.
 * Enabled only when issueKey is truthy (panel is open).
 */
export function useIssueDetailQuery(issueKey: string | undefined) {
  return useQuery({
    queryKey: issueKeys.detail(issueKey ?? ""),
    queryFn: () =>
      fetchApiValidated(
        `/api/issues/${encodeURIComponent(issueKey!)}`,
        issueDetailSchema,
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
 * Fetches design record documents for an issue.
 * Query key nested under issueKeys.all so SSE issue.updated events
 * (which invalidate issueKeys.all) trigger a live refresh of this tab.
 */
export function useIssueDocuments(issueKey: string | undefined) {
  return useQuery({
    queryKey: issueKeys.documents(issueKey ?? ""),
    queryFn: () =>
      fetchApi<IssueDocument[]>(
        `/api/issues/${encodeURIComponent(issueKey!)}/documents`,
      ),
    enabled: !!issueKey,
    staleTime: 1000 * 30, // 30 seconds — documents may be added by agents via MCP
  });
}
