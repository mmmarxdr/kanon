import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";

const SCANNABLE_STATES = ["queued", "retry"] as const;
const DEFAULT_SCAN_LIMIT = 100;
const SUPPORTED_ENTITY_TYPES = ["issue", "project", "cycle", "comment", "time_entry"] as const;

export type IntegrationWorkDirection = "outbound" | "inbound";
export type IntegrationWorkOperation = "create" | "update" | "delete" | "close";
export type IntegrationWorkActorKind = "user" | "system" | "ai" | "remote";

interface IntegrationWorkCaptureBase {
  readonly bindingId: string;
  readonly entityType: string;
  readonly entityId: string;
  readonly direction: IntegrationWorkDirection;
  readonly operation: IntegrationWorkOperation;
  readonly actorKey: string;
  readonly actorKind: IntegrationWorkActorKind;
  readonly payload: Prisma.InputJsonValue;
  readonly refId?: string | null;
  readonly authCredentialId?: string | null;
  readonly availableAt?: Date;
  readonly epoch?: number;
  readonly marker?: string | null;
  readonly laneKey?: string;
}

export interface IntegrationWorkCapture extends IntegrationWorkCaptureBase {
  /** Stable mutation identity; callers may use either established name. */
  readonly correlationId?: string;
  readonly localMutationCorrelationId?: string;
}

export interface IntegrationWorkScanOptions {
  readonly now?: Date;
  readonly limit?: number;
  readonly bindingId?: string;
}

export type IntegrationWorkRow = Prisma.IntegrationSyncWorkGetPayload<{}>;
type DatabaseTransaction = Prisma.TransactionClient;
type Database = PrismaClient | DatabaseTransaction;
type SupportedEntityType = (typeof SUPPORTED_ENTITY_TYPES)[number];
type EntityOwnership = {
  readonly projectId: string;
  readonly workspaceId: string;
};

function assertNonEmpty(name: string, value: string): void {
  if (value.trim().length === 0) {
    throw new TypeError(`${name} must not be empty`);
  }
}

function isSupportedEntityType(entityType: string): entityType is SupportedEntityType {
  return (SUPPORTED_ENTITY_TYPES as readonly string[]).includes(entityType);
}

async function loadEntityOwnership(
  transaction: DatabaseTransaction,
  entityType: SupportedEntityType,
  entityId: string,
): Promise<EntityOwnership | null> {
  switch (entityType) {
    case "project": {
      const project = await transaction.project.findUnique({
        where: { id: entityId },
        select: { id: true, workspaceId: true },
      });
      return project
        ? { projectId: project.id, workspaceId: project.workspaceId }
        : null;
    }
    case "issue": {
      const issue = await transaction.issue.findUnique({
        where: { id: entityId },
        select: { projectId: true, project: { select: { workspaceId: true } } },
      });
      return issue
        ? { projectId: issue.projectId, workspaceId: issue.project.workspaceId }
        : null;
    }
    case "comment": {
      const comment = await transaction.comment.findUnique({
        where: { id: entityId },
        select: { issue: { select: { projectId: true, project: { select: { workspaceId: true } } } } },
      });
      return comment
        ? { projectId: comment.issue.projectId, workspaceId: comment.issue.project.workspaceId }
        : null;
    }
    case "cycle": {
      const cycle = await transaction.cycle.findUnique({
        where: { id: entityId },
        select: { projectId: true, project: { select: { workspaceId: true } } },
      });
      return cycle
        ? { projectId: cycle.projectId, workspaceId: cycle.project.workspaceId }
        : null;
    }
    case "time_entry": {
      const entry = await transaction.timeEntry.findUnique({
        where: { id: entityId },
        select: {
          issue: { select: { projectId: true, project: { select: { workspaceId: true } } } },
        },
      });
      return entry?.issue
        ? { projectId: entry.issue.projectId, workspaceId: entry.issue.project.workspaceId }
        : null;
    }
  }
}

function correlationIdFor(capture: IntegrationWorkCapture): string {
  const correlationId = capture.localMutationCorrelationId ?? capture.correlationId;
  if (!correlationId) {
    throw new TypeError("correlationId must be provided");
  }
  assertNonEmpty("correlationId", correlationId);
  return correlationId;
}

function hashCanonicalParts(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|")).digest("hex");
}

export function createIntegrationWorkDedupeKey(
  bindingId: string,
  entityType: string,
  entityId: string,
  operation: IntegrationWorkOperation,
  correlationId: string,
): string {
  return hashCanonicalParts([bindingId, entityType, entityId, operation, correlationId]);
}

export function createIntegrationWorkLaneKey(
  bindingId: string,
  entityType: string,
  entityId: string,
): string {
  return hashCanonicalParts([bindingId, entityType, entityId]);
}

/**
 * Capture durable integration work in the caller-owned transaction.
 *
 * The outbox row is deliberately created through the supplied transaction: a
 * domain mutation that rolls back cannot leave a remote-sync instruction
 * behind. The unique dedupe key makes repeated capture of the same mutation
 * return the original row without rewriting its state or payload.
 */
export async function captureIntegrationWorkTx(
  transaction: DatabaseTransaction,
  capture: IntegrationWorkCapture,
): Promise<IntegrationWorkRow> {
  assertNonEmpty("bindingId", capture.bindingId);
  assertNonEmpty("entityType", capture.entityType);
  assertNonEmpty("entityId", capture.entityId);
  assertNonEmpty("actorKey", capture.actorKey);
  if (capture.laneKey !== undefined) assertNonEmpty("laneKey", capture.laneKey);
  const correlationId = correlationIdFor(capture);
  if (!isSupportedEntityType(capture.entityType)) {
    throw new Error(`Unsupported integration entity type ${capture.entityType}`);
  }

  const binding = await transaction.integrationProjectBinding.findUnique({
    where: { id: capture.bindingId },
    select: {
      lifecycleEpoch: true,
      releaseRequestedAt: true,
      releasedAt: true,
      connectionId: true,
      projectId: true,
      connection: { select: { workspaceId: true } },
      project: { select: { workspaceId: true, archived: true } },
    },
  });
  if (!binding) {
    throw new Error(`Integration project binding ${capture.bindingId} was not found`);
  }
  if (binding.releaseRequestedAt || binding.releasedAt || binding.project.archived) {
    throw new Error(`Integration project binding ${capture.bindingId} is not current`);
  }
  if (binding.connection.workspaceId !== binding.project.workspaceId) {
    throw new Error(`Integration project binding ${capture.bindingId} has mismatched ownership`);
  }

  const entityOwnership = await loadEntityOwnership(
    transaction,
    capture.entityType,
    capture.entityId,
  );
  if (
    !entityOwnership ||
    entityOwnership.projectId !== binding.projectId ||
    entityOwnership.workspaceId !== binding.connection.workspaceId
  ) {
    throw new Error(
      `Integration entity ${capture.entityType}:${capture.entityId} is not owned by binding ${capture.bindingId}`,
    );
  }

  if (capture.refId !== undefined && capture.refId !== null) {
    const reference = await transaction.externalRef.findUnique({
      where: { id: capture.refId },
      select: {
        entityType: true,
        entityId: true,
        connectionId: true,
        bindingId: true,
      },
    });
    if (
      !reference ||
      reference.bindingId !== capture.bindingId ||
      reference.connectionId !== binding.connectionId ||
      reference.entityType !== capture.entityType ||
      reference.entityId !== capture.entityId
    ) {
      throw new Error(`External reference ${capture.refId} is not owned by the capture binding`);
    }
  }

  if (capture.authCredentialId !== undefined && capture.authCredentialId !== null) {
    const credential = await transaction.memberIntegrationCredential.findUnique({
      where: { id: capture.authCredentialId },
      select: {
        connectionId: true,
        member: { select: { workspaceId: true } },
      },
    });
    if (
      !credential ||
      credential.connectionId !== binding.connectionId ||
      credential.member.workspaceId !== binding.connection.workspaceId
    ) {
      throw new Error(`Integration credential ${capture.authCredentialId} is not owned by the capture connection`);
    }
  }

  const [lockedBinding] = await transaction.$queryRaw<Array<{ lifecycleEpoch: number }>>(
    Prisma.sql`
      SELECT "lifecycle_epoch" AS "lifecycleEpoch"
      FROM "integration_project_bindings"
      WHERE "id" = ${capture.bindingId}::uuid
      FOR SHARE
    `,
  );
  if (!lockedBinding) {
    throw new Error(`Integration project binding ${capture.bindingId} was not found`);
  }
  if (capture.epoch !== undefined && capture.epoch !== lockedBinding.lifecycleEpoch) {
    throw new Error(
      `Integration work epoch ${capture.epoch} does not match binding epoch ${lockedBinding.lifecycleEpoch}`,
    );
  }

  const dedupeKey = createIntegrationWorkDedupeKey(
    capture.bindingId,
    capture.entityType,
    capture.entityId,
    capture.operation,
    correlationId,
  );
  const laneKey = capture.laneKey ?? createIntegrationWorkLaneKey(capture.bindingId, capture.entityType, capture.entityId);
  const data: Prisma.IntegrationSyncWorkUncheckedCreateInput = {
    entityType: capture.entityType,
    entityId: capture.entityId,
    direction: capture.direction,
    operation: capture.operation,
    dedupeKey,
    laneKey,
    actorKey: capture.actorKey,
    actorKind: capture.actorKind,
    payload: capture.payload,
    correlationId,
    availableAt: capture.availableAt,
    epoch: lockedBinding.lifecycleEpoch,
    authCredentialId: capture.authCredentialId ?? null,
    refId: capture.refId ?? null,
    marker: capture.marker ?? null,
    bindingId: capture.bindingId,
  };

  await transaction.integrationSyncWork.createMany({
    data,
    skipDuplicates: true,
  });
  return transaction.integrationSyncWork.findUniqueOrThrow({ where: { dedupeKey } });
}

/**
 * Read the durable outbox without claiming or changing rows.
 *
 * EventBus notifications may wake a worker, but this scan remains the repair
 * path for missed notifications. Claiming, leasing, and provider I/O belong to
 * later worker slices.
 */
export async function scanIntegrationWork(
  database: Database,
  options: IntegrationWorkScanOptions = {},
): Promise<readonly IntegrationWorkRow[]> {
  const limit = options.limit ?? DEFAULT_SCAN_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new RangeError("scan limit must be a positive integer");
  }

  return database.integrationSyncWork.findMany({
    where: {
      state: { in: [...SCANNABLE_STATES] },
      availableAt: { lte: options.now ?? new Date() },
      ...(options.bindingId ? { bindingId: options.bindingId } : {}),
    },
    orderBy: { sequence: "asc" },
    take: limit,
  });
}

export const scanIntegrationOutbox = scanIntegrationWork;
