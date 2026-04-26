import type { McpProposal } from "@/types/proposal";
import { Icon } from "@/components/ui/icons";

interface ProposalRowProps {
  proposal: McpProposal;
  onApply: (id: string) => void;
  onDismiss: (id: string) => void;
  isPending?: boolean;
}

export function ProposalRow({
  proposal,
  onApply,
  onDismiss,
  isPending,
}: ProposalRowProps) {
  const applied = proposal.status === "applied";
  const dismissed = proposal.status === "dismissed";
  const inactive = applied || dismissed;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "10px 12px",
        background: inactive ? "var(--bg-2)" : "var(--ai-2)",
        border: `1px solid ${
          inactive
            ? "var(--line)"
            : "color-mix(in oklch, var(--ai) 22%, transparent)"
        }`,
        borderRadius: 5,
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
          background: applied ? "var(--ok)" : dismissed ? "var(--ink-3)" : "var(--ai)",
          color: "var(--btn-ink)",
          flexShrink: 0,
        }}
      >
        {applied ? <Icon.Check /> : <Icon.Spark />}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--ink)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {proposal.title}
        </div>
        {proposal.reason && (
          <div
            style={{
              fontSize: 11,
              color: "var(--ink-3)",
              marginTop: 1,
            }}
          >
            {proposal.reason}
          </div>
        )}
      </div>
      {applied && (
        <span className="mono" style={{ fontSize: 10.5, color: "var(--ok)" }}>
          APPLIED
        </span>
      )}
      {dismissed && (
        <span
          className="mono"
          style={{ fontSize: 10.5, color: "var(--ink-4)" }}
        >
          DISMISSED
        </span>
      )}
      {!inactive && (
        <>
          <button
            type="button"
            onClick={() => onDismiss(proposal.id)}
            disabled={isPending}
            style={{
              height: 22,
              padding: "0 10px",
              fontSize: 11,
              color: "var(--ink-3)",
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.55 : 1,
            }}
          >
            Skip
          </button>
          <button
            type="button"
            onClick={() => onApply(proposal.id)}
            disabled={isPending}
            style={{
              height: 22,
              padding: "0 10px",
              fontSize: 11,
              fontWeight: 500,
              background: "var(--ai)",
              color: "var(--btn-ink)",
              borderRadius: 3,
              cursor: isPending ? "not-allowed" : "pointer",
              opacity: isPending ? 0.55 : 1,
            }}
          >
            Apply
          </button>
        </>
      )}
    </div>
  );
}
