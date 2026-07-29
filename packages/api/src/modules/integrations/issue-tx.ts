import type { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import {
  canonicalizeIssueMutationDraft,
  type IssueMutationDraft,
  type IssueMutationRow,
} from "./issue-mutation-contract.js";
import { captureIntegrationWorkTx } from "./outbox.js";

export function withIssueMutationTx(
  operation: (transaction: Prisma.TransactionClient) => Promise<IssueMutationDraft>,
  database: Pick<PrismaClient, "$transaction"> = prisma,
): Promise<IssueMutationRow> {
  return database.$transaction(async (transaction) => {
    const detached = canonicalizeIssueMutationDraft(await operation(transaction));
    const { capture, payload, result } = detached;

    await captureIntegrationWorkTx(transaction, {
      bindingId: capture.bindingId,
      entityType: "issue",
      entityId: result.id,
      direction: capture.direction,
      operation: capture.operation,
      actorKey: capture.actorKey,
      actorKind: capture.actorKind,
      payload: payload as unknown as Prisma.InputJsonValue,
      correlationId: capture.correlationId,
      refId: capture.refId,
      authCredentialId: capture.authCredentialId,
      availableAt: capture.availableAt,
      marker: capture.marker,
    });

    return result;
  });
}
