import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import {
  canonicalizeIssueMutationDraft,
  type IssueCaptureIntent,
  type IssueMutationDraft,
  type IssueMutationRow,
} from "./issue-mutation-contract.js";
import { readBlockedIssueFields } from "./issue-convergence.js";
import { captureIntegrationWorkTx } from "./outbox.js";
import { recordIssueContentProvenanceTx } from "./privacy-hold/content-provenance.js";
export { captureChangedIssueFields } from "./issue-mutation-contract.js";

export type IssueCaptureContext = Omit<
  IssueCaptureIntent,
  "operation" | "correlationId" | "fields"
>;

export type IssueCaptureOverride = IssueCaptureContext & {
  readonly correlationId: string;
  readonly operation?: IssueCaptureIntent["operation"];
};

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

async function routeBlockedIssueFieldsTx(
  transaction: Prisma.TransactionClient,
  bindingId: string,
  issueId: string,
  fields: Readonly<Record<string, unknown>>,
  localVersion: string,
): Promise<Record<string, unknown>> {
  const conflicts = await transaction.$queryRaw<
    Array<{ id: string; localEvidence: Prisma.JsonValue }>
  >(Prisma.sql`
    SELECT conflict."id", conflict."local_evidence" AS "localEvidence"
    FROM "integration_conflicts" AS conflict
    JOIN "external_refs" AS ref ON ref."id" = conflict."ref_id"
    WHERE conflict."binding_id" = ${bindingId}::uuid
      AND conflict."kind" = 'inbound-field-convergence'
      AND conflict."state" = 'open'::"ConflictState"
      AND ref."entity_type" = 'issue'
      AND ref."entity_id" = ${issueId}::uuid
    ORDER BY conflict."created_at", conflict."id"
    FOR UPDATE OF conflict
  `);
  if (conflicts.length === 0) return { ...fields };

  const blocked = new Set<string>(
    conflicts.flatMap(({ localEvidence }) => readBlockedIssueFields(localEvidence)),
  );
  const changedBlocked = Object.keys(fields).filter((field) => blocked.has(field));
  if (changedBlocked.length === 0) return { ...fields };

  for (const conflict of conflicts) {
    const evidence = jsonObject(conflict.localEvidence) ?? {};
    const conflictBlocked = readBlockedIssueFields(evidence);
    const conflictMask = new Set<string>(conflictBlocked);
    const changed = changedBlocked.filter((field) => conflictMask.has(field));
    if (changed.length === 0) continue;
    const evidenceFields = jsonObject(evidence["fields"]) ?? {};
    const nextFields = { ...evidenceFields };
    for (const field of changed) {
      nextFields[field] = {
        ...(jsonObject(evidenceFields[field]) ?? {}),
        local: fields[field] ?? null,
        localVersion,
      };
    }
    await transaction.integrationConflict.update({
      where: { id: conflict.id },
      data: {
        localEvidence: {
          ...evidence,
          blockedFields: conflictBlocked,
          fields: nextFields,
        } as Prisma.InputJsonObject,
      },
    });
  }

  return Object.fromEntries(Object.entries(fields).filter(([field]) => !blocked.has(field)));
}

export async function lockIssueCaptureBindingTx(
  transaction: Prisma.TransactionClient,
  bindingId: string,
): Promise<void> {
  const [binding] = await transaction.$queryRaw<Array<{ id: string }>>(
    Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid AND "release_requested_at" IS NULL AND "released_at" IS NULL FOR SHARE`,
  );
  if (!binding) throw new Error(`Integration project binding ${bindingId} was not found`);
}

export async function resolveIssueCaptureContext(
  projectId: string,
  memberId: string,
): Promise<IssueCaptureContext | null> {
  // ponytail: PM-182 supports one workspace PM connection; fan out when multi-provider ships.
  const binding = await prisma.integrationProjectBinding.findFirst({
    where: {
      projectId,
      releaseRequestedAt: null,
      releasedAt: null,
      project: { archived: false },
    },
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
  localVersion: string,
): Promise<void> {
  if (Object.keys(fields).length === 0) return;
  const correlationId = randomUUID();
  const routedFields =
    capture.direction === "outbound"
      ? await routeBlockedIssueFieldsTx(
          transaction,
          capture.bindingId,
          issueId,
          fields,
          localVersion,
        )
      : fields;
  if (Object.keys(routedFields).length === 0) return;

  await captureIntegrationWorkTx(transaction, {
    bindingId: capture.bindingId,
    entityType: "issue",
    entityId: issueId,
    direction: capture.direction,
    operation: "update",
    actorKey: capture.actorKey,
    actorKind: capture.actorKind,
    payload: { version: 1, fields: routedFields } as Prisma.InputJsonValue,
    correlationId,
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
  const recordContentProvenance = () =>
    recordIssueContentProvenanceTx(transaction, {
      bindingId: capture.bindingId,
      issueId: result.id,
      direction: capture.direction,
      actorKind: capture.actorKind,
      sourceVersion:
        capture.direction === "outbound" ? payload.issue.updatedAt : (capture.sourceVersion ?? null),
      fields: payload.fields,
    });

  if (capture.operation === "update" && Object.keys(payload.fields).length === 0) return result;
  const fields =
    capture.direction === "outbound" && capture.operation === "update"
      ? await routeBlockedIssueFieldsTx(
          transaction,
          capture.bindingId,
          result.id,
          payload.fields,
          payload.issue.updatedAt,
        )
      : payload.fields;
  if (capture.operation === "update" && Object.keys(fields).length === 0) {
    await recordContentProvenance();
    return result;
  }

  const work = await captureIntegrationWorkTx(transaction, {
    bindingId: capture.bindingId,
    entityType: "issue",
    entityId: result.id,
    direction: capture.direction,
    operation: capture.operation,
    actorKey: capture.actorKey,
    actorKind: capture.actorKind,
    payload: { ...payload, fields } as unknown as Prisma.InputJsonValue,
    correlationId: capture.correlationId,
    refId: capture.refId,
    authCredentialId: capture.authCredentialId,
    availableAt: capture.availableAt,
    marker: capture.marker,
  });
  await recordContentProvenance();
  if (capture.direction === "inbound") {
    await transaction.integrationSyncWork.update({
      where: { id: work.id },
      data: { state: "done" },
    });
  }

  return result;
}
