import { useQuery } from "@tanstack/react-query";
import { fetchApi } from "@/lib/api-client";
import { useActiveWorkspaceId } from "@/hooks/use-workspace-query";
import {
  useApplyProposalMutation,
  useDismissProposalMutation,
} from "@/features/inbox/use-dashboard-query";
import { proposalKeys } from "@/lib/query-keys";
import type { McpProposal } from "@/types/proposal";
import { Icon } from "@/components/ui/icons";

/**
 * Banner shown above the Roadmap horizon grid when there is at least one
 * pending MCP proposal targeting the current project (or the workspace).
 * Renders the most recent proposal and lets the user accept or dismiss it.
 */
export function RoadmapProposalBanner({ projectKey: _projectKey }: { projectKey: string }) {
  const workspaceId = useActiveWorkspaceId();

  const { data } = useQuery({
    queryKey: proposalKeys.pending(workspaceId ?? null),
    queryFn: () =>
      fetchApi<McpProposal[]>(
        `/api/workspaces/${workspaceId}/proposals?status=pending`,
      ),
    enabled: !!workspaceId,
    staleTime: 30_000,
  });

  const apply = useApplyProposalMutation(workspaceId ?? null, "roadmap");
  const dismiss = useDismissProposalMutation(workspaceId ?? null, "roadmap");

  const proposal = data?.[0];
  if (!proposal) return null;

  return (
    <div
      style={{
        margin: "10px 16px 0",
        padding: "10px 12px",
        background: "var(--ai-2)",
        border: "1px solid color-mix(in oklch, var(--ai) 22%, transparent)",
        borderRadius: 6,
        display: "flex",
        alignItems: "center",
        gap: 10,
      }}
    >
      <span
        style={{
          width: 22,
          height: 22,
          borderRadius: 4,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--ai)",
          color: "var(--btn-ink)",
          flexShrink: 0,
        }}
      >
        <Icon.Spark />
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ink)" }}>
          {proposal.title}
        </div>
        {proposal.reason && (
          <div
            style={{ fontSize: 11, color: "var(--ink-3)", marginTop: 2 }}
          >
            {proposal.reason}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={() => dismiss.mutate(proposal.id)}
        disabled={dismiss.isPending}
        style={{
          height: 24,
          padding: "0 10px",
          border: "1px solid var(--line-2)",
          borderRadius: 4,
          fontSize: 11,
          color: "var(--ink-2)",
          background: "var(--panel)",
          opacity: dismiss.isPending ? 0.55 : 1,
          cursor: dismiss.isPending ? "not-allowed" : "pointer",
        }}
      >
        Dismiss
      </button>
      <button
        type="button"
        onClick={() => apply.mutate(proposal.id)}
        disabled={apply.isPending}
        style={{
          height: 24,
          padding: "0 10px",
          borderRadius: 4,
          fontSize: 11,
          fontWeight: 500,
          background: "var(--ai)",
          color: "var(--btn-ink)",
          opacity: apply.isPending ? 0.55 : 1,
          cursor: apply.isPending ? "not-allowed" : "pointer",
        }}
      >
        Accept
      </button>
    </div>
  );
}
