import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import { encodeIssueSearchCursor, decodeIssueSearchCursor } from "./cursor.js";
import { calculateEffectiveState } from "./history-helper.js";
import { redactedSummary } from "./proposal-read.js";
import { disposedTombstoneProjection } from "./retention.js";

export async function getIssueTriageHistory(
  request: FastifyRequest,
  reply: FastifyReply,
) {
  const params = request.params as { key: string };
  const query = request.query as { limit?: number; cursor?: string };
  const limit = Math.max(1, Math.min(20, query.limit ?? 10));
  const cursorStr = query.cursor;

  return prisma.$transaction(async (tx) => {
    const user = request.user;
    if (!user) return reply.status(401).send({ error: "Unauthorized" });
    const issue = await tx.issue.findUnique({
      where: { key: params.key },
      select: { id: true, state: true, projectId: true, project: { select: { workspaceId: true } } },
    });
    if (!issue || (user.allowedProjectIds && !user.allowedProjectIds.includes(issue.projectId))) {
      return reply.status(404).send({ error: "Not found" });
    }
    if (issue.state !== "done") {
      return reply.status(400).send({ error: "Target issue must be archived or done" });
    }
    const [member, projectMember] = await Promise.all([
      tx.member.findUnique({
        where: { userId_workspaceId: { userId: user.userId, workspaceId: issue.project.workspaceId } },
        select: { role: true, projectAccess: true },
      }),
      tx.projectMember.findUnique({
        where: { userId_projectId: { userId: user.userId, projectId: issue.projectId } },
        select: { id: true },
      }),
    ]);
    if (!member || (
      member.role !== "owner" && member.role !== "admin" &&
      member.projectAccess !== "workspace" && !projectMember
    )) {
      return reply.status(404).send({ error: "Not found" });
    }

    let where: Prisma.TriageProposalWhereInput = {
      targetIssueId: issue.id,
      OR: [{ disposedAt: null }, { dispositionListVisible: true }],
    };

    if (cursorStr) {
      try {
        const decoded = Buffer.from(cursorStr, 'base64').toString('utf8');
        const parts = decoded.split('|');
        if (parts.length !== 2) throw new Error("Invalid cursor format");
        const cursorCreatedAt = parts[0];
        const cursorId = parts[1];
        
        if (!cursorCreatedAt || !cursorId || isNaN(new Date(cursorCreatedAt).getTime())) {
          throw new Error("Invalid cursor content");
        }
        
        where = {
          targetIssueId: issue.id,
          AND: [
            { OR: [{ disposedAt: null }, { dispositionListVisible: true }] },
            { OR: [
              { createdAt: { lt: new Date(cursorCreatedAt) } },
              { createdAt: new Date(cursorCreatedAt), id: { lt: cursorId } },
            ] },
          ],
        };
      } catch (e) {
        return reply.status(400).send({ error: "Invalid cursor" });
      }
    }

    const proposals = await tx.triageProposal.findMany({
      where,
      orderBy: [
        { createdAt: 'desc' },
        { id: 'desc' },
      ],
      take: limit + 1,
      select: {
        id: true,
        identityDigest: true,
        lifecycle: true,
        createdAt: true,
        expiresAt: true,
        disposedAt: true,
        dispositionListVisible: true,
        supersedesId: true,
        listSummary: true,
        policyId: true,
        capturedPolicyVersion: true,
        capturedRetentionDays: true,
        targetIssueId: true,
      }
    });
    const successorRows = await tx.triageProposal.findMany({
      where: { supersedesId: { in: proposals.map((proposal) => proposal.id) } },
      select: { supersedesId: true },
    });
    const supersededIds = new Set(successorRows.flatMap((row) => row.supersedesId ? [row.supersedesId] : []));
    const visiblePredecessors = await tx.triageProposal.findMany({
      where: {
        id: { in: proposals.flatMap((proposal) => proposal.supersedesId ? [proposal.supersedesId] : []) },
        OR: [{ disposedAt: null }, { dispositionListVisible: true }],
      },
      select: { id: true },
    });
    const visiblePredecessorIds = new Set(visiblePredecessors.map(({ id }) => id));

    let nextCursor: string | undefined = undefined;
    if (proposals.length > limit) {
      const nextProposal = proposals[limit - 1];
      if (nextProposal) {
        nextCursor = Buffer.from(`${nextProposal.createdAt.toISOString()}|${nextProposal.id}`).toString("base64");
      }
      proposals.pop();
    }

    // "32 KiB cap"
    const responsePayload = {
      rows: proposals.map(p => {
        if (p.lifecycle === "disposed" || p.disposedAt) {
          return {
            ...disposedTombstoneProjection({
              id: p.id,
              lifecycle: "disposed",
              disposedAt: p.disposedAt,
              policyId: p.policyId,
              capturedPolicyVersion: p.capturedPolicyVersion,
              capturedRetentionDays: p.capturedRetentionDays,
              dispositionListVisible: p.dispositionListVisible,
              targetIssueId: p.targetIssueId,
            }),
            createdAt: p.createdAt,
          };
        }
        return {
          id: p.id,
          identityDigest: p.identityDigest,
          lifecycle: calculateEffectiveState(p.lifecycle, p.expiresAt, new Date(), supersededIds.has(p.id)),
          createdAt: p.createdAt,
          expiresAt: p.expiresAt,
          disposedAt: p.disposedAt,
          supersedesId: p.supersedesId && visiblePredecessorIds.has(p.supersedesId) ? p.supersedesId : null,
          listSummary: redactedSummary(p.listSummary),
        };
      }),
      nextCursor,
    };

    let responseSize = Buffer.byteLength(JSON.stringify(responsePayload));
    while (responseSize > 32 * 1024 && responsePayload.rows.length > 0) {
      responsePayload.rows.pop();
      
      if (responsePayload.rows.length > 0) {
        const nextProposal = responsePayload.rows[responsePayload.rows.length - 1];
        if (nextProposal) {
          responsePayload.nextCursor = Buffer.from(
            `${nextProposal.createdAt.toISOString()}|${nextProposal.id}`,
          ).toString("base64");
        } else {
          responsePayload.nextCursor = undefined;
        }
      } else {
        responsePayload.nextCursor = undefined;
      }
      
      responseSize = Buffer.byteLength(JSON.stringify(responsePayload));
    }

    return reply.status(200).send(responsePayload);
  }, {
    isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead,
  });
}
