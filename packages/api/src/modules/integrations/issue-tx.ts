import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import {
  canonicalizeIssueMutationDraft,
  type IssueCaptureIntent,
  type IssueMutationDraft,
  type IssueMutationRow,
} from "./issue-mutation-contract.js";
import { captureIntegrationWorkTx } from "./outbox.js";

export type IssueCaptureContext = Omit<
  IssueCaptureIntent,
  "operation" | "correlationId" | "fields"
>;

export type IssueCaptureOverride = IssueCaptureContext & {
  readonly correlationId: string;
  readonly operation?: IssueCaptureIntent["operation"];
};

export async function lockIssueCaptureBindingTx(
  transaction: Prisma.TransactionClient,
  bindingId: string,
): Promise<void> {
  const [binding] = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid FOR SHARE`,
  );
  if (!binding) throw new Error(`Integration project binding ${bindingId} was not found`);
}

export async function resolveIssueCaptureContext(
  projectId: string,
  memberId: string,
): Promise<IssueCaptureContext | null> {
  // ponytail: PM-182 supports one workspace PM connection; fan out when multi-provider ships.
  const binding = await prisma.integrationProjectBinding.findFirst({
    where: { projectId },
    orderBy: { id: "asc" },
    select: {
      id: true,
      connection: {
        select: {
          credentials: {
            where: { memberId, lastAuthStatus: "valid", revokedAt: null },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });
  if (!binding) return null;

  const actor = await prisma.member.findUnique({
    where: { id: memberId },
    select: { isAgent: true },
  });
  const credentialId = actor?.isAgent ? undefined : binding.connection.credentials[0]?.id;

  return {
    bindingId: binding.id,
    direction: "outbound",
    actorKey: `member:${memberId}`,
    actorKind: actor?.isAgent ? "ai" : "user",
    ...(credentialId ? { authCredentialId: credentialId } : {}),
  };
}

type IssueScheduleCaptureFields = Readonly<
  Partial<{
    estimateHours: number | null;
    startDate: string | null;
    dueDate: string | null;
    progress: number;
  }>
>;

export async function captureIssueScheduleMutationTx(
  transaction: Prisma.TransactionClient,
  issueId: string,
  capture: IssueCaptureContext,
  fields: IssueScheduleCaptureFields,
): Promise<void> {
  if (Object.keys(fields).length === 0) return;

  await captureIntegrationWorkTx(transaction, {
    bindingId: capture.bindingId,
    entityType: "issue",
    entityId: issueId,
    direction: capture.direction,
    operation: "update",
    actorKey: capture.actorKey,
    actorKind: capture.actorKind,
    payload: { version: 1, fields } as Prisma.InputJsonValue,
    correlationId: randomUUID(),
    authCredentialId: capture.authCredentialId,
  });
}

export function withIssueMutationTx(
  operation: (transaction: Prisma.TransactionClient) => Promise<IssueMutationDraft>,
  database: Pick<PrismaClient, "$transaction"> = prisma,
  bindingId?: string,
): Promise<IssueMutationRow> {
  return database.$transaction(async (transaction) => {
    if (bindingId) await lockIssueCaptureBindingTx(transaction, bindingId);
    return captureIssueMutationTx(transaction, await operation(transaction));
  });
}

export async function captureIssueMutationTx(
  transaction: Prisma.TransactionClient,
  mutation: IssueMutationDraft,
): Promise<IssueMutationRow> {
  const { capture, payload, result } = canonicalizeIssueMutationDraft(mutation);

  if (capture.operation === "update" && Object.keys(payload.fields).length === 0) return result;

  const work = await captureIntegrationWorkTx(transaction, {
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
  if (capture.direction === "inbound") {
    await transaction.integrationSyncWork.update({
      where: { id: work.id },
      data: { state: "done" },
    });
  }

  return result;
}
