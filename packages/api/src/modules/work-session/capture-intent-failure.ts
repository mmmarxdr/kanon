import { randomUUID } from "node:crypto";
import {
  Prisma,
  type WorkCaptureEffectKind,
  type WorkCaptureFailureResolution,
  type WorkCaptureIntent,
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import type { WorkCaptureIntentEffectRequestedPayload } from "../../services/event-bus/types.js";

const COMPENSATION_RETRIES = 3;

export const WORK_CAPTURE_FAILURE_MESSAGE =
  "Work capture was delayed. Kanon retries automatically.";

export const WORK_CAPTURE_FAILURE_CODE = "WORK_CAPTURE_RETRYABLE";

export interface WorkCaptureFailureNotificationPayload {
  issueKey: string;
  stage: "effect_apply";
  code: typeof WORK_CAPTURE_FAILURE_CODE;
  message: typeof WORK_CAPTURE_FAILURE_MESSAGE;
  details: {
    retryable: true;
    effectKind: WorkCaptureEffectKind;
  };
}

export interface RecordWorkCaptureFailureResult {
  notificationCreated: boolean;
  workspaceId?: string;
  recipientId?: string;
}

type CurrentEffectIntent = Pick<
  WorkCaptureIntent,
  | "id"
  | "epoch"
  | "leaseGeneration"
  | "effectRevision"
  | "pendingEffectKind"
  | "pendingEffectAt"
  | "pendingEffectCommandId"
  | "issueId"
  | "userId"
  | "memberId"
  | "source"
>;

type FailureIdentityIntent = CurrentEffectIntent &
  Pick<
    WorkCaptureIntent,
    | "failureEpisodeId"
    | "failureCommandId"
    | "failureEpoch"
    | "failureLeaseGeneration"
    | "failureEffectRevision"
    | "failureEffectKind"
    | "failureEffectAt"
    | "failureResolvedAt"
  >;

type LockedIssue = {
  id: string;
  key: string;
  workspaceId: string;
};

export class WorkCaptureRetryableError extends Error {
  constructor() {
    super(WORK_CAPTURE_FAILURE_MESSAGE);
    this.name = "WorkCaptureRetryableError";
  }
}

export function workCaptureRetryableError(): WorkCaptureRetryableError {
  return new WorkCaptureRetryableError();
}

export function buildWorkCaptureFailurePayload(
  issueKey: string,
  effectKind: WorkCaptureEffectKind
): WorkCaptureFailureNotificationPayload {
  return {
    issueKey,
    stage: "effect_apply",
    code: WORK_CAPTURE_FAILURE_CODE,
    message: WORK_CAPTURE_FAILURE_MESSAGE,
    details: { retryable: true, effectKind },
  };
}

export function isCurrentWorkCaptureEffect(
  intent: CurrentEffectIntent,
  payload: WorkCaptureIntentEffectRequestedPayload
): boolean {
  return (
    intent.id === payload.intentId &&
    intent.epoch === payload.epoch &&
    intent.leaseGeneration === payload.leaseGeneration &&
    intent.effectRevision === payload.effectRevision &&
    intent.pendingEffectKind === payload.kind &&
    intent.pendingEffectAt?.toISOString() === payload.observedAt &&
    intent.pendingEffectCommandId === payload.commandId &&
    intent.issueId === payload.issueId &&
    intent.userId === payload.userId &&
    intent.memberId === payload.memberId &&
    intent.source === payload.source
  );
}

function failureIdentityMatches(
  intent: FailureIdentityIntent,
  payload: WorkCaptureIntentEffectRequestedPayload
): boolean {
  return (
    intent.failureResolvedAt === null &&
    intent.failureCommandId === payload.commandId &&
    intent.failureEpoch === payload.epoch &&
    intent.failureLeaseGeneration === payload.leaseGeneration &&
    intent.failureEffectRevision === payload.effectRevision &&
    intent.failureEffectKind === payload.kind &&
    intent.failureEffectAt?.toISOString() === payload.observedAt
  );
}

function isTransactionConflict(error: unknown): boolean {
  return (
    error !== null && typeof error === "object" && (error as { code?: string }).code === "P2034"
  );
}

async function databaseNow(tx: Prisma.TransactionClient): Promise<Date> {
  const [row] = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT clock_timestamp() AS "now"
  `;
  if (!row) throw new Error("Database did not return a work-capture timestamp");
  return row.now;
}

async function recordWorkCaptureFailureTx(
  tx: Prisma.TransactionClient,
  payload: WorkCaptureIntentEffectRequestedPayload
): Promise<RecordWorkCaptureFailureResult> {
  const issues = await tx.$queryRaw<LockedIssue[]>`
    SELECT
      issue."id",
      issue."key",
      project."workspace_id" AS "workspaceId"
    FROM "issues" issue
    JOIN "projects" project ON project."id" = issue."project_id"
    WHERE issue."id" = ${payload.issueId}::uuid
    FOR UPDATE OF issue
  `;
  const issue = issues[0];
  if (!issue || issue.key !== payload.issueKey) return { notificationCreated: false };

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "work_capture_intents"
    WHERE "id" = ${payload.intentId}::uuid
    FOR UPDATE
  `;
  const intent = await tx.workCaptureIntent.findUnique({ where: { id: payload.intentId } });
  if (!intent || !isCurrentWorkCaptureEffect(intent, payload)) {
    return { notificationCreated: false };
  }

  const failedAt = await databaseNow(tx);
  if (failureIdentityMatches(intent, payload)) {
    await tx.workCaptureIntent.update({
      where: { id: intent.id },
      data: {
        failureCount: { increment: 1 },
        failureLastAt: failedAt,
      },
    });
    return { notificationCreated: false };
  }

  const episodeId = randomUUID();
  await tx.workCaptureIntent.update({
    where: { id: intent.id },
    data: {
      failureEpisodeId: episodeId,
      failureCommandId: payload.commandId,
      failureEpoch: payload.epoch,
      failureLeaseGeneration: payload.leaseGeneration,
      failureEffectRevision: payload.effectRevision,
      failureEffectKind: payload.kind,
      failureEffectAt: new Date(payload.observedAt),
      failureStage: "effect_apply",
      failureCode: WORK_CAPTURE_FAILURE_CODE,
      failureCount: 1,
      failureFirstAt: failedAt,
      failureLastAt: failedAt,
      failureResolvedAt: null,
      failureResolution: null,
    },
  });
  await tx.notification.create({
    data: {
      kind: "work_capture_failure",
      workspaceId: issue.workspaceId,
      recipientId: intent.memberId,
      actorId: null,
      issueId: issue.id,
      workCaptureFailureEpisodeId: episodeId,
      via: intent.source,
      payload: buildWorkCaptureFailurePayload(
        issue.key,
        payload.kind
      ) as unknown as Prisma.InputJsonObject,
    },
  });
  return {
    notificationCreated: true,
    workspaceId: issue.workspaceId,
    recipientId: intent.memberId,
  };
}

export async function recordWorkCaptureFailure(
  payload: WorkCaptureIntentEffectRequestedPayload
): Promise<RecordWorkCaptureFailureResult> {
  for (let attempt = 0; attempt < COMPENSATION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction((tx) => recordWorkCaptureFailureTx(tx, payload), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isTransactionConflict(error) && attempt + 1 < COMPENSATION_RETRIES) continue;
      throw error;
    }
  }
  return { notificationCreated: false };
}

export async function resolveMatchingWorkCaptureFailureTx(
  tx: Prisma.TransactionClient,
  intent: FailureIdentityIntent,
  payload: WorkCaptureIntentEffectRequestedPayload
): Promise<void> {
  if (!failureIdentityMatches(intent, payload)) return;
  const resolvedAt = await databaseNow(tx);
  await tx.workCaptureIntent.updateMany({
    where: {
      id: intent.id,
      failureEpisodeId: intent.failureEpisodeId,
      failureResolvedAt: null,
    },
    data: {
      failureResolvedAt: resolvedAt,
      failureResolution: "succeeded",
    },
  });
}

export async function supersedeWorkCaptureFailuresTx(
  tx: Prisma.TransactionClient,
  where: Prisma.WorkCaptureIntentWhereInput
): Promise<void> {
  const resolvedAt = await databaseNow(tx);
  await tx.workCaptureIntent.updateMany({
    where: {
      AND: [where, { failureCount: { gt: 0 }, failureResolvedAt: null }],
    },
    data: {
      failureResolvedAt: resolvedAt,
      failureResolution: "superseded" satisfies WorkCaptureFailureResolution,
    },
  });
}
