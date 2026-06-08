import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { notificationKeys } from "@/lib/query-keys";
import {
  setNotificationRead,
  setAllNotificationsRead,
} from "@/lib/cache-mutations";
import { useToastStore } from "@/stores/toast-store";
import type { NotificationDashboardItem } from "@kanon/bridge";

/**
 * Mutation to mark a single notification as read.
 *
 * - PATCH /api/notifications/:id/read (no body)
 * - Optimistic update: sets `read=true` on matching item in list cache.
 * - Rollback: restores previous list on error.
 * - On settle: invalidates notificationKeys.list to sync with server truth.
 */
export function useMarkNotificationReadMutation(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (notifId: string) =>
      fetchApi<{ id: string; read: true }>(
        `/api/notifications/${encodeURIComponent(notifId)}/read`,
        { method: "PATCH" },
      ),

    onMutate: async (notifId: string) => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.list(workspaceId),
      });
      const previous = setNotificationRead(queryClient, workspaceId, notifId);
      return { previous };
    },

    onError: (_err, _notifId, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<NotificationDashboardItem[]>(
          notificationKeys.list(workspaceId),
          context.previous,
        );
      }
      useToastStore
        .getState()
        .addToast("Failed to mark notification as read.", "error");
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationKeys.list(workspaceId),
      });
    },
  });
}

/**
 * Mutation to mark all notifications as read.
 *
 * - POST /api/workspaces/:id/notifications/read-all (no body)
 * - Optimistic update: sets `read=true` on all items in list cache.
 * - Rollback: restores previous list on error.
 * - On settle: invalidates notificationKeys.list to sync with server truth.
 */
export function useMarkAllNotificationsReadMutation(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      fetchApi<{ updated: number }>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/notifications/read-all`,
        { method: "POST" },
      ),

    onMutate: async () => {
      await queryClient.cancelQueries({
        queryKey: notificationKeys.list(workspaceId),
      });
      const previous = setAllNotificationsRead(queryClient, workspaceId);
      return { previous };
    },

    onError: (_err, _vars, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<NotificationDashboardItem[]>(
          notificationKeys.list(workspaceId),
          context.previous,
        );
      }
      useToastStore
        .getState()
        .addToast("Failed to mark all notifications as read.", "error");
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationKeys.list(workspaceId),
      });
    },
  });
}
