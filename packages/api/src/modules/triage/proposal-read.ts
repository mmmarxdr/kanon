import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { calculateEffectiveState } from "./history-helper.js";
import { disposedTombstoneProjection } from "./retention.js";

async function assertProjectMember(userId: string, projectId: string, workspaceId: string) {
  const member = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true, role: true },
  });
  if (!member) {
    throw new AppError(404, "NOT_FOUND", "Proposal not found");
  }

  if (member.role === "owner" || member.role === "admin") {
    return member;
  }

  const projectMember = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId, projectId } },
    select: { id: true },
  });
  if (!projectMember) {
    // Permission-safe: do not leak existence to non-members
    throw new AppError(404, "NOT_FOUND", "Proposal not found");
  }
  return member;
}

/**
 * Authorized get for a triage proposal.
 * Disposed proposals return HTTP 410 tombstone metadata (no content).
 */
export async function getTriageProposal(userId: string, proposalId: string) {
  const proposal = await prisma.triageProposal.findUnique({
    where: { id: proposalId },
    include: {
      content: true,
      policy: { select: { id: true, version: true } },
    },
  });

  if (!proposal) {
    throw new AppError(404, "NOT_FOUND", "Proposal not found");
  }

  await assertProjectMember(userId, proposal.projectId, proposal.workspaceId);

  const effective = calculateEffectiveState(
    proposal.lifecycle,
    proposal.expiresAt,
  );

  if (proposal.lifecycle === "disposed" || proposal.disposedAt) {
    return {
      statusCode: 410 as const,
      body: disposedTombstoneProjection({
        id: proposal.id,
        lifecycle: "disposed",
        disposedAt: proposal.disposedAt,
        policyId: proposal.policyId,
        capturedPolicyVersion: proposal.capturedPolicyVersion,
        capturedRetentionDays: proposal.capturedRetentionDays,
        dispositionListVisible: proposal.dispositionListVisible,
        targetIssueId: proposal.targetIssueId,
      }),
    };
  }

  return {
    statusCode: 200 as const,
    body: {
      id: proposal.id,
      lifecycle: effective,
      listSummary: proposal.listSummary,
      createdAt: proposal.createdAt,
      expiresAt: proposal.expiresAt,
      targetIssueId: proposal.targetIssueId,
      projectId: proposal.projectId,
      workspaceId: proposal.workspaceId,
      policyId: proposal.policyId,
      capturedPolicyVersion: proposal.capturedPolicyVersion,
      capturedRetentionDays: proposal.capturedRetentionDays,
      retentionEligibleAt: proposal.retentionEligibleAt,
      content: proposal.content
        ? {
            payload: proposal.content.payload,
            provenance: proposal.content.provenance,
          }
        : null,
    },
  };
}
