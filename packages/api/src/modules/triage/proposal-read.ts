import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { Prisma } from "@prisma/client";
import { calculateEffectiveState } from "./history-helper.js";
import { disposedTombstoneProjection } from "./retention.js";

function retainedCandidates(provenance: unknown): Array<{ issueId: string; issueKey: string }> {
  if (!provenance || typeof provenance !== "object" || Array.isArray(provenance)) return [];
  const value = provenance as Record<string, unknown>;
  const retained = new Set(Array.isArray(value["retainedCandidateIds"])
    ? value["retainedCandidateIds"].filter((id): id is string => typeof id === "string")
    : []);
  const preview = objectValue(value["preview"]);
  return Array.isArray(preview?.["candidates"])
    ? preview["candidates"].flatMap((candidate) => {
        const row = objectValue(candidate);
        return typeof row?.["issueId"] === "string" && typeof row["issueKey"] === "string" && retained.has(row["issueId"])
          ? [{ issueId: row["issueId"], issueKey: row["issueKey"] }]
          : [];
      })
    : [];
}

export function withoutCandidateCount(summary: unknown): unknown {
  if (!summary || typeof summary !== "object" || Array.isArray(summary)) return summary;
  const sanitized = { ...summary as Record<string, unknown> };
  delete sanitized["candidateCount"];
  return sanitized;
}

export function redactedSummary(summary: unknown): unknown {
  const sanitized = withoutCandidateCount(summary);
  if (!sanitized || typeof sanitized !== "object" || Array.isArray(sanitized)) return sanitized;
  for (const field of ["recommendationCount", "actionKinds", "generatorSource", "model", "confidenceBands"]) {
    delete (sanitized as Record<string, unknown>)[field];
  }
  return sanitized;
}

function objectValue(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function redactCandidateData(value: unknown, hiddenRefs: ReadonlySet<string>): unknown {
  const cloned = structuredClone(value);
  const content = objectValue(cloned);
  if (!content) return cloned;

  const payload = objectValue(content["payload"]);
  const normalizedPayload = objectValue(payload?.["normalizedPayload"]);
  if (normalizedPayload && Array.isArray(normalizedPayload["candidateIds"])) {
    normalizedPayload["candidateIds"] = normalizedPayload["candidateIds"].filter(
      (id) => typeof id !== "string" || !hiddenRefs.has(id),
    );
  }

  const provenance = objectValue(content["provenance"]);
  if (!provenance) return content;
  for (const field of ["retainedCandidateIds", "retainedItemIds"] as const) {
    if (Array.isArray(provenance[field])) {
      provenance[field] = provenance[field].filter(
        (id) => typeof id !== "string" || !hiddenRefs.has(id),
      );
    }
  }

  for (const sourceProvenance of [provenance, objectValue(payload?.["provenance"])]) {
    const sourceSnapshots = objectValue(sourceProvenance?.["sourceSnapshots"]);
    if (sourceSnapshots && Array.isArray(sourceSnapshots["candidates"])) {
      sourceSnapshots["candidates"] = sourceSnapshots["candidates"].filter((entry) => {
        const snapshot = objectValue(objectValue(entry)?.["snapshot"]);
        return !snapshot || ![snapshot["issueId"], snapshot["issueKey"]].some(
          (ref) => typeof ref === "string" && hiddenRefs.has(ref),
        );
      });
    }
  }

  const preview = objectValue(provenance["preview"]);
  if (!preview) return content;
  const hidesEvidence = (item: unknown) => {
    const evidence = objectValue(item);
    const ref = evidence?.["evidenceRefId"];
    return typeof ref === "string" && [...hiddenRefs].some((hidden) => ref.includes(hidden));
  };
  if (Array.isArray(preview["candidates"])) {
    preview["candidates"] = preview["candidates"].filter((candidate) => {
      const row = objectValue(candidate);
      return !row || ![row["issueId"], row["issueKey"]].some(
        (ref) => typeof ref === "string" && hiddenRefs.has(ref),
      );
    }).map((candidate, index) => ({ ...objectValue(candidate), rank: index + 1 }));
  }
  if (Array.isArray(preview["evidence"])) {
    preview["evidence"] = preview["evidence"].filter((evidence) => !hidesEvidence(evidence));
  }
  if (Array.isArray(preview["recommendations"])) {
    const hiddenItemIds = new Set<string>();
    const visibleRecommendations = preview["recommendations"].filter((recommendation) => {
      const item = objectValue(recommendation);
      const hidden = Array.isArray(item?.["evidence"]) && item["evidence"].some(hidesEvidence);
      if (hidden) {
        if (typeof item?.["itemId"] === "string") hiddenItemIds.add(item["itemId"]);
      }
      return !hidden;
    });
    preview["recommendations"] = visibleRecommendations;
    if (normalizedPayload && Array.isArray(normalizedPayload["actions"])) {
      normalizedPayload["actions"] = visibleRecommendations.flatMap((recommendation) => {
        const item = objectValue(recommendation);
        return item?.["state"] === "supported" && item["normalized"] !== undefined
          ? [item["normalized"]]
          : [];
      });
    }
    if (Array.isArray(provenance["retainedItemIds"])) {
      provenance["retainedItemIds"] = provenance["retainedItemIds"].filter(
        (id) => typeof id !== "string" || !hiddenItemIds.has(id),
      );
    }
    for (const field of ["conflicts", "unknowns"] as const) {
      if (Array.isArray(preview[field])) {
        preview[field] = preview[field].filter(
          (id) => typeof id !== "string" || (!hiddenRefs.has(id) && !hiddenItemIds.has(id)),
        );
      }
    }
  }
  return content;
}

async function assertProjectMember(
  database: Prisma.TransactionClient,
  userId: string,
  projectId: string,
  workspaceId: string,
  allowedProjectIds: readonly string[] | undefined,
) {
  if (allowedProjectIds && !allowedProjectIds.includes(projectId)) {
    throw new AppError(404, "NOT_FOUND", "Proposal not found");
  }
  const member = await database.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true, role: true, projectAccess: true },
  });
  if (!member) {
    throw new AppError(404, "NOT_FOUND", "Proposal not found");
  }

  if (member.role === "owner" || member.role === "admin" || member.projectAccess === "workspace") {
    return member;
  }

  const projectMember = await database.projectMember.findUnique({
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
async function getTriageProposalSnapshot(
  tx: Prisma.TransactionClient,
  userId: string,
  proposalId: string,
  allowedProjectIds: readonly string[] | undefined,
  format: "compact" | "full",
) {
  const proposal = await tx.triageProposal.findUnique({
    where: { id: proposalId },
    include: {
      content: true,
      policy: { select: { id: true, version: true } },
    },
  });

  if (!proposal) {
    throw new AppError(404, "NOT_FOUND", "Proposal not found");
  }

  await assertProjectMember(tx, userId, proposal.projectId, proposal.workspaceId, allowedProjectIds);
  const visibleTarget = await tx.issue.findFirst({
    where: { id: proposal.targetIssueId, projectId: proposal.projectId },
    select: { id: true },
  });
  if (!visibleTarget) throw new AppError(404, "NOT_FOUND", "Proposal not found");

  const [successor, predecessor] = await Promise.all([
    tx.triageProposal.findFirst({
      where: { supersedesId: proposal.id },
      select: { id: true, lifecycle: true, disposedAt: true, dispositionListVisible: true },
    }),
    proposal.supersedesId
      ? tx.triageProposal.findUnique({
          where: { id: proposal.supersedesId },
          select: { id: true, lifecycle: true, disposedAt: true, dispositionListVisible: true },
        })
      : null,
  ]);
  const visibleRelation = (related: NonNullable<typeof successor>) =>
    (related.lifecycle !== "disposed" && related.disposedAt === null) || related.dispositionListVisible === true;

  const effective = calculateEffectiveState(
    proposal.lifecycle,
    proposal.expiresAt,
    new Date(),
    !!successor,
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

  const hiddenCandidateRefs = new Set<string>();
  if (proposal.content) {
    const storedCandidates = retainedCandidates(proposal.content.provenance);
    const candidates = await tx.issue.findMany({
      where: { id: { in: storedCandidates.map(({ issueId }) => issueId) } },
      select: { id: true, key: true, projectId: true, project: { select: { workspaceId: true } } },
    });
    const byId = new Map(candidates.map((candidate) => [candidate.id, candidate]));
    const [members, projectMembers] = await Promise.all([
      tx.member.findMany({
        where: { userId, workspaceId: { in: [...new Set(candidates.map(({ project }) => project.workspaceId))] } },
        select: { workspaceId: true, role: true, projectAccess: true },
      }),
      tx.projectMember.findMany({
        where: { userId, projectId: { in: [...new Set(candidates.map(({ projectId }) => projectId))] } },
        select: { projectId: true },
      }),
    ]);
    const memberByWorkspace = new Map(members.map((member) => [member.workspaceId, member]));
    const memberProjects = new Set(projectMembers.map(({ projectId }) => projectId));
    for (const stored of storedCandidates) {
      const candidate = byId.get(stored.issueId);
      const member = candidate ? memberByWorkspace.get(candidate.project.workspaceId) : null;
      const visible = candidate && (!allowedProjectIds || allowedProjectIds.includes(candidate.projectId)) && member && (
        member.role === "owner" || member.role === "admin" || member.projectAccess === "workspace" ||
        memberProjects.has(candidate.projectId)
      );
      if (!visible) {
        hiddenCandidateRefs.add(stored.issueId);
        hiddenCandidateRefs.add(stored.issueKey);
        if (candidate) hiddenCandidateRefs.add(candidate.key);
      }
    }
  }
  const fullContentVisible = format === "full" && proposal.content !== null;

  return {
    statusCode: 200 as const,
    body: {
      id: proposal.id,
      lifecycle: effective,
      current: effective === "current",
      supersedesId: predecessor && visibleRelation(predecessor) ? predecessor.id : null,
      successorId: successor && visibleRelation(successor) ? successor.id : null,
      listSummary: hiddenCandidateRefs.size === 0
        ? proposal.listSummary
        : redactedSummary(proposal.listSummary),
      createdAt: proposal.createdAt,
      expiresAt: proposal.expiresAt,
      targetIssueId: proposal.targetIssueId,
      projectId: proposal.projectId,
      workspaceId: proposal.workspaceId,
      policyId: proposal.policyId,
      capturedPolicyVersion: proposal.capturedPolicyVersion,
      capturedRetentionDays: proposal.capturedRetentionDays,
      retentionEligibleAt: proposal.retentionEligibleAt,
      content: fullContentVisible && proposal.content
        ? redactCandidateData({
            payload: proposal.content.payload,
            provenance: proposal.content.provenance,
          }, hiddenCandidateRefs)
        : null,
    },
  };
}

export async function getTriageProposal(
  userId: string,
  proposalId: string,
  allowedProjectIds: readonly string[] | undefined = undefined,
  format: "compact" | "full" = "full",
) {
  return prisma.$transaction(
    (tx) => getTriageProposalSnapshot(tx, userId, proposalId, allowedProjectIds, format),
    { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead },
  );
}
