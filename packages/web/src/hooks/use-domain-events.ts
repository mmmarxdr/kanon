import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { issueKeys, projectKeys, workspaceKeys } from "@/lib/query-keys";

/**
 * Connects to the workspace-scoped SSE endpoint for domain events
 * and invalidates relevant TanStack Query caches when events arrive.
 *
 * Uses native EventSource which handles:
 * - Automatic reconnection with Last-Event-ID
 * - Cookie-based auth (withCredentials)
 *
 * Event type mapping:
 * - issue.* -> invalidate issue queries
 * - project.* -> invalidate project queries
 * - member.* -> invalidate workspace/member queries
 * - work_session.* -> invalidate issue queries (for activeWorkers)
 */
export function useDomainEvents(workspaceId: string | undefined): void {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!workspaceId) return;

    const url = `/api/events/workspace/${encodeURIComponent(workspaceId)}`;
    const es = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = es;

    // ── Issue events ──────────────────────────────────────────────────
    const handleIssueEvent = () => {
      void queryClient.invalidateQueries({ queryKey: issueKeys.all });
    };

    es.addEventListener("issue.created", handleIssueEvent);
    es.addEventListener("issue.updated", handleIssueEvent);
    es.addEventListener("issue.transitioned", handleIssueEvent);
    es.addEventListener("issue.assigned", handleIssueEvent);

    // ── Project events ────────────────────────────────────────────────
    const handleProjectEvent = () => {
      void queryClient.invalidateQueries({ queryKey: projectKeys.all });
    };

    es.addEventListener("project.created", handleProjectEvent);
    es.addEventListener("project.updated", handleProjectEvent);
    es.addEventListener("project.archived", handleProjectEvent);

    // ── Member events ─────────────────────────────────────────────────
    const handleMemberEvent = () => {
      void queryClient.invalidateQueries({ queryKey: workspaceKeys.all });
    };

    es.addEventListener("member.added", handleMemberEvent);
    es.addEventListener("member.removed", handleMemberEvent);
    es.addEventListener("member.role_changed", handleMemberEvent);

    // ── Work session events (invalidate issues for activeWorkers) ─────
    const handleWorkSessionEvent = () => {
      void queryClient.invalidateQueries({ queryKey: issueKeys.all });
    };

    es.addEventListener("work_session.started", handleWorkSessionEvent);
    es.addEventListener("work_session.ended", handleWorkSessionEvent);

    // ── Cleanup ───────────────────────────────────────────────────────
    return () => {
      es.close();
      eventSourceRef.current = null;
    };
  }, [workspaceId, queryClient]);
}
