import { useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { notificationPreferenceKeys } from "@/lib/query-keys";
import { setNotificationPreferences } from "@/lib/cache-mutations";
import { useToastStore } from "@/stores/toast-store";
import type { NotificationPreferenceItem } from "@kanon/bridge";

/**
 * Mutation to update the current user's notification preferences.
 *
 * - PUT /api/workspaces/:id/notification-preferences
 * - Body: STRICT { emailMention, emailAssignment, emailCycleClosed } — all 3
 *   booleans required; the bridge schema is `.strict()` and 400s on extras.
 * - Optimistic update: writes the full new object to the detail cache.
 * - Rollback: restores previous object on error.
 * - On settle: invalidates notificationPreferenceKeys.detail to sync with server.
 *
 * Usage: component reads current data, computes `{ ...data, [key]: !data[key] }`,
 * and calls `mutate(fullObject)` — never a partial.
 */
export function useUpdateNotificationPreferencesMutation(workspaceId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (next: NotificationPreferenceItem) =>
      fetchApi<NotificationPreferenceItem>(
        `/api/workspaces/${encodeURIComponent(workspaceId)}/notification-preferences`,
        {
          method: "PUT",
          body: JSON.stringify(next),
        },
      ),

    onMutate: async (next: NotificationPreferenceItem) => {
      await queryClient.cancelQueries({
        queryKey: notificationPreferenceKeys.detail(workspaceId),
      });
      const previous = setNotificationPreferences(queryClient, workspaceId, next);
      return { previous };
    },

    onError: (_err, _next, context) => {
      if (context?.previous !== undefined) {
        queryClient.setQueryData<NotificationPreferenceItem>(
          notificationPreferenceKeys.detail(workspaceId),
          context.previous,
        );
      }
      useToastStore
        .getState()
        .addToast("Failed to update notification preferences.", "error");
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: notificationPreferenceKeys.detail(workspaceId),
      });
    },
  });
}
