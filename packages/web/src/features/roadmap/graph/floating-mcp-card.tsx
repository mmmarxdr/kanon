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
 * Floating MCP suggestion card pinned to the bottom-left of the graph canvas.
 * Surfaces the most recent pending proposal (preferring kinds related to
 * dependencies) and provides Skip / Apply actions.
 */
export function FloatingMcpCard() {
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

  // Prefer dependency-related kinds, fall back to anything pending.
  const proposal =
    data?.find(
      (p) => p.kind === "add_dependency" || p.kind === "promote_roadmap_item",
    ) ?? data?.[0];
  if (!proposal) return null;

  return (
    <div
      style={{
        position: "absolute",
        left: 20,
        bottom: 20,
        width: 280,
        padding: 12,
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: 8,
        boxShadow: "0 8px 24px color-mix(in oklch, black 18%, transparent)",
        zIndex: 4,
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 6,
        }}
      >
        <span
          style={{
            width: 18,
            height: 18,
            borderRadius: 3,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            background: "var(--ai)",
            color: "var(--btn-ink)",
          }}
        >
          <Icon.Spark />
        </span>
        <span style={{ fontSize: 11, fontWeight: 500 }}>MCP suggestion</span>
        <span style={{ flex: 1 }} />
        <span
          className="mono"
          style={{ fontSize: 9, color: "var(--ink-4)" }}
        >
          {data && data.length > 0
            ? `1 of ${data.length}`
            : ""}
        </span>
      </div>
      <div
        style={{
          fontSize: 11.5,
          color: "var(--ink-2)",
          lineHeight: 1.45,
        }}
      >
        {proposal.title}
      </div>
      {proposal.reason && (
        <div
          style={{
            fontSize: 11,
            color: "var(--ink-4)",
            marginTop: 4,
            lineHeight: 1.4,
          }}
        >
          {proposal.reason}
        </div>
      )}
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button
          type="button"
          onClick={() => dismiss.mutate(proposal.id)}
          disabled={dismiss.isPending}
          style={{
            flex: 1,
            height: 24,
            borderRadius: 4,
            border: "1px solid var(--line-2)",
            fontSize: 11,
            color: "var(--ink-2)",
            background: "var(--panel)",
            opacity: dismiss.isPending ? 0.55 : 1,
            cursor: dismiss.isPending ? "not-allowed" : "pointer",
          }}
        >
          Skip
        </button>
        <button
          type="button"
          onClick={() => apply.mutate(proposal.id)}
          disabled={apply.isPending}
          style={{
            flex: 1,
            height: 24,
            borderRadius: 4,
            fontSize: 11,
            fontWeight: 500,
            background: "var(--ai)",
            color: "var(--btn-ink)",
            opacity: apply.isPending ? 0.55 : 1,
            cursor: apply.isPending ? "not-allowed" : "pointer",
          }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}
