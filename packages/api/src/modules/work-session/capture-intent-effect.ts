import {
  Prisma,
  type WorkCaptureEffectKind,
  type WorkCaptureOwnerKind,
} from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { enqueueDomainEventTx } from "../../services/event-bus/outbox.js";
import type { WorkCaptureIntentEffectRequestedPayload } from "../../services/event-bus/types.js";
import { AppError } from "../../shared/types.js";
import { workSessionLaneKey } from "./service.js";
import { supersedeWorkCaptureFailuresTx } from "./capture-intent-failure.js";

const REQUEST_RETRIES = 3;
const OWNER_LEASE_MS = 5 * 60 * 1000;
export const IMPLICIT_CAPTURE_OWNER_ID = "00000000-0000-4000-8000-000000000001";

function isSerializableConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: string; meta?: { code?: string }; message?: string };
  return (
    candidate.code === "P2034" ||
    (candidate.code === "P2010" && candidate.meta?.code === "40001") ||
    candidate.message?.includes("40001") === true
  );
}

export interface RequestWorkCaptureIntentEffectInput {
  commandId: string;
  intentId: string;
  epoch: string;
  leaseGeneration: number;
  kind: WorkCaptureEffectKind;
  ownerId?: string;
  ownerKind?: WorkCaptureOwnerKind;
}

export interface RequestedWorkCaptureIntentEffect {
  commandId: string;
  deliveryKey: string;
  laneKey: string;
  effectRevision: number;
}

export function workCaptureIntentEffectDeliveryKey(commandId: string): string {
  return `work-capture.intent-effect:v1:${commandId}`;
}

function commandConflict(): AppError {
  return new AppError(
    409,
    "CAPTURE_EFFECT_COMMAND_CONFLICT",
    "Capture-effect command ID was already used with different semantics"
  );
}

function effectBlocked(message: string): AppError {
  return new AppError(409, "CAPTURE_EFFECT_BLOCKED", message);
}

function payloadFrom(value: Prisma.JsonValue): WorkCaptureIntentEffectRequestedPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as unknown as WorkCaptureIntentEffectRequestedPayload;
}

function matchesCommand(
  payload: WorkCaptureIntentEffectRequestedPayload,
  input: RequestWorkCaptureIntentEffectInput
): boolean {
  return (
    payload.commandId === input.commandId &&
    payload.intentId === input.intentId &&
    payload.epoch === input.epoch &&
    payload.leaseGeneration === input.leaseGeneration &&
    payload.kind === input.kind &&
    (typeof payload["ownerId"] === "string" ? payload["ownerId"] : null) ===
      (input.ownerId ?? null) &&
    (payload["ownerKind"] === "web" || payload["ownerKind"] === "mcp"
      ? payload["ownerKind"]
      : "implicit") === (input.ownerKind ?? "implicit")
  );
}

async function lockAndApplyOwnerCommand(
  tx: Prisma.TransactionClient,
  input: RequestWorkCaptureIntentEffectInput,
  acceptedAt: Date
): Promise<void> {
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "work_capture_owner_leases"
    WHERE "intent_id" = ${input.intentId}::uuid
    ORDER BY "owner_id" ASC
    FOR UPDATE
  `;
  await tx.workCaptureOwnerLease.deleteMany({
    where: { intentId: input.intentId, expiresAt: { lte: acceptedAt } },
  });

  if (input.kind === "close") {
    await tx.workCaptureOwnerLease.deleteMany({ where: { intentId: input.intentId } });
    return;
  }

  const ownerId = input.ownerId ?? IMPLICIT_CAPTURE_OWNER_ID;
  if (input.kind === "release") {
    await tx.workCaptureOwnerLease.deleteMany({
      where: {
        intentId: input.intentId,
        ownerId,
        epoch: input.epoch,
        leaseGeneration: input.leaseGeneration,
      },
    });
    return;
  }

  await tx.workCaptureOwnerLease.upsert({
    where: { intentId_ownerId: { intentId: input.intentId, ownerId } },
    create: {
      intentId: input.intentId,
      ownerId,
      epoch: input.epoch,
      leaseGeneration: input.leaseGeneration,
      ownerKind: input.ownerKind ?? "implicit",
      firstSeenAt: acceptedAt,
      lastSeenAt: acceptedAt,
      expiresAt: new Date(acceptedAt.getTime() + OWNER_LEASE_MS),
    },
    update: {
      epoch: input.epoch,
      leaseGeneration: input.leaseGeneration,
      ownerKind: input.ownerKind ?? "implicit",
      lastSeenAt: acceptedAt,
      expiresAt: new Date(acceptedAt.getTime() + OWNER_LEASE_MS),
    },
  });
}

function resultFromPayload(
  payload: WorkCaptureIntentEffectRequestedPayload,
  deliveryKey: string,
  laneKey: string
): RequestedWorkCaptureIntentEffect {
  return {
    commandId: payload.commandId,
    deliveryKey,
    laneKey,
    effectRevision: payload.effectRevision,
  };
}

async function requestTx(
  tx: Prisma.TransactionClient,
  input: RequestWorkCaptureIntentEffectInput
): Promise<RequestedWorkCaptureIntentEffect> {
  const deliveryKey = workCaptureIntentEffectDeliveryKey(input.commandId);
  const existingCommand = await tx.domainEventOutbox.findUnique({
    where: { deliveryKey },
  });
  if (existingCommand) {
    const payload = payloadFrom(existingCommand.payload);
    if (
      existingCommand.eventType !== "work_capture.intent_effect_requested" ||
      !payload ||
      !matchesCommand(payload, input) ||
      existingCommand.laneKey !== workSessionLaneKey(payload.issueId, payload.userId) ||
      existingCommand.actorId !== payload.memberId
    ) {
      throw commandConflict();
    }
    return resultFromPayload(payload, deliveryKey, existingCommand.laneKey);
  }

  const candidate = await tx.workCaptureIntent.findUnique({
    where: { id: input.intentId },
    select: { issueId: true },
  });
  if (!candidate) {
    throw new AppError(404, "CAPTURE_INTENT_NOT_FOUND", "Capture intent not found");
  }

  const lockedIssue = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "issues"
    WHERE "id" = ${candidate.issueId}::uuid
    FOR UPDATE
  `;
  if (!lockedIssue[0]) {
    throw new AppError(404, "ISSUE_NOT_FOUND", "Capture intent issue not found");
  }
  await tx.$queryRaw<Array<{ id: string }>>`
    SELECT "id"
    FROM "work_capture_intents"
    WHERE "id" = ${input.intentId}::uuid
    FOR UPDATE
  `;

  const racedCommand = await tx.domainEventOutbox.findUnique({ where: { deliveryKey } });
  if (racedCommand) {
    const payload = payloadFrom(racedCommand.payload);
    if (
      !payload ||
      !matchesCommand(payload, input) ||
      racedCommand.eventType !== "work_capture.intent_effect_requested" ||
      racedCommand.laneKey !== workSessionLaneKey(payload.issueId, payload.userId) ||
      racedCommand.actorId !== payload.memberId
    ) {
      throw commandConflict();
    }
    return resultFromPayload(payload, deliveryKey, racedCommand.laneKey);
  }

  const intent = await tx.workCaptureIntent.findUnique({
    where: { id: input.intentId },
    include: {
      issue: {
        select: {
          id: true,
          key: true,
          project: { select: { workspaceId: true } },
        },
      },
    },
  });
  if (!intent) {
    throw new AppError(404, "CAPTURE_INTENT_NOT_FOUND", "Capture intent not found");
  }
  if (intent.epoch !== input.epoch || intent.leaseGeneration !== input.leaseGeneration) {
    throw new AppError(
      409,
      "CAPTURE_EFFECT_STALE_FENCE",
      "Capture intent lifecycle changed before the effect request"
    );
  }

  const samePendingCommand = intent.pendingEffectCommandId === input.commandId;
  if (samePendingCommand && intent.pendingEffectKind !== input.kind) {
    throw commandConflict();
  }

  const acceptedAt = samePendingCommand
    ? intent.pendingEffectAt
    : (
        await tx.$queryRaw<Array<{ observedAt: Date }>>`
          SELECT CURRENT_TIMESTAMP AS "observedAt"
        `
      )[0]?.observedAt;
  if (!acceptedAt) throw commandConflict();
  const observedAt = acceptedAt.toISOString();

  if (input.kind === "activity") {
    if (["paused", "closing", "closed"].includes(intent.state)) {
      throw effectBlocked(`Cannot request activity while capture is ${intent.state}`);
    }
    if (intent.pendingEffectKind === "close") {
      throw effectBlocked("A pending close blocks later activity");
    }
  } else if (input.kind === "release") {
    if (intent.state === "closing" || intent.state === "closed") {
      throw effectBlocked(`Cannot request release while capture is ${intent.state}`);
    }
    if (intent.pendingEffectKind === "close") {
      throw effectBlocked("A pending close blocks later release");
    }
  } else if (intent.state === "closed") {
    throw effectBlocked("Capture intent is already closed");
  }

  if (!samePendingCommand) {
    await supersedeWorkCaptureFailuresTx(tx, { id: intent.id });
  }

  await lockAndApplyOwnerCommand(tx, input, acceptedAt);

  const updated = samePendingCommand
    ? intent
    : await tx.workCaptureIntent.update({
        where: { id: intent.id },
        data: {
          pendingEffectKind: input.kind,
          pendingEffectAt: acceptedAt,
          pendingEffectCommandId: input.commandId,
          effectRevision: { increment: 1 },
          ...(input.kind === "close" ? { state: "closing" as const, closedAt: null } : {}),
        },
      });
  const laneKey = workSessionLaneKey(intent.issueId, intent.userId);
  const payload: WorkCaptureIntentEffectRequestedPayload = {
    commandId: input.commandId,
    intentId: intent.id,
    epoch: intent.epoch,
    leaseGeneration: input.leaseGeneration,
    effectRevision: updated.effectRevision,
    kind: input.kind,
    ownerId: input.ownerId ?? null,
    ownerKind: input.ownerKind ?? "implicit",
    observedAt,
    issueKey: intent.issue.key,
    issueId: intent.issue.id,
    userId: intent.userId,
    memberId: intent.memberId,
    source: intent.source,
  };
  await enqueueDomainEventTx(tx, {
    deliveryKey,
    laneKey,
    event: {
      type: "work_capture.intent_effect_requested",
      workspaceId: intent.issue.project.workspaceId,
      actorId: intent.memberId,
      payload,
    },
  });
  return resultFromPayload(payload, deliveryKey, laneKey);
}

export async function requestWorkCaptureIntentEffect(
  input: RequestWorkCaptureIntentEffectInput
): Promise<RequestedWorkCaptureIntentEffect> {
  for (let attempt = 0; attempt < REQUEST_RETRIES; attempt++) {
    try {
      return await prisma.$transaction((tx) => requestTx(tx, input), {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      });
    } catch (error) {
      if (isSerializableConflict(error) && attempt + 1 < REQUEST_RETRIES) {
        continue;
      }
      throw error;
    }
  }
  throw new AppError(409, "CAPTURE_EFFECT_CONFLICT", "Capture effect changed concurrently");
}
