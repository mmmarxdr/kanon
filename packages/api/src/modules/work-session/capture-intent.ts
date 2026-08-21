import { randomUUID } from "node:crypto";
import { Prisma, type WorkCaptureIntent } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { supersedeWorkCaptureFailuresTx } from "./capture-intent-failure.js";

export interface WorkCaptureIntentFence {
  epoch: string;
  leaseGeneration: number;
}

export async function listPrincipalCaptureIntents(
  input: {
    userId: string;
    workspaceId: string;
    allowedProjectIds?: string[] | null;
    cursor?: string;
    limit: number;
  },
  database: Pick<typeof prisma, "workCaptureIntent"> = prisma
): Promise<{
  intents: Array<{
    issueKey: string;
    epoch: string;
    leaseGeneration: number;
    state: "adopted" | "capturing" | "paused" | "closing";
  }>;
  nextCursor: string | null;
}> {
  const rows = await database.workCaptureIntent.findMany({
    where: {
      userId: input.userId,
      state: { not: "closed" },
      ...(input.cursor ? { id: { gt: input.cursor } } : {}),
      issue: {
        project: {
          workspaceId: input.workspaceId,
          ...(input.allowedProjectIds && input.allowedProjectIds.length > 0
            ? { id: { in: input.allowedProjectIds } }
            : {}),
        },
      },
    },
    select: {
      id: true,
      epoch: true,
      leaseGeneration: true,
      state: true,
      issue: { select: { key: true } },
    },
    orderBy: { id: "asc" },
    take: input.limit + 1,
  });
  const visible = rows.slice(0, input.limit);
  return {
    intents: visible.map((row) => ({
      issueKey: row.issue.key,
      epoch: row.epoch,
      leaseGeneration: row.leaseGeneration,
      state: row.state as "adopted" | "capturing" | "paused" | "closing",
    })),
    nextCursor: rows.length > input.limit ? (visible.at(-1)?.id ?? null) : null,
  };
}

export async function materializeCaptureIntentTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    issueId: string;
    identity?: { memberId: string; source: string };
    existingSession: boolean;
    explicitStart: boolean;
  }
): Promise<WorkCaptureIntent | null> {
  const existing = await tx.workCaptureIntent.findUnique({
    where: { userId_issueId: { userId: input.userId, issueId: input.issueId } },
  });

  if (!input.identity) return existing;

  if (existing?.state === "closing") {
    throw new AppError(409, "CAPTURE_CLOSING", "Capture intent is closing");
  }

  if (existing?.state === "closed") {
    if (!input.explicitStart) {
      throw new AppError(
        409,
        "CAPTURE_CLOSED",
        "Capture intent is closed; start work to begin a new lifecycle"
      );
    }
    await supersedeWorkCaptureFailuresTx(tx, { id: existing.id });
    return tx.workCaptureIntent.update({
      where: { id: existing.id },
      data: {
        epoch: randomUUID(),
        state: "capturing",
        leaseGeneration: 1,
        memberId: input.identity.memberId,
        source: input.identity.source,
        closedAt: null,
        pendingEffectKind: null,
        pendingEffectAt: null,
        pendingEffectCommandId: null,
      },
    });
  }

  if (existing?.state === "paused" && !input.explicitStart) {
    throw new AppError(409, "CAPTURE_PAUSED", "Capture is paused by an open interruption");
  }

  if (!existing) {
    return tx.workCaptureIntent.create({
      data: {
        userId: input.userId,
        issueId: input.issueId,
        memberId: input.identity.memberId,
        source: input.identity.source,
        state: "capturing",
        leaseGeneration: 1,
      },
    });
  }

  await supersedeWorkCaptureFailuresTx(tx, { id: existing.id });
  return tx.workCaptureIntent.update({
    where: { id: existing.id },
    data: {
      state: "capturing",
      memberId: input.identity.memberId,
      source: input.identity.source,
      closedAt: null,
      pendingEffectKind: null,
      pendingEffectAt: null,
      pendingEffectCommandId: null,
      ...(!input.existingSession ? { leaseGeneration: { increment: 1 } } : {}),
    },
  });
}

export async function pauseCaptureIntentTx(
  tx: Prisma.TransactionClient,
  input: { userId?: string; issueId: string; memberId: string }
): Promise<void> {
  const pendingActivityWhere: Prisma.WorkCaptureIntentWhereInput = {
    ...(input.userId ? { userId: input.userId } : {}),
    issueId: input.issueId,
    memberId: input.memberId,
    state: { in: ["adopted", "capturing"] },
    pendingEffectKind: "activity",
  };
  await supersedeWorkCaptureFailuresTx(tx, pendingActivityWhere);
  await tx.workCaptureIntent.updateMany({
    where: pendingActivityWhere,
    data: {
      state: "paused",
      closedAt: null,
      pendingEffectKind: null,
      pendingEffectAt: null,
      pendingEffectCommandId: null,
    },
  });
  await tx.workCaptureIntent.updateMany({
    where: {
      ...(input.userId ? { userId: input.userId } : {}),
      issueId: input.issueId,
      memberId: input.memberId,
      state: { in: ["adopted", "capturing"] },
    },
    data: { state: "paused", closedAt: null },
  });
}

export async function closeCaptureIntentTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    issueId: string;
    closedAt: Date;
    expected?: WorkCaptureIntentFence;
  }
): Promise<WorkCaptureIntent | null> {
  const existing = await tx.workCaptureIntent.findUnique({
    where: { userId_issueId: { userId: input.userId, issueId: input.issueId } },
  });
  if (!existing) return null;
  if (
    input.expected &&
    (existing.epoch !== input.expected.epoch ||
      existing.leaseGeneration !== input.expected.leaseGeneration)
  ) {
    return null;
  }
  if (existing.state === "closed") return existing;
  await supersedeWorkCaptureFailuresTx(tx, { id: existing.id });
  return tx.workCaptureIntent.update({
    where: { id: existing.id },
    data: {
      state: "closed",
      closedAt: input.closedAt,
      pendingEffectKind: null,
      pendingEffectAt: null,
      pendingEffectCommandId: null,
    },
  });
}

export async function finalizeExpiredCaptureIntentTx(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    issueId: string;
    issueIsActive: boolean;
    closedAt: Date;
  }
): Promise<WorkCaptureIntentFence | null> {
  const currentWhere: Prisma.WorkCaptureIntentWhereInput = {
    userId: input.userId,
    issueId: input.issueId,
    state: "capturing",
  };
  await supersedeWorkCaptureFailuresTx(tx, currentWhere);
  await tx.workCaptureIntent.updateMany({
    where: currentWhere,
    data: input.issueIsActive
      ? {
          state: "adopted",
          closedAt: null,
          pendingEffectKind: null,
          pendingEffectAt: null,
          pendingEffectCommandId: null,
        }
      : {
          state: "closed",
          closedAt: input.closedAt,
          pendingEffectKind: null,
          pendingEffectAt: null,
          pendingEffectCommandId: null,
        },
  });
  if (!input.issueIsActive) return null;
  const current = await tx.workCaptureIntent.findUnique({
    where: { userId_issueId: { userId: input.userId, issueId: input.issueId } },
    select: { epoch: true, leaseGeneration: true, state: true },
  });
  return current?.state === "adopted"
    ? { epoch: current.epoch, leaseGeneration: current.leaseGeneration }
    : null;
}

export async function rebaseCaptureIntentTx(
  tx: Prisma.TransactionClient,
  input: { userId: string; issueId: string }
): Promise<void> {
  const currentWhere: Prisma.WorkCaptureIntentWhereInput = {
    userId: input.userId,
    issueId: input.issueId,
    state: "capturing",
  };
  await supersedeWorkCaptureFailuresTx(tx, currentWhere);
  await tx.workCaptureIntent.updateMany({
    where: currentWhere,
    data: {
      state: "capturing",
      leaseGeneration: { increment: 1 },
      closedAt: null,
      pendingEffectKind: null,
      pendingEffectAt: null,
      pendingEffectCommandId: null,
    },
  });
}
