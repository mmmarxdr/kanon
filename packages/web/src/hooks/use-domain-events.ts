import { useEffect, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { activityKeys, commentKeys, issueKeys, projectKeys, workspaceKeys, cycleKeys, notificationKeys, scheduleTimelineKeys } from "@/lib/query-keys";

/**
 * Connects to the workspace-scoped SSE endpoint for domain events
 * and invalidates relevant TanStack Query caches when events arrive.
 *
 * Uses native EventSource which handles:
 * - Automatic reconnection with Last-Event-ID
 * - Cookie-based auth (withCredentials)
 *
 * Event type mapping:
 * - issue.* -> invalidate scoped issue queries (KAN-88 S1: list+groups by projectKey)
 * - project.* -> invalidate project queries
 * - member.* -> invalidate workspace/member queries
 * - work_session.* -> invalidate issue list queries (for activeWorkers)
 * - ppm.forecast.updated -> invalidate schedule-timeline cache (KAN-105 PR3)
 *
 * KAN-88 Slice 1 — P0 invalidation-storm fix:
 * - issue.* events now invalidate issueKeys.list(projectKey) + issueKeys.groups(projectKey)
 *   when projectKey is present in the SSE payload.  Falls back to issueKeys.lists() (still
 *   excludes detail/documents/context/backlog) when projectKey is absent.
 * - cycleKeys.all is gated on active observers: only invalidated when a cycle query is
 *   currently mounted, preventing unnecessary refetch storms on pages without a Cycles view.
 */

/**
 * Returns true when at least one query under cycleKeys.all is actively observed
 * (i.e. a mounted component is subscribed to it).  Using this as a guard avoids
 * invalidating the cycle cache on every issue mutation when no Cycles view is open.
 */
function hasMountedCycleObserver(queryClient: ReturnType<typeof useQueryClient>): boolean {
  return queryClient.getQueryCache().findAll({ queryKey: cycleKeys.all, type: "active" }).length > 0;
}

export function useDomainEvents(workspaceId: string | undefined): void {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!workspaceId) return;

    const url = `/api/events/workspace/${encodeURIComponent(workspaceId)}`;
    const es = new EventSource(url, { withCredentials: true });
    eventSourceRef.current = es;

    // ── Issue events ──────────────────────────────────────────────────
    //
    // KAN-88 S1: Parse the SSE frame (which is the full DomainEvent JSON)
    // to extract payload.projectKey and scope invalidation accordingly.
    // The SSE data field is JSON.stringify(event) where event is DomainEvent,
    // so payload is nested: event.payload.projectKey.
    //
    // Invalidation breadth:
    //   - With projectKey:    list(projectKey) + groups(projectKey)
    //   - Without projectKey: lists() (still excludes detail/documents/context/backlog)
    //   - cycleKeys.all:      only when a cycle query is actively observed
    const handleIssueEvent = (ev: MessageEvent) => {
      // Extract projectKey from the SSE payload if available
      let projectKey: string | undefined;
      try {
        const frame = JSON.parse(ev.data as string) as { payload?: { projectKey?: string } };
        projectKey = frame.payload?.projectKey;
      } catch {
        // Non-JSON or missing data — fall through to broad fallback
      }

      if (projectKey) {
        // Scoped: only invalidate this project's list + groups queries
        void queryClient.invalidateQueries({ queryKey: issueKeys.list(projectKey) });
        void queryClient.invalidateQueries({ queryKey: issueKeys.groups(projectKey) });
      } else {
        // Degraded fallback: invalidate all lists (still excludes detail/documents/context/backlog)
        void queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
      }

      // Gate cycle invalidation on active observer — prevents unnecessary refetch
      // storms when no Cycles view is mounted.
      if (hasMountedCycleObserver(queryClient)) {
        void queryClient.invalidateQueries({ queryKey: cycleKeys.all });
      }
    };

    es.addEventListener("issue.created", handleIssueEvent);
    es.addEventListener("issue.updated", handleIssueEvent);
    es.addEventListener("issue.transitioned", handleIssueEvent);
    es.addEventListener("issue.assigned", handleIssueEvent);
    const handleIssueDeleted = (ev: MessageEvent) => {
      try {
        const frame = JSON.parse(ev.data as string) as { payload?: { issueKey?: string } };
        const issueKey = frame.payload?.issueKey;
        if (issueKey) {
          queryClient.removeQueries({ queryKey: issueKeys.detail(issueKey), exact: true });
          queryClient.removeQueries({ queryKey: issueKeys.documents(issueKey), exact: true });
          queryClient.removeQueries({ queryKey: commentKeys.list(issueKey), exact: true });
          queryClient.removeQueries({ queryKey: activityKeys.list(issueKey), exact: true });
        }
      } catch {
        // The collection invalidation below remains a safe degraded fallback.
      }
      handleIssueEvent(ev);
    };
    es.addEventListener("issue.deleted", handleIssueDeleted);

    // ── Cycle events ──────────────────────────────────────────────────
    // cycle.deleted is a structural change — always invalidate regardless of
    // observer state so the cache does not serve a stale deleted cycle entry.
    const handleCycleEvent = () => {
      void queryClient.invalidateQueries({ queryKey: cycleKeys.all });
    };

    es.addEventListener("cycle.deleted", handleCycleEvent);

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

    // ── Work session events (invalidate issue lists for activeWorkers) ─
    // KAN-88 S1: work_session events only invalidate issueKeys.lists() (not
    // issueKeys.all) — these events update activeWorkers display only, so
    // detail/documents/context/backlog queries do not need invalidation.
    const handleWorkSessionEvent = () => {
      void queryClient.invalidateQueries({ queryKey: issueKeys.lists() });
    };

    es.addEventListener("work_session.started", handleWorkSessionEvent);
    es.addEventListener("work_session.ended", handleWorkSessionEvent);

    // ── Notification events ───────────────────────────────────────────
    // Forward-compatible: the API does not yet emit these events, but
    // when it does, the cache will be invalidated automatically.
    const handleNotificationEvent = () => {
      void queryClient.invalidateQueries({
        queryKey: notificationKeys.list(workspaceId),
      });
    };

    es.addEventListener("notification.created", handleNotificationEvent);
    es.addEventListener("notification.marked_read", handleNotificationEvent);

    // ── Forecast events (KAN-105 PR3) ─────────────────────────────────
    // ppm.forecast.updated fires after a forecast rebuild. The payload carries
    // projectId (not projectKey), so we cannot scope to a single project cache
    // entry. We invalidate the intermediate scheduleTimelineKeys.projects() key
    // (covers all schedule-timeline project rows) — this event is rare (only on
    // forecast recompute), so the broad invalidation is acceptable.
    const handleForecastEvent = () => {
      void queryClient.invalidateQueries({
        queryKey: scheduleTimelineKeys.projects(),
      });
    };

    es.addEventListener("ppm.forecast.updated", handleForecastEvent);

    // ── Cleanup ───────────────────────────────────────────────────────
    return () => {
      es.removeEventListener("ppm.forecast.updated", handleForecastEvent);
      es.close();
      eventSourceRef.current = null;
    };
  }, [workspaceId, queryClient]);
}
