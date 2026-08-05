import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { adminUserKeys } from "@/lib/query-keys";

export interface AdminUserListItem {
  id: string;
  email: string;
  displayName: string | null;
  emailVerified: boolean;
  isInstanceAdmin: boolean;
  createdAt: string;
  workspaceCount: number;
}

export interface AdminUserListResponse {
  users: AdminUserListItem[];
  total: number;
  limit: number;
  offset: number;
}

export interface AdminMembershipProject {
  projectId: string;
  key: string;
  name: string;
  role: string;
}

export interface AdminMembership {
  memberId: string;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  role: string;
  projectAccess: "workspace" | "assigned";
  projects: AdminMembershipProject[];
}

export interface AdminUserDetail {
  id: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  emailVerified: boolean;
  emailVerifiedAt: string | null;
  isInstanceAdmin: boolean;
  isSuperAdmin: boolean;
  createdAt: string;
  memberships: AdminMembership[];
}

export interface AdminWorkspaceOption {
  id: string;
  name: string;
  slug: string;
}

export interface AdminProjectOption {
  id: string;
  key: string;
  name: string;
}

export function useAdminUsersQuery(params: {
  q: string;
  verified?: boolean;
  offset: number;
  limit: number;
  enabled?: boolean;
}) {
  const { enabled = true, ...queryParams } = params;
  const search = new URLSearchParams();
  if (queryParams.q.trim()) search.set("q", queryParams.q.trim());
  if (queryParams.verified !== undefined) {
    search.set("verified", String(queryParams.verified));
  }
  search.set("limit", String(queryParams.limit));
  search.set("offset", String(queryParams.offset));

  return useQuery({
    queryKey: adminUserKeys.list(queryParams),
    queryFn: () =>
      fetchApi<AdminUserListResponse>(`/api/admin/users?${search.toString()}`),
    enabled,
    staleTime: 1000 * 15,
  });
}

export function useAdminUserDetailQuery(userId: string | null) {
  return useQuery({
    queryKey: adminUserKeys.detail(userId ?? ""),
    queryFn: () => fetchApi<AdminUserDetail>(`/api/admin/users/${userId}`),
    enabled: !!userId,
    staleTime: 1000 * 10,
  });
}

export function useAdminWorkspacesQuery(enabled = true) {
  return useQuery({
    queryKey: adminUserKeys.workspaces(),
    queryFn: () =>
      fetchApi<{ workspaces: AdminWorkspaceOption[] }>("/api/admin/users/workspaces").then(
        (r) => r.workspaces,
      ),
    enabled,
    staleTime: 1000 * 60,
  });
}

export function useAdminWorkspaceProjectsQuery(workspaceId: string | null) {
  return useQuery({
    queryKey: adminUserKeys.workspaceProjects(workspaceId ?? ""),
    queryFn: () =>
      fetchApi<{ projects: AdminProjectOption[] }>(
        `/api/admin/users/workspaces/${workspaceId}/projects`,
      ).then((r) => r.projects),
    enabled: !!workspaceId,
    staleTime: 1000 * 30,
  });
}

function invalidateAdminUsers(qc: ReturnType<typeof useQueryClient>, userId?: string) {
  void qc.invalidateQueries({ queryKey: adminUserKeys.lists() });
  if (userId) {
    void qc.invalidateQueries({ queryKey: adminUserKeys.detail(userId) });
  }
}

export function useVerifyAdminUserEmailMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (userId: string) =>
      fetchApi<{ id: string; emailVerified: boolean; alreadyVerified: boolean }>(
        `/api/admin/users/${userId}/verify-email`,
        { method: "POST" },
      ),
    onSuccess: (_data, userId) => invalidateAdminUsers(qc, userId),
  });
}

export function useAddAdminMembershipMutation(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      workspaceId: string;
      role?: string;
      projectAccess?: "workspace" | "assigned";
    }) =>
      fetchApi<AdminUserDetail>(`/api/admin/users/${userId}/memberships`, {
        method: "POST",
        body: JSON.stringify(body),
      }),
    onSuccess: () => invalidateAdminUsers(qc, userId),
  });
}

export function usePatchAdminMembershipMutation(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      memberId: string;
      role?: string;
      projectAccess?: "workspace" | "assigned";
    }) =>
      fetchApi<AdminUserDetail>(
        `/api/admin/users/${userId}/memberships/${input.memberId}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            role: input.role,
            projectAccess: input.projectAccess,
          }),
        },
      ),
    onSuccess: () => invalidateAdminUsers(qc, userId),
  });
}

export function useRemoveAdminMembershipMutation(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (memberId: string) =>
      fetchApi<AdminUserDetail>(
        `/api/admin/users/${userId}/memberships/${memberId}`,
        { method: "DELETE" },
      ),
    onSuccess: () => invalidateAdminUsers(qc, userId),
  });
}

export function useReplaceAdminProjectsMutation(userId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      memberId: string;
      projects: Array<{ projectId: string; role?: string }>;
    }) =>
      fetchApi<AdminUserDetail>(
        `/api/admin/users/${userId}/memberships/${input.memberId}/projects`,
        {
          method: "PUT",
          body: JSON.stringify({ projects: input.projects }),
        },
      ),
    onSuccess: () => invalidateAdminUsers(qc, userId),
  });
}

export function useAdminUsersBulkMutation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: {
      action: "verify_email" | "remove_from_workspace";
      userIds: string[];
      workspaceId?: string;
    }) =>
      fetchApi<{ results: Array<{ userId: string; ok: boolean; error?: string }> }>(
        "/api/admin/users/bulk",
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => invalidateAdminUsers(qc),
  });
}
