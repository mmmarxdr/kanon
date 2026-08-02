import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  integrationConnectionSchema,
  integrationDiscoverySchema,
  type IssueState,
} from "@kanon/shared";
import { fetchApi, fetchApiValidated } from "@/lib/api-client";
import { integrationKeys } from "@/lib/query-keys";

export interface ConfigureRedmineInput {
  projectId: string;
  remoteProjectId: string;
  timeActivityId: string;
  readMap: Record<string, IssueState>;
  writeMap: Record<IssueState, string>;
}

export function useRedmineConnectionQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.connection(workspaceId ?? ""),
    queryFn: () =>
      fetchApiValidated(
        `/api/integrations/connections?workspaceId=${encodeURIComponent(workspaceId!)}`,
        integrationConnectionSchema.nullable(),
      ),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });
}

export function useRedmineDiscoveryQuery(connectionId: string | undefined, enabled: boolean) {
  return useQuery({
    queryKey: integrationKeys.discovery(connectionId ?? ""),
    queryFn: () =>
      fetchApiValidated(
        `/api/integrations/connections/${connectionId}/discovery`,
        integrationDiscoverySchema,
      ),
    enabled: !!connectionId && enabled,
    staleTime: 30_000,
  });
}

export function useCreateRedmineConnectionMutation(workspaceId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) =>
      fetchApi<unknown>("/api/integrations/connections", {
        method: "POST",
        body: JSON.stringify({ workspaceId, apiKey }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useConnectRedmineCredentialMutation(workspaceId: string, connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) =>
      fetchApi<unknown>("/api/integrations/credentials", {
        method: "POST",
        body: JSON.stringify({ connectionId, apiKey }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useClearRedmineCredentialMutation(workspaceId: string, connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchApi<void>(`/api/integrations/connections/${connectionId}/credential`, {
        method: "DELETE",
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useConfigureRedmineMutation(workspaceId: string, connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (input: ConfigureRedmineInput) => {
      await fetchApi<unknown>(`/api/integrations/connections/${connectionId}/mapping`, {
        method: "PUT",
        body: JSON.stringify(input),
      });
      return fetchApi<unknown>(`/api/integrations/connections/${connectionId}/lifecycle`, {
        method: "PATCH",
        body: JSON.stringify({ lifecycle: "active" }),
      });
    },
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}
