import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  integrationConnectionSchema,
  integrationDiscoverySchema,
  type IssuePriority,
  type IssueState,
} from "@kanon/shared";
import { fetchApi, fetchApiValidated } from "@/lib/api-client";
import { integrationKeys } from "@/lib/query-keys";

export interface ConfigureRedmineProviderMapsInput {
  timeActivityId: string;
  readMap: Record<string, IssueState>;
  writeMap: Record<IssueState, string>;
  priorityReadMap: Record<string, IssuePriority>;
  priorityWriteMap: Record<IssuePriority, string>;
}

export interface BindRedmineProjectInput {
  projectId: string;
  remoteProjectId: string;
}

export function useRedmineConnectionQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: integrationKeys.connection(workspaceId ?? ""),
    queryFn: () =>
      fetchApiValidated(
        `/api/integrations/workspaces/${workspaceId}/connections`,
        integrationConnectionSchema.nullable(),
      ),
    enabled: !!workspaceId,
    staleTime: 30_000,
    refetchInterval: (query) =>
      query.state.data?.bindings.some((binding) => binding.releasePending) ? 2_000 : false,
  });
}

export function useRedmineDiscoveryQuery(
  workspaceId: string,
  connectionId: string | undefined,
  enabled: boolean,
) {
  return useQuery({
    queryKey: integrationKeys.discovery(workspaceId, connectionId ?? ""),
    queryFn: () =>
      fetchApiValidated(
        `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/discovery`,
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
      fetchApi<unknown>(`/api/integrations/workspaces/${workspaceId}/connections`, {
        method: "POST",
        body: JSON.stringify({ apiKey }),
      }),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useConnectRedmineCredentialMutation(workspaceId: string, connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) =>
      fetchApi<unknown>(
        `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/credential`,
        {
          method: "POST",
          body: JSON.stringify({ apiKey }),
        },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useReplaceRedmineServiceCredentialMutation(
  workspaceId: string,
  connectionId: string,
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (apiKey: string) =>
      fetchApi<unknown>(
        `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/service-credential`,
        { method: "PUT", body: JSON.stringify({ apiKey }) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) });
      void queryClient.invalidateQueries({
        queryKey: integrationKeys.discovery(workspaceId, connectionId),
      });
    },
  });
}

export function useClearRedmineCredentialMutation(workspaceId: string, connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: () =>
      fetchApi<void>(
        `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/credential`,
        { method: "DELETE" },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useConfigureRedmineProviderMapsMutation(workspaceId: string, connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: ConfigureRedmineProviderMapsInput) =>
      fetchApi<unknown>(
        `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/provider-maps`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) });
      void queryClient.invalidateQueries({
        queryKey: integrationKeys.discovery(workspaceId, connectionId),
      });
    },
  });
}

export function useSetRedmineLifecycleMutation(workspaceId: string, connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (lifecycle: "active" | "paused" | "disabled") =>
      fetchApi<unknown>(
        `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/lifecycle`,
        { method: "PATCH", body: JSON.stringify({ lifecycle }) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useBindRedmineProjectMutation(workspaceId: string, connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: BindRedmineProjectInput) =>
      fetchApi<unknown>(
        `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/bindings`,
        { method: "PUT", body: JSON.stringify(input) },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}

export function useUnbindRedmineProjectMutation(workspaceId: string, connectionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (bindingId: string) =>
      fetchApi<unknown>(
        `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/bindings/${bindingId}`,
        { method: "DELETE" },
      ),
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: integrationKeys.connection(workspaceId) }),
  });
}
