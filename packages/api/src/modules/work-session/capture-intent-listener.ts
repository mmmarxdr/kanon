import { Prisma, type IssueState } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import type { IEventBus } from "../../services/event-bus/interface.js";
import type {
  DomainEvent,
  WorkCaptureIntentEffectRequestedPayload,
} from "../../services/event-bus/types.js";
import {
  applyWorkCaptureIntentActivityTx,
  applyWorkCaptureIntentTerminalTx,
  enqueueWorkSessionStartedTx,
} from "./service.js";
import {
  isCurrentWorkCaptureEffect,
  recordWorkCaptureFailure,
  resolveMatchingWorkCaptureFailureTx,
  supersedeWorkCaptureFailuresTx,
  workCaptureRetryableError,
} from "./capture-intent-failure.js";
import { IMPLICIT_CAPTURE_OWNER_ID } from "./capture-intent-effect.js";

const APPLY_RETRIES = 3;

type LockedIssue = {
  id: string;
  key: string;
  state: IssueState;
  type: string;
  workspaceId: string;
};

async function applyTx(
  tx: Prisma.TransactionClient,
  payload: WorkCaptureIntentEffectRequestedPayload
): Promise<void> {
  const issues = await tx.$queryRaw<LockedIssue[]>`
    SELECT
      issue."id",
      issue."key",
      issue."state"::text AS "state",
      issue."type"::text AS "type",
      project."workspace_id" AS "workspaceId"
    FROM "issues" issue
    JOIN "projects" project ON project."id" = issue."project_id"
    WHERE issue."id" = ${payload.issueId}::uuid
    FOR UPDATE OF issue
  `;
  const issue = issues[0];
  if (!issue || issue.key !== payload.issueKey) return;

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "work_capture_intents"
    WHERE "id" = ${payload.intentId}::uuid
    FOR UPDATE
  `;
  const intent = await tx.workCaptureIntent.findUnique({ where: { id: payload.intentId } });
  if (!intent || !isCurrentWorkCaptureEffect(intent, payload)) return;

  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "work_capture_owner_leases"
    WHERE "intent_id" = ${intent.id}::uuid
    ORDER BY "owner_id" ASC
    FOR UPDATE
  `;
  const databaseClock = await tx.$queryRaw<Array<{ now: Date }>>`
    SELECT CURRENT_TIMESTAMP AS "now"
  `;
  const databaseNow = databaseClock[0]?.now;
  if (!databaseNow) throw new Error("Database did not return owner-lease time");
  await tx.workCaptureOwnerLease.deleteMany({
    where: { intentId: intent.id, expiresAt: { lte: databaseNow } },
  });

  const observedAt = new Date(payload.observedAt);
  if (Number.isNaN(observedAt.getTime())) return;

  if (payload.kind === "activity") {
    if (["paused", "closing", "closed"].includes(intent.state)) return;
    const ownerId =
      typeof payload["ownerId"] === "string" ? payload["ownerId"] : IMPLICIT_CAPTURE_OWNER_ID;
    const owner = await tx.workCaptureOwnerLease.findFirst({
      where: {
        intentId: intent.id,
        ownerId,
        epoch: intent.epoch,
        leaseGeneration: payload.leaseGeneration,
        expiresAt: { gt: databaseNow },
      },
    });
    if (!owner) {
      await supersedeWorkCaptureFailuresTx(tx, {
        id: intent.id,
        failureEpisodeId: intent.failureEpisodeId,
      });
      await tx.workCaptureIntent.update({
        where: { id: intent.id },
        data: {
          pendingEffectKind: null,
          pendingEffectAt: null,
          pendingEffectCommandId: null,
        },
      });
      return;
    }
    const outcome = await applyWorkCaptureIntentActivityTx(tx, {
      commandId: payload.commandId,
      issueId: issue.id,
      issueKey: issue.key,
      issueState: issue.state,
      issueType: issue.type,
      workspaceId: issue.workspaceId,
      userId: intent.userId,
      memberId: intent.memberId,
      source: intent.source,
      observedAt,
      captureIntent: {
        epoch: intent.epoch,
        leaseGeneration: payload.leaseGeneration,
      },
    });
    if (outcome.applied) {
      await resolveMatchingWorkCaptureFailureTx(tx, intent, payload);
    } else {
      await supersedeWorkCaptureFailuresTx(tx, {
        id: intent.id,
        failureEpisodeId: intent.failureEpisodeId,
      });
    }
    const updatedIntent = await tx.workCaptureIntent.update({
      where: { id: intent.id },
      data: {
        ...(outcome.applied
          ? {
              state: "capturing" as const,
              memberId: intent.memberId,
              source: intent.source,
              closedAt: null,
              ...(outcome.opensLease ? { leaseGeneration: { increment: 1 } } : {}),
            }
          : {}),
        pendingEffectKind: null,
        pendingEffectAt: null,
        pendingEffectCommandId: null,
      },
    });
    if (outcome.applied) {
      await enqueueWorkSessionStartedTx(tx, outcome.session, {
        issueKey: issue.key,
        workspaceId: issue.workspaceId,
        autoAssigned: false,
        captureIntent: {
          epoch: updatedIntent.epoch,
          leaseGeneration: updatedIntent.leaseGeneration,
        },
      });
    }
    if (outcome.applied && outcome.opensLease) {
      await tx.workCaptureOwnerLease.updateMany({
        where: {
          intentId: intent.id,
          ownerId,
          epoch: intent.epoch,
          leaseGeneration: payload.leaseGeneration,
          expiresAt: { gt: databaseNow },
        },
        data: { leaseGeneration: payload.leaseGeneration + 1 },
      });
    }
    return;
  }

  if (payload.kind === "release") {
    const liveOwners = await tx.workCaptureOwnerLease.count({
      where: {
        intentId: intent.id,
        epoch: intent.epoch,
        leaseGeneration: intent.leaseGeneration,
        expiresAt: { gt: databaseNow },
      },
    });
    if (liveOwners > 0) {
      await resolveMatchingWorkCaptureFailureTx(tx, intent, payload);
      await tx.workCaptureIntent.update({
        where: { id: intent.id },
        data: {
          pendingEffectKind: null,
          pendingEffectAt: null,
          pendingEffectCommandId: null,
        },
      });
      return;
    }
  } else {
    await tx.workCaptureOwnerLease.deleteMany({ where: { intentId: intent.id } });
  }

  await resolveMatchingWorkCaptureFailureTx(tx, intent, payload);
  await applyWorkCaptureIntentTerminalTx(tx, {
    commandId: payload.commandId,
    kind: payload.kind,
    issueId: issue.id,
    issueKey: issue.key,
    issueType: issue.type,
    workspaceId: issue.workspaceId,
    userId: intent.userId,
    memberId: intent.memberId,
    source: intent.source,
    observedAt,
  });
  await tx.workCaptureIntent.update({
    where: { id: intent.id },
    data:
      payload.kind === "close"
        ? {
            state: "closed",
            closedAt: observedAt,
            pendingEffectKind: null,
            pendingEffectAt: null,
            pendingEffectCommandId: null,
          }
        : {
            state: intent.state === "paused" ? "paused" : "adopted",
            closedAt: null,
            pendingEffectKind: null,
            pendingEffectAt: null,
            pendingEffectCommandId: null,
          },
  });
}

export async function applyWorkCaptureIntentEffect(
  payload: WorkCaptureIntentEffectRequestedPayload,
  notificationsBus: IEventBus = eventBus
): Promise<void> {
  for (let attempt = 0; attempt < APPLY_RETRIES; attempt++) {
    try {
      await prisma.$transaction((tx) => applyTx(tx, payload), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
      return;
    } catch (error) {
      if (
        error &&
        typeof error === "object" &&
        (error as { code?: string }).code === "P2034" &&
        attempt + 1 < APPLY_RETRIES
      ) {
        continue;
      }
      try {
        const recorded = await recordWorkCaptureFailure(payload);
        if (recorded.notificationCreated && recorded.workspaceId && recorded.recipientId) {
          notificationsBus.emit({
            type: "notification.created",
            workspaceId: recorded.workspaceId,
            actorId: recorded.recipientId,
            payload: {},
          });
        }
      } catch {
        // The durable command remains pending in DomainEventOutbox. Its retry is
        // authoritative when the compensating evidence transaction also fails.
      }
      throw workCaptureRetryableError();
    }
  }
}

export function registerCaptureIntentListener(bus: IEventBus): () => void {
  return bus.subscribe((event: DomainEvent) => {
    if (event.type !== "work_capture.intent_effect_requested") return;
    return applyWorkCaptureIntentEffect(
      event.payload as unknown as WorkCaptureIntentEffectRequestedPayload,
      bus
    );
  }, "work-capture-intent-effects");
}
