import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { roadmapKeys, issueKeys } from "@/lib/query-keys";
import { useToastStore } from "@/stores/toast-store";
import type {
  RoadmapItem,
  RoadmapDependency,
  CreateRoadmapItemInput,
  UpdateRoadmapItemInput,
  PromoteRoadmapItemInput,
} from "@/types/roadmap";
import type { Issue } from "@/types/issue";
import type { Horizon } from "@/types/roadmap";

/**
 * Fetches all roadmap items for a project.
 * Optionally filters by horizon.
 */
export function useRoadmapQuery(
  projectKey: string,
  filters?: { horizon?: Horizon; label?: string },
) {
  const params = new URLSearchParams();
  if (filters?.horizon) params.set("horizon", filters.horizon);
  if (filters?.label) params.set("label", filters.label);
  const qs = params.toString();

  return useQuery({
    queryKey: roadmapKeys.list(projectKey),
    queryFn: async () => {
      const url = `/api/projects/${encodeURIComponent(projectKey)}/roadmap${qs ? `?${qs}` : ""}`;
      return fetchApi<RoadmapItem[]>(url);
    },
    staleTime: 1000 * 60, // 1 minute
  });
}

/**
 * Mutation hook for creating a new roadmap item.
 */
export function useCreateRoadmapMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateRoadmapItemInput) =>
      fetchApi<RoadmapItem>(
        `/api/projects/${encodeURIComponent(projectKey)}/roadmap`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),

    onSuccess: (data) => {
      void queryClient.invalidateQueries({
        queryKey: roadmapKeys.list(projectKey),
      });

      useToastStore
        .getState()
        .addToast(`Created roadmap item "${data.title}"`, "success");
    },

    onError: (error: Error) => {
      useToastStore
        .getState()
        .addToast(
          `Failed to create roadmap item: ${error.message}`,
          "error",
        );
    },
  });
}

/**
 * Mutation hook for updating a roadmap item.
 */
export function useUpdateRoadmapMutation(
  projectKey: string,
  itemId: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: UpdateRoadmapItemInput) =>
      fetchApi<RoadmapItem>(
        `/api/projects/${encodeURIComponent(projectKey)}/roadmap/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          body: JSON.stringify(body),
        },
      ),

    onMutate: async (payload) => {
      await queryClient.cancelQueries({
        queryKey: roadmapKeys.list(projectKey),
      });

      const previousList = queryClient.getQueryData<RoadmapItem[]>(
        roadmapKeys.list(projectKey),
      );

      if (previousList) {
        queryClient.setQueryData<RoadmapItem[]>(
          roadmapKeys.list(projectKey),
          previousList.map((item) =>
            item.id === itemId ? { ...item, ...payload } : item,
          ),
        );
      }

      return { previousList };
    },

    onError: (_err, _payload, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(
          roadmapKeys.list(projectKey),
          context.previousList,
        );
      }

      useToastStore
        .getState()
        .addToast("Failed to update roadmap item. Change reverted.", "error");
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: roadmapKeys.list(projectKey),
      });
    },
  });
}

/**
 * Mutation hook for deleting a roadmap item.
 */
export function useDeleteRoadmapMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) =>
      fetchApi<undefined>(
        `/api/projects/${encodeURIComponent(projectKey)}/roadmap/${encodeURIComponent(itemId)}`,
        {
          method: "DELETE",
        },
      ),

    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: roadmapKeys.list(projectKey),
      });

      useToastStore
        .getState()
        .addToast("Roadmap item deleted", "success");
    },

    onError: (error: Error) => {
      useToastStore
        .getState()
        .addToast(
          `Failed to delete roadmap item: ${error.message}`,
          "error",
        );
    },
  });
}

/**
 * Mutation hook for promoting a roadmap item to an issue.
 */
/**
 * Variables accepted per-call by the DnD mutation.
 * `itemId` is bound at call time (not at hook creation) so a single
 * mutation instance can move ANY dragged card.
 */
export interface HorizonDndVars {
  itemId: string;
  horizon: Horizon;
  sortOrder: number;
}

/**
 * Mutation hook for drag-and-drop horizon changes.
 *
 * Unlike `useUpdateRoadmapMutation` (which binds itemId at creation),
 * this hook accepts `itemId` per-call so the board can reuse one
 * instance for every card drag.
 *
 * Optimistic update → rollback → invalidate pattern mirrors
 * `useTransitionMutation` in the board feature.
 */
export function useHorizonDndMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, horizon, sortOrder }: HorizonDndVars) =>
      fetchApi<RoadmapItem>(
        `/api/projects/${encodeURIComponent(projectKey)}/roadmap/${encodeURIComponent(itemId)}`,
        {
          method: "PATCH",
          body: JSON.stringify({ horizon, sortOrder }),
        },
      ),

    onMutate: async ({ itemId, horizon, sortOrder }) => {
      await queryClient.cancelQueries({
        queryKey: roadmapKeys.list(projectKey),
      });

      const previousList = queryClient.getQueryData<RoadmapItem[]>(
        roadmapKeys.list(projectKey),
      );

      if (previousList) {
        queryClient.setQueryData<RoadmapItem[]>(
          roadmapKeys.list(projectKey),
          previousList.map((item) =>
            item.id === itemId
              ? { ...item, horizon, sortOrder }
              : item,
          ),
        );
      }

      return { previousList };
    },

    onError: (_err, _vars, context) => {
      if (context?.previousList) {
        queryClient.setQueryData(
          roadmapKeys.list(projectKey),
          context.previousList,
        );
      }

      useToastStore
        .getState()
        .addToast(
          "Failed to move roadmap item. Change has been reverted.",
          "error",
        );
    },

    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: roadmapKeys.list(projectKey),
      });
    },
  });
}

export function usePromoteRoadmapMutation(projectKey: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      itemId,
      body,
    }: {
      itemId: string;
      body?: PromoteRoadmapItemInput;
    }) =>
      fetchApi<Issue>(
        `/api/projects/${encodeURIComponent(projectKey)}/roadmap/${encodeURIComponent(itemId)}/promote`,
        {
          method: "POST",
          body: JSON.stringify(body ?? {}),
        },
      ),

    onSuccess: (data) => {
      // Invalidate both roadmap and issue lists
      void queryClient.invalidateQueries({
        queryKey: roadmapKeys.list(projectKey),
      });
      void queryClient.invalidateQueries({
        queryKey: issueKeys.list(projectKey),
      });

      useToastStore
        .getState()
        .addToast(`Promoted to issue ${data.key}`, "success");
    },

    onError: (error: Error) => {
      useToastStore
        .getState()
        .addToast(
          `Failed to promote roadmap item: ${error.message}`,
          "error",
        );
    },
  });
}

/**
 * Mutation hook for adding a dependency (source blocks target).
 */
export function useAddDependencyMutation(
  projectKey: string,
  itemId: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: { targetId: string; type?: "blocks" }) =>
      fetchApi<RoadmapDependency>(
        `/api/projects/${encodeURIComponent(projectKey)}/roadmap/${encodeURIComponent(itemId)}/dependencies`,
        {
          method: "POST",
          body: JSON.stringify(body),
        },
      ),

    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: roadmapKeys.list(projectKey),
      });

      useToastStore
        .getState()
        .addToast("Dependency added", "success");
    },

    onError: (error: Error) => {
      useToastStore
        .getState()
        .addToast(
          `Failed to add dependency: ${error.message}`,
          "error",
        );
    },
  });
}

/**
 * Mutation hook for removing a dependency.
 */
export function useRemoveDependencyMutation(
  projectKey: string,
  itemId: string,
) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (depId: string) =>
      fetchApi<undefined>(
        `/api/projects/${encodeURIComponent(projectKey)}/roadmap/${encodeURIComponent(itemId)}/dependencies/${encodeURIComponent(depId)}`,
        {
          method: "DELETE",
        },
      ),

    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: roadmapKeys.list(projectKey),
      });

      useToastStore
        .getState()
        .addToast("Dependency removed", "success");
    },

    onError: (error: Error) => {
      useToastStore
        .getState()
        .addToast(
          `Failed to remove dependency: ${error.message}`,
          "error",
        );
    },
  });
}
