import { Prisma, type IssueState } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import type { IEventBus } from "../../services/event-bus/interface.js";
import type {
  DomainEvent,
  WorkCaptureIntentEffectRequestedPayload,
} from "../../services/event-bus/types.js";
import { applyWorkCaptureIntentActivityTx, applyWorkCaptureIntentTerminalTx } from "./service.js";
import {
  isCurrentWorkCaptureEffect,
  recordWorkCaptureFailure,
  resolveMatchingWorkCaptureFailureTx,
  supersedeWorkCaptureFailuresTx,
  workCaptureRetryableError,
} from "./capture-intent-failure.js";

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

  const observedAt = new Date(payload.observedAt);
  if (Number.isNaN(observedAt.getTime())) return;

  if (payload.kind === "activity") {
    if (["paused", "closing", "closed"].includes(intent.state)) return;
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
    });
    if (outcome.applied) {
      await resolveMatchingWorkCaptureFailureTx(tx, intent, payload);
    } else {
      await supersedeWorkCaptureFailuresTx(tx, {
        id: intent.id,
        failureEpisodeId: intent.failureEpisodeId,
      });
    }
    await tx.workCaptureIntent.update({
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
    return;
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
