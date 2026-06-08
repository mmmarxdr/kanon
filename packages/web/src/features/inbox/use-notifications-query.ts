import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { notificationKeys } from "@/lib/query-keys";
import type { NotificationDashboardItem } from "@kanon/bridge";

interface NotificationsResponse {
  notifications: NotificationDashboardItem[];
}

/**
 * Fetches the notifications list for the active workspace.
 *
 * Cache key: notificationKeys.list(workspaceId)
 * Shape in cache: NotificationDashboardItem[] (unwrapped from the envelope
 * in the queryFn so that optimistic cache helpers can work on the array
 * directly via getQueryData/setQueryData without the envelope wrapper).
 */
export function useNotificationsQuery(workspaceId: string | null) {
  return useQuery({
    queryKey: notificationKeys.list(workspaceId ?? ""),
    queryFn: async () => {
      const data = await fetchApi<NotificationsResponse>(
        `/api/workspaces/${workspaceId}/notifications`,
      );
      return data.notifications;
    },
    enabled: !!workspaceId,
    staleTime: 30 * 1000,
  });
}
