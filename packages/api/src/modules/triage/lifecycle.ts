import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/types.js";

function isSerializationConflict(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError)) return false;
  const meta = error.meta && typeof error.meta === "object"
    ? error.meta as { code?: unknown }
    : {};
  return error.code === "P2034" || (error.code === "P2010" && meta.code === "40001");
}

export async function dismissTriageProposal(
  proposalId: string,
  actorId: string,
  reason?: string,
  details?: { correlationId?: string; client?: string | null },
) {
  let retries = 3;
  while (retries > 0) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`SELECT "id" FROM "triage_proposals" WHERE "id" = ${proposalId}::uuid FOR UPDATE`;
          const [clock] = await tx.$queryRaw<[{ now: Date }]>`SELECT CURRENT_TIMESTAMP AS "now"`;
          const proposal = await tx.triageProposal.findUnique({
            where: { id: proposalId },
            select: { lifecycle: true, expiresAt: true, disposedAt: true, id: true }
          });

          if (!proposal) {
            throw new AppError(404, "NOT_FOUND", "Proposal not found");
          }

          if (proposal.disposedAt || proposal.lifecycle === "disposed") {
            throw new AppError(409, "INVALID_STATE", "Cannot dismiss a disposed proposal");
          }

          if (proposal.lifecycle === "dismissed") {
            // Terminal idempotency
            const event = await tx.triageProposalLifecycleEvent.findFirst({
              where: { proposalId, state: "dismissed" }
            });
            return { proposal, event };
          }

          if (proposal.lifecycle === "expired" || proposal.expiresAt <= clock.now) {
            if (proposal.lifecycle !== "expired") {
              await tx.triageProposal.update({
                where: { id: proposalId },
                data: { lifecycle: "expired" },
              });
              await tx.triageProposalLifecycleEvent.create({
                data: { proposalId, state: "expired", actorId: null },
              });
            }
            return { expired: true as const };
          }

          const updatedProposal = await tx.triageProposal.update({
            where: { id: proposalId },
            data: { lifecycle: "dismissed" }
          });

          const event = await tx.triageProposalLifecycleEvent.create({
            data: {
              proposalId,
              state: "dismissed",
              actorId,
              reason,
              details: details ?? undefined,
            }
          });

          return { proposal: updatedProposal, event };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      ).then((result) => {
        if ("expired" in result) {
          throw new AppError(409, "INVALID_STATE", "Cannot dismiss an expired proposal");
        }
        return result;
      });
    } catch (err) {
      if (isSerializationConflict(err)) {
        retries--;
        if (retries === 0) {
          throw new AppError(503, "CONCURRENCY_ERROR", "Proposal dismissal could not be serialized");
        }
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      throw err;
    }
  }

  throw new AppError(409, "CONCURRENCY_ERROR", "Transaction failed due to concurrent update");
}
