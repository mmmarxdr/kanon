export type McpProposalKind =
  | "promote_roadmap_item"
  | "add_dependency"
  | "split_issue"
  | "reassign"
  | "generic";

export type McpProposalStatus = "pending" | "applied" | "dismissed";

export interface McpProposal {
  id: string;
  kind: McpProposalKind;
  status: McpProposalStatus;
  title: string;
  reason: string | null;
  targetRef: string | null;
  payload: unknown;
  generatedBy: string | null;
  proposedAt: string;
  appliedAt: string | null;
  dismissedAt: string | null;
  workspaceId: string;
  projectId: string | null;
}
