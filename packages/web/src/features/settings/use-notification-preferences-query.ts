import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { notificationPreferenceKeys } from "@/lib/query-keys";
import type { NotificationPreferenceItem } from "@kanon/shared";

/**
 * Fetches the current user's notification preferences for the workspace.
 *
 * Cache key: notificationPreferenceKeys.detail(workspaceId)
 * Shape in cache: NotificationPreferenceItem (direct object — no envelope).
 *
 * GET /api/workspaces/:id/notification-preferences returns the object
 * directly, unlike the notifications list which uses an envelope.
 * Absent DB row → server synthesizes all-true defaults.
 */
export function useNotificationPreferencesQuery(workspaceId: string | null) {
  return useQuery({
    queryKey: notificationPreferenceKeys.detail(workspaceId ?? ""),
    queryFn: () =>
      fetchApi<NotificationPreferenceItem>(
        `/api/workspaces/${encodeURIComponent(workspaceId ?? "")}/notification-preferences`,
      ),
    enabled: !!workspaceId,
    staleTime: 30 * 1000,
  });
}
