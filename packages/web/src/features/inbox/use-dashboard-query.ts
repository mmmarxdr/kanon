import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import type { Issue } from "@/types/issue";
import type { McpProposal } from "@/types/proposal";

export interface ActiveAgentSession {
  memberId: string;
  username: string;
  isAgent: boolean;
  issueKey: string;
  source: string;
  startedAt: string;
}

export interface DashboardData {
  counts: {
    openIssues: number;
    inProgress: number;
    awaitingReview: number;
    activeAgents: number;
  };
  assigned: Issue[];
  mentions: unknown[];
  proposals: McpProposal[];
  agents: ActiveAgentSession[];
}

export function useApplyProposalMutation(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<McpProposal>(`/api/proposals/${id}/apply`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["proposals", workspaceId] });
    },
  });
}

export function useDismissProposalMutation(workspaceId: string | null) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<McpProposal>(`/api/proposals/${id}/dismiss`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["dashboard", workspaceId] });
      void qc.invalidateQueries({ queryKey: ["proposals", workspaceId] });
    },
  });
}

export function useDashboardQuery(workspaceId: string | null) {
  return useQuery({
    queryKey: ["dashboard", workspaceId],
    queryFn: () =>
      fetchApi<DashboardData>(`/api/workspaces/${workspaceId}/dashboard`),
    enabled: !!workspaceId,
    staleTime: 30 * 1000,
  });
}
