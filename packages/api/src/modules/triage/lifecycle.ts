import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import { AppError } from "../../shared/types.js";

export async function dismissTriageProposal(
  proposalId: string,
  actorId: string,
  reason?: string
) {
  let retries = 3;
  while (retries > 0) {
    try {
      // 1. Pre-check for lazy expiry or state checks
      const checkProposal = await prisma.triageProposal.findUnique({
        where: { id: proposalId },
        select: { lifecycle: true, expiresAt: true, disposedAt: true, id: true }
      });

      if (!checkProposal) {
        throw new AppError(404, "NOT_FOUND", "Proposal not found");
      }

      if (checkProposal.disposedAt || checkProposal.lifecycle === "disposed") {
        throw new AppError(409, "INVALID_STATE", "Cannot dismiss a disposed proposal");
      }

      const now = new Date();
      if (checkProposal.lifecycle === "expired" || checkProposal.expiresAt < now) {
        if (checkProposal.lifecycle !== "expired") {
          // Commit lazy expiry transition
          await prisma.triageProposal.update({
            where: { id: proposalId },
            data: { lifecycle: "expired" }
          });
          await prisma.triageProposalLifecycleEvent.create({
            data: {
              proposalId,
              state: 'expired',
              actorId: null // System transition
            }
          });
        }
        throw new AppError(409, "INVALID_STATE", "Cannot dismiss an expired proposal");
      }

      return await prisma.$transaction(
        async (tx) => {
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

          const updatedProposal = await tx.triageProposal.update({
            where: { id: proposalId },
            data: { lifecycle: "dismissed" }
          });

          const event = await tx.triageProposalLifecycleEvent.create({
            data: {
              proposalId,
              state: "dismissed",
              actorId,
              reason
            }
          });

          return { proposal: updatedProposal, event };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }
      );
    } catch (err: any) {
      if (err.code === "P2034" && retries > 1) {
        retries--;
        await new Promise((r) => setTimeout(r, 50));
        continue;
      }
      throw err;
    }
  }

  throw new AppError(409, "CONCURRENCY_ERROR", "Transaction failed due to concurrent update");
}
