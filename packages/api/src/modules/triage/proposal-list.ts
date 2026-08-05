import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { Prisma, TriageProposalLifecycleState } from "@prisma/client";
import { calculateEffectiveState } from "./history-helper.js";
import { disposedListDiscoveryAllowed } from "./retention.js";

export type ListStateFilter =
  | "current"
  | "expired"
  | "dismissed"
  | "disposed"
  | "all";

export interface ListTriageProposalsQuery {
  state?: ListStateFilter;
  limit?: number;
  targetIssueId?: string;
}

/**
 * Project-scoped compact list. Disposed rows appear only for explicit
 * `disposed`/`all` filters when dispositionListVisible was captured true.
 */
export async function listTriageProposals(
  userId: string,
  projectKey: string,
  query: ListTriageProposalsQuery = {},
) {
  const stateFilter: ListStateFilter = query.state ?? "current";
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));

  const project = await prisma.project.findFirst({
    where: { key: projectKey, archived: false },
    select: { id: true, workspaceId: true, key: true },
  });
  if (!project) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }

  const member = await prisma.member.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId: project.workspaceId },
    },
    select: { id: true, role: true },
  });
  if (!member) {
    throw new AppError(404, "NOT_FOUND", "Project not found");
  }
  if (member.role !== "owner" && member.role !== "admin") {
    const pm = await prisma.projectMember.findUnique({
      where: { userId_projectId: { userId, projectId: project.id } },
      select: { id: true },
    });
    if (!pm) {
      throw new AppError(404, "NOT_FOUND", "Project not found");
    }
  }

  const where: Prisma.TriageProposalWhereInput = {
    projectId: project.id,
  };
  if (query.targetIssueId) {
    where.targetIssueId = query.targetIssueId;
  }

  // Pre-filter at SQL where possible; disposed discovery gated after load.
  if (stateFilter === "current") {
    where.lifecycle = "pending";
    where.disposedAt = null;
    where.expiresAt = { gt: new Date() };
  } else if (stateFilter === "expired") {
    where.OR = [
      { lifecycle: "expired" },
      { lifecycle: "pending", expiresAt: { lte: new Date() } },
    ];
    where.disposedAt = null;
  } else if (stateFilter === "dismissed") {
    where.lifecycle = "dismissed";
    where.disposedAt = null;
  } else if (stateFilter === "disposed") {
    where.lifecycle = "disposed";
  }
  // "all" — no lifecycle prefilter

  const rows = await prisma.triageProposal.findMany({
    where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: limit + 1,
    select: {
      id: true,
      lifecycle: true,
      listSummary: true,
      createdAt: true,
      expiresAt: true,
      disposedAt: true,
      dispositionListVisible: true,
      targetIssueId: true,
      capturedPolicyVersion: true,
      capturedRetentionDays: true,
      policyId: true,
    },
  });

  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  const compact = page
    .map((row) => {
      const effective = calculateEffectiveState(row.lifecycle, row.expiresAt);
      const isDisposed = row.lifecycle === "disposed" || row.disposedAt !== null;

      if (isDisposed) {
        if (!disposedListDiscoveryAllowed(stateFilter, row.dispositionListVisible)) {
          return null;
        }
        return {
          id: row.id,
          lifecycle: "disposed" as const,
          disposedAt: row.disposedAt,
          createdAt: row.createdAt,
          targetIssueId: row.targetIssueId,
          dispositionListVisible: true,
          retentionPolicy: {
            id: row.policyId,
            version: row.capturedPolicyVersion,
            retentionDays: row.capturedRetentionDays,
          },
        };
      }

      if (stateFilter === "current" && effective !== "pending") {
        return null;
      }
      if (stateFilter === "expired" && effective !== "expired") {
        return null;
      }

      return {
        id: row.id,
        lifecycle: effective as TriageProposalLifecycleState,
        listSummary: row.listSummary,
        createdAt: row.createdAt,
        expiresAt: row.expiresAt,
        targetIssueId: row.targetIssueId,
      };
    })
    .filter((r): r is NonNullable<typeof r> => r !== null);

  return {
    rows: compact,
    count: compact.length,
    hasMore,
  };
}
