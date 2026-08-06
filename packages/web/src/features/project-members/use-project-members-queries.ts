import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { projectMemberKeys } from "@/lib/query-keys";

// ── Types ───────────────────────────────────────────────────────────────────

export type MemberRole = "owner" | "admin" | "pm" | "member" | "viewer";

export interface EffectiveMemberRow {
  userId: string;
  memberId: string;
  email: string;
  displayName: string | null;
  role: MemberRole;
  source: "project" | "workspace";
  pmId?: string;
  implicit?: true;
}

// ── Queries ─────────────────────────────────────────────────────────────────

export function useProjectMembersQuery(projectKey: string) {
  return useQuery({
    queryKey: projectMemberKeys.list(projectKey),
    queryFn: () =>
      fetchApi<{ members: EffectiveMemberRow[] }>(
        `/api/projects/${projectKey}/members`,
      ).then((r) => r.members),
    enabled: !!projectKey,
    staleTime: 1000 * 60,
  });
}

// ── Mutations ────────────────────────────────────────────────────────────────

export function useAddProjectMemberMutation(projectKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: { email: string; role: MemberRole }) =>
      fetchApi<EffectiveMemberRow>(`/api/projects/${projectKey}/members`, {
        method: "POST",
        body: JSON.stringify(input),
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectMemberKeys.list(projectKey),
      });
    },
    // No generic toast — errors surfaced inline by the component
  });
}

export function useChangeProjectMemberRoleMutation(projectKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ pmId, role }: { pmId: string; role: MemberRole }) =>
      fetchApi<EffectiveMemberRow>(
        `/api/projects/${projectKey}/members/${pmId}`,
        {
          method: "PATCH",
          body: JSON.stringify({ role }),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectMemberKeys.list(projectKey),
      });
    },
    // No generic toast — errors surfaced inline by the component
  });
}

export function useRemoveProjectMemberMutation(projectKey: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (pmId: string) =>
      fetchApi<void>(`/api/projects/${projectKey}/members/${pmId}`, {
        method: "DELETE",
      }),
    onSuccess: () => {
      void queryClient.invalidateQueries({
        queryKey: projectMemberKeys.list(projectKey),
      });
    },
    // No generic toast — errors surfaced inline by the component
  });
}
