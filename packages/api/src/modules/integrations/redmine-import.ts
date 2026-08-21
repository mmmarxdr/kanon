import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { decrypt as decryptCredential } from "./core/crypto.js";
import type { PollCheckpoint } from "./core/types.js";
import { captureIssueMutationTx } from "./issue-tx.js";
import { priorityReadKey } from "./issue-convergence.js";
import {
  decodeRedmineIssueDetail,
  decodeRedmineIssueListPage,
  MAX_ISSUES_PER_PASS,
  RedminePaginationDriftError,
  type RedmineIssueChange,
} from "./providers/redmine/decoder.js";
import { RedmineHttpClient, RedmineHttpError } from "./providers/redmine/http-client.js";
import { ownedConnection, serviceCredential } from "./service.js";

const PAGE_SIZE = 100;
const ACTIVATION_BATCH_SIZE = 10;
const BOOTSTRAP_LEASE_MS = 120_000;
const IssueState = z.enum(["backlog", "analysis", "todo", "in_progress", "review", "done"]);
const IssuePriority = z.enum(["critical", "high", "medium", "low"]);
const Checkpoint = z
  .object({
    updatedAt: z.string().datetime(),
    remoteId: z.string().regex(/^\d+$/),
    pageToken: z.string().nullable(),
  })
  .strict();
const PreviewMode = z.enum(["full", "future_only"]);
const LegacyPreviewEvidence = z
  .object({
    version: z.literal(1),
    complete: z.boolean(),
    nextOffset: z.number().int().nonnegative().max(MAX_ISSUES_PER_PASS),
    scannedCount: z.number().int().nonnegative().max(MAX_ISSUES_PER_PASS),
    excludedPrivateCount: z.number().int().nonnegative().max(MAX_ISSUES_PER_PASS),
    linkedCount: z.number().int().nonnegative().max(MAX_ISSUES_PER_PASS),
    checkpoint: Checkpoint.nullable(),
    candidates: z
      .array(
        z
          .object({
            remoteId: z.string().regex(/^\d+$/),
            sourceVersion: z.string().regex(/^sha256:[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(MAX_ISSUES_PER_PASS),
    unmappedStatusIds: z.array(z.string().regex(/^\d+$/)).max(MAX_ISSUES_PER_PASS),
    unmappedPriorityIds: z
      .array(z.string().regex(/^\d+$/))
      .max(MAX_ISSUES_PER_PASS)
      .default([]),
    unmappedAssigneeIds: z.array(z.string().regex(/^\d+$/)).max(MAX_ISSUES_PER_PASS),
  })
  .strict();
const ReconciliationPreviewEvidence = LegacyPreviewEvidence.omit({ version: true })
  .extend({
    version: z.literal(2),
    previewIdentity: z.string().uuid(),
    mode: PreviewMode,
    scopeFingerprint: z.string().regex(/^sha256:[a-f0-9]{64}$/),
    cutoff: z.string().datetime(),
    remainingCount: z.number().int().nonnegative().max(MAX_ISSUES_PER_PASS),
    assigneeRemoteIds: z.array(z.string().regex(/^\d+$/)).max(MAX_ISSUES_PER_PASS),
  })
  .strict();
const PreviewEvidence = z.union([LegacyPreviewEvidence, ReconciliationPreviewEvidence]);

type PreviewEvidence = z.infer<typeof PreviewEvidence>;
export type RedminePreviewMode = z.infer<typeof PreviewMode>;
type Database = Prisma.TransactionClient;
type Client = Pick<RedmineHttpClient, "get">;

export interface RedmineIssueImportContext {
  readonly connectionId: string;
  readonly bindingId: string;
  readonly projectId: string;
  readonly projectKey: string;
  readonly workspaceId: string;
  readonly readMap: Prisma.JsonValue;
  readonly provenance:
    | "redmine-inbound-bootstrap"
    | "redmine-inbound-discovery"
    | "redmine-inbound-retry";
  readonly applicationClaim?: InboundApplicationClaim;
}

export interface InboundApplicationClaim {
  readonly id: string;
  readonly leaseToken: string;
  readonly fence: number;
}

export interface RedmineImportDependencies {
  readonly now?: () => Date;
  readonly decrypt?: (ciphertext: string) => string;
  readonly client?: (baseUrl: string, apiKey: string) => Client;
  readonly allowedProjectIds?: string[] | null;
  readonly workspaceId?: string;
}

const defaultClient = (baseUrl: string, apiKey: string): Client =>
  new RedmineHttpClient(baseUrl, apiKey, {
    endpointAllowlist: env.REDMINE_ENDPOINT_ALLOWLIST,
  });

function parseEvidence(value: Prisma.JsonValue | null): PreviewEvidence {
  const parsed = PreviewEvidence.safeParse(value);
  if (!parsed.success) {
    throw new AppError(409, "REDMINE_PREVIEW_INVALID", "Run the Redmine import preview again");
  }
  return parsed.data;
}

function checkpoint(value: PreviewEvidence["checkpoint"]): PollCheckpoint | null {
  return value
    ? {
        updatedAt: new Date(value.updatedAt),
        remoteId: value.remoteId,
        pageToken: value.pageToken,
      }
    : null;
}

function storedCheckpoint(value: PollCheckpoint | null): PreviewEvidence["checkpoint"] {
  return value
    ? {
        updatedAt: value.updatedAt.toISOString(),
        remoteId: value.remoteId,
        pageToken: value.pageToken ?? null,
      }
    : null;
}

function emptyEvidence(
  reconciliation?: Readonly<{
    mode: RedminePreviewMode;
    cutoff: Date;
    scopeFingerprint: string;
  }>,
): PreviewEvidence {
  const evidence = {
    complete: false,
    nextOffset: 0,
    scannedCount: 0,
    excludedPrivateCount: 0,
    linkedCount: 0,
    checkpoint: null,
    candidates: [],
    unmappedStatusIds: [],
    unmappedPriorityIds: [],
    unmappedAssigneeIds: [],
  };
  return reconciliation
    ? {
        ...evidence,
        version: 2,
        previewIdentity: randomUUID(),
        mode: reconciliation.mode,
        scopeFingerprint: reconciliation.scopeFingerprint,
        cutoff: reconciliation.cutoff.toISOString(),
        remainingCount: 0,
        assigneeRemoteIds: [],
      }
    : { ...evidence, version: 1 };
}

function assertLifecycle(
  connection: { lifecycle: string },
  binding: { lifecycle: string },
  reconciliationPreview: boolean,
  reconciliationActivation = false,
): void {
  if (
    reconciliationActivation &&
    ["active", "draft", "paused"].includes(connection.lifecycle) &&
    ["active", "draft", "paused"].includes(binding.lifecycle)
  ) {
    return;
  }
  if (reconciliationPreview) {
    if (
      !["draft", "paused"].includes(connection.lifecycle) ||
      !["draft", "paused"].includes(binding.lifecycle)
    ) {
      throw new AppError(
        409,
        "REDMINE_PREVIEW_LIFECYCLE",
        "Reconciliation preview requires a draft or paused connection and project binding",
      );
    }
    return;
  }
  if (connection.lifecycle !== "active" || binding.lifecycle !== "active") {
    throw new AppError(
      409,
      "INTEGRATION_NOT_ACTIVE",
      "The Redmine connection and project binding must be active",
    );
  }
}

async function importBinding(
  database: Database,
  connectionId: string,
  bindingId: string,
  userId: string,
  allowedProjectIds?: string[] | null,
  workspaceId?: string,
  reconciliationPreview = false,
  reconciliationActivation = false,
) {
  const connection = await ownedConnection(database, connectionId, userId, workspaceId);
  if (connection.provider !== "redmine") {
    throw new AppError(400, "INVALID_INTEGRATION_PROVIDER", "Connection is not a Redmine integration");
  }
  const binding = await database.integrationProjectBinding.findFirst({
    where: {
      id: bindingId,
      connectionId,
      releaseRequestedAt: null,
      releasedAt: null,
      project: { archived: false },
      ...(allowedProjectIds?.length ? { projectId: { in: allowedProjectIds } } : {}),
    },
    include: { project: { select: { key: true, workspaceId: true } } },
  });
  if (!binding) {
    throw new AppError(404, "INTEGRATION_BINDING_NOT_FOUND", "Integration project binding not found");
  }
  assertLifecycle(connection, binding, reconciliationPreview, reconciliationActivation);
  const credential = await serviceCredential(database, connection);
  return { connection, binding, credential };
}

type ImportBinding = Awaited<ReturnType<typeof importBinding>>;
type AssigneeIdentity = {
  remoteUserId: string;
  memberId: string | null;
  member: { workspaceId: string } | null;
};

function canonicalJson(value: Prisma.JsonValue): Prisma.JsonValue {
  if (Array.isArray(value)) return value.map(canonicalJson);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
        .map(([key, entry]) => [key, canonicalJson(entry)]),
    );
  }
  return value;
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}

function reconciliationScopeFingerprint(
  current: ImportBinding,
  mode: RedminePreviewMode,
  assigneeRemoteIds: readonly string[],
  identities: readonly AssigneeIdentity[],
): string {
  const mapped = new Map(
    identities
      .filter((identity) => identity.member?.workspaceId === current.connection.workspaceId)
      .map((identity) => [identity.remoteUserId, identity.memberId]),
  );
  const baseUrl = new URL(current.connection.baseUrl);
  baseUrl.hash = "";
  baseUrl.search = "";
  return sha256(
    JSON.stringify({
      mode,
      baseUrl: baseUrl.toString().replace(/\/+$/, ""),
      connectionEpoch: current.connection.lifecycleEpoch,
      bindingEpoch: current.binding.lifecycleEpoch,
      remoteProjectId: current.binding.remoteProjectId,
      credentialId: current.credential.id,
      credentialFingerprint: sha256(current.credential.encryptedKey),
      readMap: canonicalJson(current.binding.readMap),
      assignees: sortRemoteIds(new Set(assigneeRemoteIds)).map((id) => [id, mapped.get(id) ?? null]),
    }),
  );
}

async function assertReconciliationScope(
  database: Database,
  current: ImportBinding,
  evidence: PreviewEvidence,
): Promise<void> {
  if (evidence.version !== 2) return;
  const identities = evidence.assigneeRemoteIds.length
    ? await database.integrationExternalIdentity.findMany({
        where: { bindingId: current.binding.id, remoteUserId: { in: evidence.assigneeRemoteIds } },
        select: { remoteUserId: true, memberId: true, member: { select: { workspaceId: true } } },
      })
    : [];
  if (
    evidence.scopeFingerprint !==
    reconciliationScopeFingerprint(current, evidence.mode, evidence.assigneeRemoteIds, identities)
  ) {
    throw new AppError(409, "REDMINE_PREVIEW_STALE", "The reconciliation preview scope changed");
  }
}

function decryptServiceCredential(
  decrypt: (ciphertext: string) => string,
  encryptedKey: string,
): string {
  try {
    const key = decrypt(encryptedKey);
    if (key) return key;
  } catch {
    // Return the same redacted readiness error as a missing or revoked credential.
  }
  throw new AppError(409, "INTEGRATION_NOT_READY", "A valid service credential is required");
}

function remoteFailure(): AppError {
  return new AppError(
    502,
    "REDMINE_CONNECTION_FAILED",
    "Redmine import failed while reading the remote project",
  );
}

function sortRemoteIds(values: Set<string>): string[] {
  return [...values].sort((left, right) => Number(left) - Number(right));
}

function applicationKey(bindingId: string, change: RedmineIssueChange): string {
  return createHash("sha256")
    .update(`${bindingId}|issue|${change.identity.remoteId}|${change.sourceVersion}`)
    .digest("hex");
}

export function isEligibleRedmineIssueImport(
  change: Pick<RedmineIssueChange, "createdAt" | "closedAt">,
  mappedState: unknown,
  cutoff: Date,
): boolean {
  const isClosed = mappedState === "done" || change.closedAt !== undefined;
  return (
    !isClosed ||
    (change.createdAt?.getTime() ?? -1) >= cutoff.getTime() ||
    (change.closedAt?.getTime() ?? -1) >= cutoff.getTime()
  );
}

export async function completeRetriedApplicationTx(
  database: Database,
  claim: InboundApplicationClaim,
  data: {
    state: "applied" | "skipped";
    refId: string | null;
    workId: string | null;
    outcome: Prisma.InputJsonValue;
    applicationKey?: string;
    correlationId?: string;
    remoteUpdatedAt?: Date;
    sourceVersion?: string;
  },
): Promise<void> {
  const [clock] = await database.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  if (!clock) throw new Error("Database clock unavailable");
  const updated = await database.integrationInboundApplication.updateMany({
    where: {
      id: claim.id,
      state: "claimed",
      leaseToken: claim.leaseToken,
      leaseUntil: { gt: clock.now },
      fence: claim.fence,
    },
    data: {
      ...data,
      leaseToken: null,
      leaseUntil: null,
    },
  });
  if (updated.count !== 1) {
    throw new AppError(409, "INBOUND_APPLICATION_STALE", "Inbound application retry is stale");
  }
  await database.integrationConflict.updateMany({
    where: {
      applicationId: claim.id,
      kind: "inbound-observation-failure",
      state: "open",
    },
    data: { state: "resolved" },
  });
}

export async function persistRedmineIssueImportsTx(
  database: Database,
  context: RedmineIssueImportContext,
  changes: readonly RedmineIssueChange[],
): Promise<string[]> {
  if (context.applicationClaim && changes.length !== 1) {
    throw new TypeError("A retried inbound application must import exactly one issue");
  }
  const readMap =
    context.readMap && typeof context.readMap === "object" && !Array.isArray(context.readMap)
      ? (context.readMap as Record<string, unknown>)
      : {};
  const imports = changes.map((change) => {
    if (change.operation !== "upsert" || !("statusId" in change.fields)) {
      throw new AppError(409, "REDMINE_PREVIEW_STALE", "A Redmine issue became private");
    }
    const state = IssueState.safeParse(readMap[change.fields.statusId]);
    if (!state.success) {
      throw new AppError(
        409,
        "REDMINE_STATUS_UNMAPPED",
        `Redmine status ${change.fields.statusId} has no inbound mapping`,
      );
    }
    const priority = IssuePriority.safeParse(readMap[priorityReadKey(change.fields.priorityId)]);
    if (!priority.success) {
      throw new AppError(
        409,
        "REDMINE_PRIORITY_UNMAPPED",
        `Redmine priority ${change.fields.priorityId} has no inbound mapping`,
      );
    }
    return { change, fields: change.fields, state: state.data, priority: priority.data };
  });
  if (!imports.length) return [];

  const assigneeIds = imports.flatMap(({ fields }) =>
    fields.assignee ? [fields.assignee.remoteId] : [],
  );
  const existingIdentities = assigneeIds.length
    ? await database.integrationExternalIdentity.findMany({
        where: { bindingId: context.bindingId, remoteUserId: { in: assigneeIds } },
        select: {
          remoteUserId: true,
          memberId: true,
          member: { select: { workspaceId: true } },
        },
      })
    : [];
  const assignees = new Map(
    existingIdentities.map((identity) => [
      identity.remoteUserId,
      identity.member?.workspaceId === context.workspaceId ? identity.memberId : null,
    ]),
  );
  const actors = new Map<string, NonNullable<RedmineIssueChange["actor"]>>();
  for (const { change, fields } of imports) {
    if (change.actor) actors.set(change.actor.remoteId, change.actor);
    if (fields.assignee) actors.set(fields.assignee.remoteId, fields.assignee);
  }
  for (const actor of actors.values()) {
    await database.integrationExternalIdentity.upsert({
      where: {
        bindingId_remoteUserId: { bindingId: context.bindingId, remoteUserId: actor.remoteId },
      },
      create: {
        bindingId: context.bindingId,
        remoteUserId: actor.remoteId,
        remoteLogin: actor.username ?? null,
        remoteDisplayName: actor.displayName,
      },
      update: {
        ...(actor.username === undefined ? {} : { remoteLogin: actor.username }),
        remoteDisplayName: actor.displayName,
      },
    });
  }

  const project = await database.project.update({
    where: { id: context.projectId },
    data: { lastSequenceNum: { increment: imports.length } },
    select: { lastSequenceNum: true },
  });
  const firstSequence = project.lastSequenceNum - imports.length + 1;
  const issueKeys: string[] = [];

  for (const [index, entry] of imports.entries()) {
    const { change, fields, state, priority } = entry;
    const correlationId = applicationKey(context.bindingId, change);
    const assigneeId = fields.assignee
      ? (assignees.get(fields.assignee.remoteId) ?? null)
      : null;
    const sequenceNum = firstSequence + index;
    const issue = await database.issue.create({
      data: {
        key: `${context.projectKey}-${sequenceNum}`,
        sequenceNum,
        title: fields.title,
        description: fields.description,
        state,
        priority,
        projectId: context.projectId,
        assigneeId,
        createdAt: change.createdAt ?? change.changedAt,
        completedAt: state === "done" ? (change.closedAt ?? change.changedAt) : null,
      },
    });
    if (fields.startDate || fields.dueDate || fields.progress !== 0) {
      await database.issueSchedule.create({
        data: {
          issueId: issue.id,
          startDate: fields.startDate ? new Date(`${fields.startDate}T00:00:00.000Z`) : null,
          dueDate: fields.dueDate ? new Date(`${fields.dueDate}T00:00:00.000Z`) : null,
          progress: fields.progress,
        },
      });
    }
    const ref = await database.externalRef.create({
      data: {
        connectionId: context.connectionId,
        bindingId: context.bindingId,
        entityType: "issue",
        entityId: issue.id,
        externalId: change.identity.remoteId,
        remoteUpdatedAt: change.changedAt,
        localVersion: 1,
        lastCorrelationId: correlationId,
        metadata: {
          remoteVersion: change.sourceVersion,
          baseline: {
            version: 1,
            sourceVersion: change.sourceVersion,
            changedAt: change.changedAt.toISOString(),
            createdAt: (change.createdAt ?? change.changedAt).toISOString(),
            completedAt:
              state === "done" ? (change.closedAt ?? change.changedAt).toISOString() : null,
            fields: {
              title: fields.title,
              description: fields.description,
              state,
              priority,
              assigneeId,
              startDate: fields.startDate,
              dueDate: fields.dueDate,
              progress: fields.progress,
            },
          },
        },
      },
    });
    await captureIssueMutationTx(database, {
      result: issue,
      capture: {
        bindingId: context.bindingId,
        direction: "inbound",
        operation: "create",
        actorKey: `redmine:user:${change.actor?.remoteId ?? "unknown"}`,
        actorKind: "remote",
        correlationId,
        refId: ref.id,
        sourceVersion: change.sourceVersion,
        fields: {
          title: issue.title,
          description: issue.description,
          state: issue.state,
          priority: issue.priority,
          assigneeId: issue.assigneeId,
        },
      },
    });
    const work = await database.integrationSyncWork.findFirstOrThrow({
      where: {
        bindingId: context.bindingId,
        direction: "inbound",
        correlationId,
        entityId: issue.id,
      },
      select: { id: true },
    });
    const outcome = {
      provenance: context.provenance,
      issueKey: issue.key,
      ...(context.applicationClaim ? { retriedSourceVersion: change.sourceVersion } : {}),
    };
    if (context.applicationClaim) {
      await completeRetriedApplicationTx(database, context.applicationClaim, {
        state: "applied",
        refId: ref.id,
        workId: work.id,
        outcome,
        applicationKey: correlationId,
        correlationId,
        remoteUpdatedAt: change.changedAt,
        sourceVersion: change.sourceVersion,
      });
    } else {
      await database.integrationInboundApplication.create({
        data: {
          bindingId: context.bindingId,
          remoteEntityType: "issue",
          remoteId: change.identity.remoteId,
          remoteUpdatedAt: change.changedAt,
          sourceVersion: change.sourceVersion,
          applicationKey: correlationId,
          correlationId,
          state: "applied",
          refId: ref.id,
          workId: work.id,
          outcome,
        },
      });
    }
    issueKeys.push(issue.key);
  }

  return issueKeys;
}

const unresolvedIssueDeleteWhere = {
  entityType: "issue",
  operation: "delete",
  state: { notIn: ["done", "superseded"] },
} satisfies Prisma.IntegrationSyncWorkWhereInput;

async function assertBootstrapMutationAvailable(
  transaction: Prisma.TransactionClient,
  bindingId: string,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid FOR UPDATE`,
  );
  const unresolved = await transaction.integrationSyncWork.count({
    where: { bindingId, ...unresolvedIssueDeleteWhere },
  });
  if (unresolved > 0) {
    throw new AppError(
      409,
      "REMOTE_DELETE_IN_PROGRESS",
      "Wait for queued remote issue deletions to finish before changing the integration.",
    );
  }
}

export async function previewRedmineIssueImport(
  connectionId: string,
  bindingId: string,
  userId: string,
  dependencies: RedmineImportDependencies = {},
  mode?: RedminePreviewMode,
) {
  const now = dependencies.now ?? (() => new Date());
  const decrypt = dependencies.decrypt ?? decryptCredential;
  const createClient = dependencies.client ?? defaultClient;

  await importBinding(
    prisma,
    connectionId,
    bindingId,
    userId,
    dependencies.allowedProjectIds,
    dependencies.workspaceId,
    mode !== undefined,
  );
  const claim = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid FOR UPDATE`,
    );
    const current = await importBinding(
      transaction,
      connectionId,
      bindingId,
      userId,
      dependencies.allowedProjectIds,
      dependencies.workspaceId,
      mode !== undefined,
    );
    if (current.binding.inboundEnabled && current.binding.bootstrapState === "ready") {
      throw new AppError(409, "REDMINE_IMPORT_ACTIVE", "Redmine inbound import is already active");
    }
    if (current.binding.bootstrapState === "bootstrapping") {
      throw new AppError(
        409,
        "REDMINE_IMPORT_IN_PROGRESS",
        "Finish the current Redmine import activation before previewing again",
      );
    }
    const unsettledOutbound = await transaction.integrationSyncWork.count({
      where: {
        bindingId,
        epoch: current.binding.lifecycleEpoch,
        direction: "outbound",
        state: { in: ["leased", "ambiguous"] },
      },
    });
    if (unsettledOutbound) {
      throw new AppError(
        409,
        "REDMINE_OUTBOUND_UNSETTLED",
        "Resolve in-flight or ambiguous Redmine writes before previewing the import",
      );
    }

    const claimedAt = now();
    if (
      current.binding.bootstrapLeaseToken &&
      current.binding.bootstrapLeaseUntil &&
      current.binding.bootstrapLeaseUntil > claimedAt
    ) {
      throw new AppError(409, "REDMINE_PREVIEW_IN_PROGRESS", "A Redmine import preview is running");
    }
    const storedEvidence =
      current.binding.bootstrapState === "pending" && current.binding.bootstrapCutoff
        ? PreviewEvidence.safeParse(current.binding.bootstrapPageToken)
        : null;
    const stored = storedEvidence?.success ? storedEvidence.data : null;
    const resumable = stored && stored.nextOffset < MAX_ISSUES_PER_PASS ? stored : null;
    const cutoff = resumable
      ? current.binding.bootstrapCutoff!
      : new Date(Math.floor(claimedAt.getTime() / 1_000) * 1_000);
    if (
      resumable &&
      ((mode === undefined && resumable.version === 2) ||
        (mode !== undefined &&
          (resumable.version !== 2 ||
            resumable.mode !== mode ||
            resumable.cutoff !== cutoff.toISOString())))
    ) {
      throw new AppError(409, "REDMINE_PREVIEW_STALE", "The reconciliation preview scope changed");
    }
    if (resumable) await assertReconciliationScope(transaction, current, resumable);
    const evidence = resumable?.complete
      ? emptyEvidence()
      : (resumable ??
        (mode
          ? emptyEvidence({
              mode,
              cutoff,
              scopeFingerprint: reconciliationScopeFingerprint(current, mode, [], []),
            })
          : emptyEvidence()));
    await assertBootstrapMutationAvailable(transaction, bindingId);
    const leaseToken = randomUUID();
    const binding = await transaction.integrationProjectBinding.update({
      where: { id: bindingId },
      data: {
        inboundEnabled: false,
        bootstrapState: "pending",
        bootstrapCutoff: cutoff,
        bootstrapPageToken: evidence as unknown as Prisma.InputJsonValue,
        bootstrapLeaseToken: leaseToken,
        bootstrapLeaseUntil: new Date(claimedAt.getTime() + BOOTSTRAP_LEASE_MS),
        bootstrapFence: { increment: 1 },
      },
      select: { bootstrapFence: true },
    });
    return {
      ...current,
      cutoff,
      evidence,
      leaseToken,
      fence: binding.bootstrapFence,
    };
  });

  let evidence = claim.evidence;
  try {
    const key = decryptServiceCredential(decrypt, claim.credential.encryptedKey);
    const client = createClient(claim.connection.baseUrl, key);
    const query = new URLSearchParams({
      project_id: claim.binding.remoteProjectId,
      status_id: "*",
      updated_on: `<=${claim.cutoff.toISOString().replace(/\.\d{3}Z$/, "Z")}`,
      sort: "updated_on:asc,id:asc",
      limit: String(PAGE_SIZE),
      offset: String(evidence.nextOffset),
    });
    const value = await client.get<unknown>(`/issues.json?${query}`);
    const page = decodeRedmineIssueListPage(
      value,
      claim.binding.remoteProjectId,
      evidence.nextOffset,
      PAGE_SIZE,
      checkpoint(evidence.checkpoint),
    );
    const remoteIds = page.changes.map((change) => change.identity.remoteId);
    const linked = remoteIds.length
      ? await prisma.externalRef.findMany({
          where: {
            connectionId,
            entityType: "issue",
            externalId: { in: remoteIds },
          },
          select: { externalId: true },
        })
      : [];
    const linkedIds = new Set(linked.map((ref) => ref.externalId));
    const candidates = [...evidence.candidates];
    const unmappedStatusIds = new Set(evidence.unmappedStatusIds);
    const unmappedPriorityIds = new Set(evidence.unmappedPriorityIds);
    const assigneeIds = new Set(
      evidence.version === 2 ? evidence.assigneeRemoteIds : ([] as string[]),
    );
    let excludedPrivateCount = evidence.excludedPrivateCount;
    let linkedCount = evidence.linkedCount;
    const readMap =
      claim.binding.readMap &&
      typeof claim.binding.readMap === "object" &&
      !Array.isArray(claim.binding.readMap)
        ? (claim.binding.readMap as Record<string, unknown>)
        : {};

    for (const change of page.changes) {
      if (change.operation === "tombstone" || !("statusId" in change.fields)) {
        excludedPrivateCount += 1;
        continue;
      }
      if (linkedIds.has(change.identity.remoteId)) {
        linkedCount += 1;
        continue;
      }
      if (change.fields.assignee) assigneeIds.add(change.fields.assignee.remoteId);
      if (mode === "future_only") continue;
      if (
        mode === undefined &&
        !isEligibleRedmineIssueImport(
          change,
          readMap[change.fields.statusId],
          claim.cutoff,
        )
      ) {
        continue;
      }
      candidates.push({
        remoteId: change.identity.remoteId,
        sourceVersion: change.sourceVersion,
      });
      if (!IssueState.safeParse(readMap[change.fields.statusId]).success) {
        unmappedStatusIds.add(change.fields.statusId);
      }
      if (!IssuePriority.safeParse(readMap[priorityReadKey(change.fields.priorityId)]).success) {
        unmappedPriorityIds.add(change.fields.priorityId);
      }
    }

    const identities = assigneeIds.size
      ? await prisma.integrationExternalIdentity.findMany({
          where: { bindingId, remoteUserId: { in: [...assigneeIds] } },
          select: {
            remoteUserId: true,
            memberId: true,
            member: { select: { workspaceId: true } },
          },
        })
      : [];
    const mappedAssignees = new Set(
      identities
        .filter((identity) => identity.member?.workspaceId === claim.connection.workspaceId)
        .map((identity) => identity.remoteUserId),
    );
    const unmappedAssigneeIds = new Set(evidence.unmappedAssigneeIds);
    for (const remoteId of assigneeIds) {
      if (!mappedAssignees.has(remoteId)) unmappedAssigneeIds.add(remoteId);
    }

    const nextOffset = evidence.nextOffset + page.changes.length;
    const commonEvidence = {
      complete: !page.hasMore,
      nextOffset,
      scannedCount: evidence.scannedCount + page.changes.length,
      excludedPrivateCount,
      linkedCount,
      checkpoint: storedCheckpoint(page.nextCheckpoint),
      candidates,
      unmappedStatusIds: sortRemoteIds(unmappedStatusIds),
      unmappedPriorityIds: sortRemoteIds(unmappedPriorityIds),
      unmappedAssigneeIds: sortRemoteIds(unmappedAssigneeIds),
    };
    evidence =
      evidence.version === 2
        ? {
            ...commonEvidence,
            version: 2,
            previewIdentity: evidence.previewIdentity,
            mode: evidence.mode,
            scopeFingerprint: reconciliationScopeFingerprint(
              claim,
              evidence.mode,
              [...assigneeIds],
              identities,
            ),
            cutoff: evidence.cutoff,
            remainingCount: Math.max(
              0,
              (value as { total_count: number }).total_count - nextOffset,
            ),
            assigneeRemoteIds: sortRemoteIds(assigneeIds),
          }
        : { ...commonEvidence, version: 1 };
    const persisted = await prisma.$transaction(async (transaction) => {
      await assertBootstrapMutationAvailable(transaction, bindingId);
      if (evidence.version === 2) {
        const current = await importBinding(
          transaction,
          connectionId,
          bindingId,
          userId,
          dependencies.allowedProjectIds,
          dependencies.workspaceId,
          true,
        );
        await assertReconciliationScope(transaction, current, evidence);
      }
      return transaction.integrationProjectBinding.updateMany({
        where: {
          id: bindingId,
          connectionId,
          lifecycle: claim.binding.lifecycle,
          lifecycleEpoch: claim.binding.lifecycleEpoch,
          bootstrapState: "pending",
          bootstrapLeaseToken: claim.leaseToken,
          bootstrapFence: claim.fence,
          connection: { lifecycle: claim.connection.lifecycle, lifecycleEpoch: claim.connection.lifecycleEpoch },
        },
        data: {
          bootstrapState: evidence.complete ? "previewed" : "pending",
          bootstrapPageToken: evidence as unknown as Prisma.InputJsonValue,
          bootstrapLeaseToken: null,
          bootstrapLeaseUntil: null,
        },
      });
    });
    if (persisted.count !== 1) {
      throw new AppError(409, "REDMINE_PREVIEW_STALE", "The Redmine project binding changed");
    }
    if (evidence.version === 1 && !evidence.complete) {
      throw new AppError(
        409,
        "REDMINE_IMPORT_LIMIT",
        "Run the Redmine import preview again to continue",
      );
    }
    const result = {
      cutoff: claim.cutoff,
      eligibleUnlinkedCount: evidence.candidates.length,
      excludedPrivateCount: evidence.excludedPrivateCount,
      linkedCount: evidence.linkedCount,
      mappingGaps: {
        statusIds: evidence.unmappedStatusIds,
        priorityIds: evidence.unmappedPriorityIds,
        assigneeRemoteUserIds: evidence.unmappedAssigneeIds,
      },
    };
    return evidence.version === 2
      ? {
          ...result,
          previewIdentity: evidence.previewIdentity,
          mode: evidence.mode,
          complete: evidence.complete,
          scannedCount: evidence.scannedCount,
          remainingCount: evidence.remainingCount,
          checkpoint: evidence.checkpoint,
        }
      : result;
  } catch (error) {
    const drifted = error instanceof RedminePaginationDriftError;
    await prisma.$transaction(async (transaction) => {
      await assertBootstrapMutationAvailable(transaction, bindingId);
      await transaction.integrationProjectBinding.updateMany({
        where: {
          id: bindingId,
          bootstrapState: "pending",
          bootstrapLeaseToken: claim.leaseToken,
          bootstrapFence: claim.fence,
        },
        data: {
          bootstrapLeaseToken: null,
          bootstrapLeaseUntil: null,
          ...(drifted
            ? {
                bootstrapState: "pending" as const,
                bootstrapPageToken: (evidence.version === 2
                  ? emptyEvidence({
                      mode: evidence.mode,
                      cutoff: claim.cutoff,
                      scopeFingerprint: reconciliationScopeFingerprint(claim, evidence.mode, [], []),
                    })
                  : emptyEvidence()) as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      });
    });
    if (drifted) {
      throw new AppError(
        409,
        "REDMINE_PREVIEW_STALE",
        "The Redmine issue set changed; the preview restarted from the first page",
      );
    }
    if (error instanceof AppError) throw error;
    throw remoteFailure();
  }
}

export async function activateRedmineIssueImport(
  connectionId: string,
  bindingId: string,
  userId: string,
  dependencies: RedmineImportDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date());
  const decrypt = dependencies.decrypt ?? decryptCredential;
  const createClient = dependencies.client ?? defaultClient;
  const claim = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid FOR UPDATE`,
    );
    const current = await importBinding(
      transaction,
      connectionId,
      bindingId,
      userId,
      dependencies.allowedProjectIds,
      dependencies.workspaceId,
      false,
      true,
    );
    const storedEvidence = PreviewEvidence.safeParse(current.binding.bootstrapPageToken);
    if (current.binding.inboundEnabled && current.binding.bootstrapState === "ready") {
      if (!storedEvidence.success || storedEvidence.data.version !== 2) {
        assertLifecycle(current.connection, current.binding, false);
      }
      return { kind: "ready" as const };
    }
    if (
      !["previewed", "bootstrapping"].includes(current.binding.bootstrapState) ||
      !current.binding.bootstrapCutoff
    ) {
      throw new AppError(
        409,
        "REDMINE_PREVIEW_REQUIRED",
        "Complete a Redmine import preview first",
      );
    }
    const evidence = parseEvidence(current.binding.bootstrapPageToken);
    if (evidence.version === 1) assertLifecycle(current.connection, current.binding, false);
    else {
      assertLifecycle(current.connection, current.binding, true);
      await assertReconciliationScope(transaction, current, evidence);
    }
    if (!evidence.complete) {
      throw new AppError(
        409,
        "REDMINE_PREVIEW_REQUIRED",
        "Complete a Redmine import preview first",
      );
    }
    if (evidence.version === 2 && evidence.mode === "full") {
      const mappingGap = evidence.unmappedStatusIds.length
        ? ["REDMINE_STATUS_UNMAPPED", "status"]
        : evidence.unmappedPriorityIds.length
          ? ["REDMINE_PRIORITY_UNMAPPED", "priority"]
          : evidence.unmappedAssigneeIds.length
            ? ["REDMINE_ASSIGNEE_UNMAPPED", "assignee"]
            : null;
      if (mappingGap) {
        throw new AppError(409, mappingGap[0]!, `Configure Redmine ${mappingGap[1]} mappings and run the preview again`);
      }
      const pending = await transaction.integrationReconciliationRecommendation.count({
        where: {
          bindingId,
          remoteIssueId: { in: evidence.candidates.map(({ remoteId }) => remoteId) },
          decisionState: "pending",
        },
      });
      if (pending > 0) {
        throw new AppError(409, "REDMINE_RECONCILIATION_PENDING", "Resolve pending Redmine reconciliation recommendations before importing");
      }
    }
    const readMap =
      current.binding.readMap &&
      typeof current.binding.readMap === "object" &&
      !Array.isArray(current.binding.readMap)
        ? (current.binding.readMap as Record<string, unknown>)
        : {};
    if (
      (evidence.version === 1 || (evidence.version === 2 && evidence.mode === "full")) &&
      (
        evidence.unmappedPriorityIds.length > 0 ||
        !Object.entries(readMap).some(
          ([key, value]) => key.startsWith("priority:") && IssuePriority.safeParse(value).success,
        )
      )
    ) {
      throw new AppError(409, "REDMINE_PRIORITY_UNMAPPED", "Configure Redmine priority mappings and run the preview again");
    }
    const claimedAt = now();
    if (
      current.binding.bootstrapLeaseToken &&
      current.binding.bootstrapLeaseUntil &&
      current.binding.bootstrapLeaseUntil > claimedAt
    ) {
      throw new AppError(
        409,
        "REDMINE_IMPORT_IN_PROGRESS",
        "A Redmine import activation is already running",
      );
    }
    await assertBootstrapMutationAvailable(transaction, bindingId);
    const linkedRemoteIds =
      evidence.version === 2 && evidence.candidates.length
        ? new Set(
            (
              await transaction.externalRef.findMany({
                where: {
                  connectionId,
                  entityType: "issue",
                  externalId: { in: evidence.candidates.map(({ remoteId }) => remoteId) },
                },
                select: { externalId: true },
              })
            ).map(({ externalId }) => externalId),
          )
        : new Set<string>();
    const activationEvidence =
      evidence.version === 2
        ? {
            ...evidence,
            candidates: evidence.candidates.filter(
              ({ remoteId }) => !linkedRemoteIds.has(remoteId),
            ),
          }
        : evidence;
    const candidates = activationEvidence.candidates.slice(0, ACTIVATION_BATCH_SIZE);
    const leaseToken = randomUUID();
    const binding = await transaction.integrationProjectBinding.update({
      where: { id: bindingId },
      data: {
        bootstrapState: "bootstrapping",
        bootstrapLeaseToken: leaseToken,
        bootstrapLeaseUntil: new Date(claimedAt.getTime() + BOOTSTRAP_LEASE_MS),
        bootstrapFence: { increment: 1 },
        bootstrapPageToken: activationEvidence as unknown as Prisma.InputJsonValue,
      },
      select: { bootstrapFence: true },
    });
    return {
      kind: "claimed" as const,
      current,
      evidence: activationEvidence,
      candidates,
      leaseToken,
      fence: binding.bootstrapFence,
    };
  });
  if (claim.kind === "ready") {
    return {
      importedCount: 0,
      issueKeys: [] as string[],
      replayed: true,
      complete: true,
      processedCount: 0,
      remainingCount: 0,
    };
  }

  try {
    const changes: RedmineIssueChange[] = [];
    if (claim.candidates.length) {
      const key = decryptServiceCredential(decrypt, claim.current.credential.encryptedKey);
      const client = createClient(claim.current.connection.baseUrl, key);
      try {
        for (const candidate of claim.candidates) {
          const value = await client.get<unknown>(
            `/issues/${encodeURIComponent(candidate.remoteId)}.json?include=journals`,
          );
          const change = decodeRedmineIssueDetail(
            value,
            claim.current.binding.remoteProjectId,
          ).issue;
          if (
            change.operation !== "upsert" ||
            change.identity.remoteId !== candidate.remoteId ||
            change.sourceVersion !== candidate.sourceVersion
          ) {
            throw new AppError(
              409,
              "REDMINE_PREVIEW_STALE",
              "A Redmine issue changed after preview; run the preview again",
            );
          }
          changes.push(change);
        }
      } catch (error) {
        if (error instanceof RedmineHttpError && error.statusCode === 404) {
          throw new AppError(
            409,
            "REDMINE_PREVIEW_STALE",
            "A previewed Redmine issue no longer exists; run the preview again",
          );
        }
        if (error instanceof AppError) throw error;
        throw remoteFailure();
      }
    }

    return await prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid FOR UPDATE`,
        );
        const locked = await importBinding(
          transaction,
          connectionId,
          bindingId,
          userId,
          dependencies.allowedProjectIds,
          dependencies.workspaceId,
          false,
          true,
        );
        if (locked.binding.inboundEnabled && locked.binding.bootstrapState === "ready") {
          return {
            importedCount: 0,
            issueKeys: [] as string[],
            replayed: true,
            complete: true,
            processedCount: 0,
            remainingCount: 0,
          };
        }
        if (
          locked.binding.bootstrapState !== "bootstrapping" ||
          locked.binding.bootstrapLeaseToken !== claim.leaseToken ||
          locked.binding.bootstrapFence !== claim.fence ||
          locked.binding.lifecycleEpoch !== claim.current.binding.lifecycleEpoch ||
          locked.binding.bootstrapCutoff?.getTime() !==
            claim.current.binding.bootstrapCutoff!.getTime() ||
          locked.credential.id !== claim.current.credential.id ||
          locked.credential.encryptedKey !== claim.current.credential.encryptedKey
        ) {
          throw new AppError(409, "REDMINE_PREVIEW_STALE", "The Redmine import preview changed");
        }
        const lockedEvidence = parseEvidence(locked.binding.bootstrapPageToken);
        if (lockedEvidence.version === 1) assertLifecycle(locked.connection, locked.binding, false);
        else {
          assertLifecycle(locked.connection, locked.binding, true);
          await assertReconciliationScope(transaction, locked, lockedEvidence);
        }
        if (
          !lockedEvidence.complete ||
          JSON.stringify(lockedEvidence) !== JSON.stringify(claim.evidence) ||
          JSON.stringify(lockedEvidence.candidates.slice(0, ACTIVATION_BATCH_SIZE)) !==
            JSON.stringify(claim.candidates)
        ) {
          throw new AppError(409, "REDMINE_PREVIEW_STALE", "The Redmine import preview changed");
        }

        const remoteIds = changes.map((change) => change.identity.remoteId);
        const existingRefs = remoteIds.length
          ? await transaction.externalRef.findMany({
              where: { connectionId, entityType: "issue", externalId: { in: remoteIds } },
              select: { id: true },
            })
          : [];
        if (existingRefs.length) {
          throw new AppError(
            409,
            "REDMINE_PREVIEW_STALE",
            "A previewed Redmine issue was linked concurrently",
          );
        }

        const issueKeys = await persistRedmineIssueImportsTx(
          transaction,
          {
            connectionId,
            bindingId,
            projectId: locked.binding.projectId,
            projectKey: locked.binding.project.key,
            workspaceId: locked.connection.workspaceId,
            readMap: locked.binding.readMap,
            provenance: "redmine-inbound-bootstrap",
          },
          changes,
        );

        const remainingCandidates = lockedEvidence.candidates.slice(claim.candidates.length);
        if (remainingCandidates.length) {
          await transaction.integrationProjectBinding.update({
            where: { id: bindingId },
            data: {
              bootstrapPageToken: {
                ...lockedEvidence,
                candidates: remainingCandidates,
              } as unknown as Prisma.InputJsonValue,
              bootstrapLeaseToken: null,
              bootstrapLeaseUntil: null,
            },
          });
          return {
            importedCount: issueKeys.length,
            issueKeys,
            replayed: false,
            complete: false,
            processedCount: claim.candidates.length,
            remainingCount: remainingCandidates.length,
          };
        }

        const activatedAt = now();
        const cursor = checkpoint(lockedEvidence.checkpoint) ?? {
          updatedAt: new Date(0),
          remoteId: "1",
          pageToken: null,
        };
        await transaction.integrationProjectBinding.update({
          where: { id: bindingId },
          data: {
            inboundEnabled: true,
            bootstrapState: "ready",
            bootstrapPageToken:
              lockedEvidence.version === 2
                ? ({ ...lockedEvidence, candidates: [] } as unknown as Prisma.InputJsonValue)
                : Prisma.DbNull,
            bootstrapLeaseToken: null,
            bootstrapLeaseUntil: null,
            cursorUpdatedAt: cursor.updatedAt,
            cursorRemoteId: cursor.remoteId,
            pageToken: null,
            pollLeaseToken: null,
            pollLeaseUntil: null,
            auditCursorRemoteId: lockedEvidence.checkpoint?.remoteId ?? null,
            auditCompletedAt: activatedAt,
          },
        });
        return {
          importedCount: issueKeys.length,
          issueKeys,
          replayed: false,
          complete: true,
          processedCount: claim.candidates.length,
          remainingCount: 0,
        };
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    const restartPreview = error instanceof AppError && error.code === "REDMINE_PREVIEW_STALE";
    await prisma.$transaction(async (transaction) => {
      await assertBootstrapMutationAvailable(transaction, bindingId);
      await transaction.integrationProjectBinding.updateMany({
        where: {
          id: bindingId,
          bootstrapState: "bootstrapping",
          bootstrapLeaseToken: claim.leaseToken,
          bootstrapFence: claim.fence,
        },
        data: {
          bootstrapLeaseToken: null,
          bootstrapLeaseUntil: null,
          ...(restartPreview
            ? {
                bootstrapState: "pending" as const,
                bootstrapPageToken: emptyEvidence() as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
      });
    });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const binding = await prisma.integrationProjectBinding.findFirst({
        where: { id: bindingId, releaseRequestedAt: null, releasedAt: null },
      });
      if (binding?.inboundEnabled && binding.bootstrapState === "ready") {
        return {
          importedCount: 0,
          issueKeys: [] as string[],
          replayed: true,
          complete: true,
          processedCount: 0,
          remainingCount: 0,
        };
      }
      throw new AppError(409, "REDMINE_IMPORT_RACE", "Redmine import raced with another write");
    }
    throw error;
  }
}
