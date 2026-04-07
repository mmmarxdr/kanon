import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { memberKeys, inviteKeys, workspaceKeys } from "@/lib/query-keys";

// ── Types ───────────────────────────────────────────────────────────────────

export interface WorkspaceMember {
  id: string;
  username: string;
  role: string;
  createdAt: string;
  user: {
    email: string;
    displayName: string | null;
    avatarUrl: string | null;
  };
}

export interface WorkspaceInvite {
  id: string;
  token: string;
  role: string;
  maxUses: number;
  useCount: number;
  expiresAt: string;
  revokedAt: string | null;
  label: string | null;
  inviteUrl: string;
  createdBy: {
    email: string;
    displayName: string | null;
  };
  createdAt: string;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  allowedDomains: string[];
  createdAt: string;
}

interface CreateInviteInput {
  role?: string;
  maxUses?: number;
  expiresInHours?: number;
  label?: string;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function useWorkspaceMembersQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: memberKeys.list(workspaceId ?? ""),
    queryFn: () =>
      fetchApi<WorkspaceMember[]>(
        `/api/workspaces/${workspaceId}/members`,
      ),
    enabled: !!workspaceId,
    staleTime: 1000 * 60,
  });
}

export function useWorkspaceInvitesQuery(workspaceId: string | undefined) {
  return useQuery({
    queryKey: inviteKeys.list(workspaceId ?? ""),
    queryFn: () =>
      fetchApi<{ invites: WorkspaceInvite[] }>(
        `/api/workspaces/${workspaceId}/invites`,
      ).then((res) => res.invites),
    enabled: !!workspaceId,
    staleTime: 1000 * 30,
  });
}

// ── Mutations ───────────────────────────────────────────────────────────────

export function useCreateInviteMutation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateInviteInput) =>
      fetchApi<WorkspaceInvite>(`/api/workspaces/${workspaceId}/invites`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: inviteKeys.list(workspaceId),
        });
      }
    },
  });
}

export function useRevokeInviteMutation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (inviteId: string) =>
      fetchApi<WorkspaceInvite>(
        `/api/workspaces/${workspaceId}/invites/${inviteId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: inviteKeys.list(workspaceId),
        });
      }
    },
  });
}

export function useRemoveMemberMutation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      fetchApi<void>(
        `/api/workspaces/${workspaceId}/members/${memberId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => {
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: memberKeys.list(workspaceId),
        });
      }
    },
  });
}

export function useChangeMemberRoleMutation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ memberId, role }: { memberId: string; role: string }) =>
      fetchApi<WorkspaceMember>(
        `/api/workspaces/${workspaceId}/members/${memberId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ role }),
        },
      ),
    onSuccess: () => {
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: memberKeys.list(workspaceId),
        });
      }
    },
  });
}

export function useUpdateWorkspaceMutation(workspaceId: string | undefined) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (body: { allowedDomains?: string[]; name?: string }) =>
      fetchApi<Workspace>(`/api/workspaces/${workspaceId}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      }),
    onSuccess: () => {
      if (workspaceId) {
        void queryClient.invalidateQueries({
          queryKey: [...workspaceKeys.all, "detail", workspaceId],
        });
        void queryClient.invalidateQueries({
          queryKey: workspaceKeys.list(),
        });
      }
    },
  });
}
