import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { dashboardKeys, proposalKeys } from "@/lib/query-keys";
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

/**
 * The screen context in which a proposal mutation is triggered.
 *
 * - "inbox":   Dashboard/Inbox view — invalidate dashboardKeys.detail so the
 *              count strip and proposal list refresh immediately.
 * - "roadmap": Roadmap horizon graph or banner — dashboardKeys.detail is NOT
 *              mounted, so skip that invalidation.
 * - "all":     Escape hatch for SSE handlers or cross-screen surfaces.
 *
 * Required — no default. Every callsite must declare its screen context so
 * that accidental over-invalidation is impossible by construction.
 */
export type ProposalContext = "inbox" | "roadmap" | "all";

export function useApplyProposalMutation(
  workspaceId: string | null,
  context: ProposalContext,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<McpProposal>(`/api/proposals/${id}/apply`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      if (context === "inbox" || context === "all") {
        void qc.invalidateQueries({ queryKey: dashboardKeys.detail(workspaceId) });
      }
      void qc.invalidateQueries({ queryKey: proposalKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: proposalKeys.pending(workspaceId) });
    },
  });
}

export function useDismissProposalMutation(
  workspaceId: string | null,
  context: ProposalContext,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      fetchApi<McpProposal>(`/api/proposals/${id}/dismiss`, {
        method: "POST",
        body: JSON.stringify({}),
      }),
    onSuccess: () => {
      if (context === "inbox" || context === "all") {
        void qc.invalidateQueries({ queryKey: dashboardKeys.detail(workspaceId) });
      }
      void qc.invalidateQueries({ queryKey: proposalKeys.list(workspaceId) });
      void qc.invalidateQueries({ queryKey: proposalKeys.pending(workspaceId) });
    },
  });
}

export function useDashboardQuery(workspaceId: string | null) {
  return useQuery({
    queryKey: dashboardKeys.detail(workspaceId),
    queryFn: () =>
      fetchApi<DashboardData>(`/api/workspaces/${workspaceId}/dashboard`),
    enabled: !!workspaceId,
    staleTime: 30 * 1000,
  });
}
