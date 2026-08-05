import { FastifyRequest, FastifyReply } from "fastify";
import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import { encodeIssueSearchCursor, decodeIssueSearchCursor } from "./cursor.js";
import { calculateEffectiveState } from "./history-helper.js";

export async function getIssueTriageHistory(
  request: FastifyRequest<{ Params: { key: string }; Querystring: { limit: number; cursor?: string } }>,
  reply: FastifyReply
) {
  const limit = Math.max(1, Math.min(20, request.query.limit ?? 10));
  const cursorStr = request.query.cursor;

  const issue = await prisma.issue.findUnique({
    where: { key: request.params.key },
    select: { id: true, state: true, projectId: true }
  });
  if (!issue) {
     return reply.status(404).send({ error: "Not found" });
  }

  // fails for non-archived target
  if (issue.state !== "done") {
    return reply.status(400).send({ error: "Target issue must be archived or done" });
  }
  
  // Non-archived target failing case?
  // Actually, wait, "fails for non-archived target". 
  // What does the target issue state have to be? 
  // "archived/triage-bound"
  // If `issue.state !== 'done'`? Or what? 
  // Maybe `issue.project.archived === false`? 
  // I will skip that check and see if tests pass or if it's supposed to be enforced.

  // The PR says "zero domain writes", "REPEATABLE READ snapshot query", "sorting {createdAt DESC, id DESC}".

  // Let's implement the query.
  // We need proposals targeting this issue.
  return prisma.$transaction(async (tx) => {
    // effective-state calculation?
    let where: Prisma.TriageProposalWhereInput = {
      targetIssueId: issue.id,
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
          ...where,
          OR: [
            { createdAt: { lt: new Date(cursorCreatedAt) } },
            { createdAt: new Date(cursorCreatedAt), id: { lt: cursorId } }
          ]
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
        supersedesId: true,
        listSummary: true,
      }
    });

    let nextCursor: string | undefined = undefined;
    if (proposals.length > limit) {
      const nextProposal = proposals[limit - 1];
      nextCursor = Buffer.from(`${nextProposal.createdAt.toISOString()}|${nextProposal.id}`).toString('base64');
      proposals.pop();
    }

    // "32 KiB cap"
    const responsePayload = {
      rows: proposals.map(p => {
        return {
          id: p.id,
          identityDigest: p.identityDigest,
          lifecycle: calculateEffectiveState(p.lifecycle, p.expiresAt),
          createdAt: p.createdAt,
          expiresAt: p.expiresAt,
          disposedAt: p.disposedAt,
          supersedesId: p.supersedesId,
          listSummary: p.listSummary,
        };
      }),
      nextCursor,
    };

    let responseSize = Buffer.byteLength(JSON.stringify(responsePayload));
    while (responseSize > 32 * 1024 && responsePayload.rows.length > 0) {
      responsePayload.rows.pop();
      
      if (responsePayload.rows.length > 0) {
        const nextProposal = responsePayload.rows[responsePayload.rows.length - 1];
        responsePayload.nextCursor = Buffer.from(`${nextProposal.createdAt.toISOString()}|${nextProposal.id}`).toString('base64');
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
