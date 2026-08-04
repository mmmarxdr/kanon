import { createHash, randomUUID } from "node:crypto";
import { Prisma, type PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { AppError } from "../../shared/types.js";
import { reconcileIssueTime } from "../issue/reconcile.js";
import { transitionIssue } from "../issue/service.js";
import { decrypt as decryptCredential } from "./core/crypto.js";
import {
  isProviderAuthenticationError,
  safeErrorEvidence,
  type InboundCursor,
  type InboundIssueStatusChange,
  type InboundSource,
  type StatusReadMap,
} from "./core/types.js";
import { persistRedmineIssueImportsTx } from "./redmine-import.js";
import {
  decodeRedmineIssueDetail,
  type RedmineIssueChange,
} from "./providers/redmine/decoder.js";
import { RedmineHttpClient } from "./providers/redmine/http-client.js";
import { RedminePollingInboundSource } from "./providers/redmine/inbound-source.js";

const DEFAULT_LIMIT = 10;
const DEFAULT_LEASE_MS = 120_000;
const FAILED_POLL_DELAY_MS = 60_000;
const MAX_DETAIL_READS = 10;

export interface InboundSyncLogger {
  info(context: unknown, message: string): void;
  warn(context: unknown, message: string): void;
  error(context: unknown, message: string): void;
}

interface InboundSourceOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly remoteProjectId: string;
  readonly readMap: StatusReadMap;
}

export interface InboundIssueDetailOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly remoteProjectId: string;
  readonly remoteIssueId: string;
}

export interface InboundSyncDependencies {
  readonly now?: () => Date;
  readonly decrypt?: (ciphertext: string) => string;
  readonly createSource?: (
    options: InboundSourceOptions,
  ) => InboundSource<InboundIssueStatusChange>;
  readonly loadIssueDetail?: (options: InboundIssueDetailOptions) => Promise<RedmineIssueChange>;
  readonly logger?: InboundSyncLogger;
  readonly limit?: number;
  readonly leaseMs?: number;
  readonly shouldStop?: () => boolean;
}

type ClaimedBinding = {
  readonly id: string;
  readonly connectionId: string;
  readonly projectId: string;
  readonly remoteProjectId: string;
  readonly readMap: Prisma.JsonValue;
  readonly lifecycleEpoch: number;
  readonly cursorUpdatedAt: Date | null;
  readonly cursorRemoteId: string | null;
  readonly pollLeaseToken: string;
  readonly pollFence: number;
  readonly baseUrl: string;
  readonly encryptedKey: string;
  readonly credentialId: string;
  readonly credentialLastValidatedAt: Date | null;
  readonly actorMemberId: string;
};

const defaultLogger: InboundSyncLogger = {
  info: (context, message) => console.info(message, context),
  warn: (context, message) => console.warn(message, context),
  error: (context, message) => console.error(message, context),
};

const defaultSource = (options: InboundSourceOptions) =>
  new RedminePollingInboundSource(
    new RedmineHttpClient(options.baseUrl, options.apiKey, {
      endpointAllowlist: env.REDMINE_ENDPOINT_ALLOWLIST,
    }),
    options,
  );

const defaultDetailLoader = async (options: InboundIssueDetailOptions) => {
  const client = new RedmineHttpClient(options.baseUrl, options.apiKey, {
    endpointAllowlist: env.REDMINE_ENDPOINT_ALLOWLIST,
  });
  const value = await client.get<unknown>(
    `/issues/${encodeURIComponent(options.remoteIssueId)}.json?include=journals`,
  );
  return decodeRedmineIssueDetail(value, options.remoteProjectId).issue;
};

function log(
  logger: InboundSyncLogger,
  level: keyof InboundSyncLogger,
  context: unknown,
  message: string,
) {
  try {
    logger[level](context, message);
  } catch {
    // Logging never changes durable sync state.
  }
}

async function claimBinding(
  database: PrismaClient,
  now: Date,
  leaseMs: number,
  excludedBindingIds: readonly string[],
): Promise<ClaimedBinding | null> {
  return database.$transaction(async (transaction) => {
    const exclusion = excludedBindingIds.length
      ? Prisma.sql`AND binding."id" NOT IN (${Prisma.join(
          excludedBindingIds.map((id) => Prisma.sql`${id}::uuid`),
        )})`
      : Prisma.empty;
    const [candidate] = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT binding."id"
      FROM "integration_project_bindings" AS binding
      JOIN "integration_connections" AS connection ON connection."id" = binding."connection_id"
      JOIN "member_integration_credentials" AS credential
        ON credential."id" = connection."service_credential_id"
      JOIN "members" AS member ON member."id" = credential."member_id"
      WHERE connection."provider" = 'redmine'
        AND connection."lifecycle" = 'active'::"IntegrationLifecycle"
        AND binding."lifecycle" = 'active'::"IntegrationLifecycle"
        AND binding."inbound_enabled" = true
        AND binding."bootstrap_state" = 'ready'::"IntegrationBootstrapState"
        AND credential."connection_id" = connection."id"
        AND credential."last_auth_status" = 'valid'::"CredentialAuthStatus"
        AND credential."revoked_at" IS NULL
        AND member."workspace_id" = connection."workspace_id"
        AND (binding."poll_lease_until" IS NULL OR binding."poll_lease_until" <= ${now})
        ${exclusion}
      ORDER BY binding."updated_at", binding."id"
      LIMIT 1
      FOR UPDATE OF connection, binding SKIP LOCKED
    `);
    if (!candidate) return null;

    const token = randomUUID();
    const binding = await transaction.integrationProjectBinding.update({
      where: { id: candidate.id },
      data: {
        pollLeaseToken: token,
        pollLeaseUntil: new Date(now.getTime() + leaseMs),
        pollFence: { increment: 1 },
      },
      include: { connection: true },
    });
    const credential = binding.connection.serviceCredentialId
      ? await transaction.memberIntegrationCredential.findUnique({
          where: { id: binding.connection.serviceCredentialId },
        })
      : null;
    if (!credential) throw new Error("Inbound service credential disappeared during claim");

    return {
      id: binding.id,
      connectionId: binding.connectionId,
      projectId: binding.projectId,
      remoteProjectId: binding.remoteProjectId,
      readMap: binding.readMap,
      lifecycleEpoch: binding.lifecycleEpoch,
      cursorUpdatedAt: binding.cursorUpdatedAt,
      cursorRemoteId: binding.cursorRemoteId,
      pollLeaseToken: token,
      pollFence: binding.pollFence,
      baseUrl: binding.connection.baseUrl,
      encryptedKey: credential.encryptedKey,
      credentialId: credential.id,
      credentialLastValidatedAt: credential.lastValidatedAt,
      actorMemberId: credential.memberId,
    };
  });
}

function applicationIdentity(bindingId: string, change: InboundIssueStatusChange): string {
  return createHash("sha256")
    .update(`${bindingId}|issue|${change.entityId}|${change.changedAt.toISOString()}`)
    .digest("hex");
}

function outboundIssueIds(description: string | null): string[] {
  if (!description) return [];
  return [...description.matchAll(/<!-- kanon-issue:([0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}) -->/gi)].map(
    (match) => match[1]!,
  );
}

async function lockPollSnapshot(
  transaction: Prisma.TransactionClient,
  binding: ClaimedBinding,
) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "integration_connections" WHERE "id" = ${binding.connectionId}::uuid FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${binding.id}::uuid FOR UPDATE`,
  );
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "member_integration_credentials" WHERE "id" = ${binding.credentialId}::uuid FOR UPDATE`,
  );
  const active = await transaction.integrationProjectBinding.findFirst({
    where: {
      id: binding.id,
      connectionId: binding.connectionId,
      lifecycle: "active",
      inboundEnabled: true,
      bootstrapState: "ready",
      lifecycleEpoch: binding.lifecycleEpoch,
      pollLeaseToken: binding.pollLeaseToken,
      pollFence: binding.pollFence,
      connection: { lifecycle: "active" },
    },
    include: {
      project: { select: { key: true } },
      connection: { select: { serviceCredentialId: true, workspaceId: true } },
    },
  });
  if (!active) return null;

  const credential = await transaction.memberIntegrationCredential.findUnique({
    where: { id: binding.credentialId },
    select: {
      connectionId: true,
      encryptedKey: true,
      lastAuthStatus: true,
      lastValidatedAt: true,
      revokedAt: true,
    },
  });
  const sameValidation =
    credential?.lastValidatedAt?.getTime() === binding.credentialLastValidatedAt?.getTime() ||
    (credential?.lastValidatedAt === null && binding.credentialLastValidatedAt === null);
  if (
    !credential ||
    active.connection.serviceCredentialId !== binding.credentialId ||
    credential.connectionId !== binding.connectionId ||
    credential.encryptedKey !== binding.encryptedKey ||
    !sameValidation ||
    credential.lastAuthStatus !== "valid" ||
    credential.revokedAt !== null
  ) {
    throw new AppError(
      409,
      "INBOUND_CREDENTIAL_STALE",
      "Inbound service credential changed during polling",
    );
  }
  return active;
}

async function finishApplication(
  database: PrismaClient,
  applicationId: string,
  refId: string,
  correlationId: string,
  change: InboundIssueStatusChange,
  outcome: Prisma.InputJsonObject,
  workId: string | null,
  changed: boolean,
) {
  await database.$transaction(async (transaction) => {
    await transaction.externalRef.updateMany({
      where: {
        id: refId,
        OR: [{ remoteUpdatedAt: null }, { remoteUpdatedAt: { lt: change.changedAt } }],
      },
      data: {
        remoteUpdatedAt: change.changedAt,
        lastCorrelationId: correlationId,
        ...(changed ? { localVersion: { increment: 1 } } : {}),
      },
    });
    await transaction.integrationInboundApplication.update({
      where: { id: applicationId },
      data: { state: "applied", refId, workId, outcome },
    });
  });
}

async function conflictApplication(
  database: PrismaClient,
  applicationId: string,
  binding: ClaimedBinding,
  refId: string,
  change: InboundIssueStatusChange,
  issue: { id: string; key: string; state: string } | null,
  error: AppError,
) {
  const localEvidence: Prisma.InputJsonObject = {
    issueId: issue?.id ?? null,
    issueKey: issue?.key ?? null,
    currentState: issue?.state ?? null,
    requestedState: change.state,
    reason: error.code,
  };
  const remoteEvidence: Prisma.InputJsonObject = {
    provider: "redmine",
    remoteIssueId: change.entityId,
    remoteVersion: change.remoteVersion,
    requestedState: change.state,
  };
  await database.$transaction(async (transaction) => {
    await transaction.integrationConflict.create({
      data: {
        kind: "inbound-status-transition",
        bindingId: binding.id,
        applicationId,
        refId,
        localEvidence,
        remoteEvidence,
      },
    });
    await transaction.integrationInboundApplication.update({
      where: { id: applicationId },
      data: {
        state: "conflict",
        refId,
        outcome: { reason: error.code, message: error.message },
      },
    });
  });
}

async function applyChange(
  database: PrismaClient,
  binding: ClaimedBinding,
  change: InboundIssueStatusChange,
  loadIssueDetail: (options: InboundIssueDetailOptions) => Promise<RedmineIssueChange>,
  apiKey: string,
  allowDetail: boolean,
) {
  const ref = await database.externalRef.findUnique({
    where: {
      connectionId_entityType_externalId: {
        connectionId: binding.connectionId,
        entityType: "issue",
        externalId: change.entityId,
      },
    },
  });
  if (!ref) {
    if (!allowDetail) return "detail-limit" as const;
    const detail = await loadIssueDetail({
      baseUrl: binding.baseUrl,
      apiKey,
      remoteProjectId: binding.remoteProjectId,
      remoteIssueId: change.entityId,
    });
    if (
      detail.identity.remoteId !== change.entityId ||
      detail.identity.remoteProjectId !== binding.remoteProjectId ||
      detail.changedAt < change.changedAt
    ) {
      throw new Error("Redmine issue detail did not match the poll observation");
    }
    if (detail.operation === "tombstone") return "detail" as const;

    return database.$transaction(async (transaction) => {
      const active = await lockPollSnapshot(transaction, binding);
      if (!active) return "stale" as const;

      const linked = await transaction.externalRef.findUnique({
        where: {
          connectionId_entityType_externalId: {
            connectionId: binding.connectionId,
            entityType: "issue",
            externalId: change.entityId,
          },
        },
        select: { id: true },
      });
      if (linked) return "detail" as const;

      const localIssueIds =
        "description" in detail.fields ? outboundIssueIds(detail.fields.description) : [];
      const outboundCreate = localIssueIds.length
        ? await transaction.integrationSyncWork.findFirst({
            where: {
              bindingId: binding.id,
              entityType: "issue",
              entityId: { in: localIssueIds },
              direction: "outbound",
              operation: "create",
              state: { in: ["queued", "retry", "leased", "ambiguous"] },
            },
            select: { id: true },
          })
        : null;
      if (outboundCreate) {
        throw new AppError(
          409,
          "OUTBOUND_CREATE_UNSETTLED",
          "Outbound issue creation is awaiting finalization",
        );
      }

      await persistRedmineIssueImportsTx(
        transaction,
        {
          connectionId: binding.connectionId,
          bindingId: binding.id,
          projectId: binding.projectId,
          projectKey: active.project.key,
          workspaceId: active.connection.workspaceId,
          readMap: active.readMap,
          provenance: "redmine-inbound-discovery",
        },
        [detail],
      );
      return "detail" as const;
    });
  }

  if (ref.remoteUpdatedAt && ref.remoteUpdatedAt >= change.changedAt) {
    const imported = await database.integrationInboundApplication.findFirst({
      where: {
        bindingId: binding.id,
        refId: ref.id,
        state: "applied",
        sourceVersion: { not: null },
        remoteUpdatedAt: { gte: change.changedAt },
      },
      select: { id: true },
    });
    if (imported) return "processed" as const;
  }

  const correlationId = applicationIdentity(binding.id, change);
  await database.integrationInboundApplication.createMany({
    data: {
      bindingId: binding.id,
      remoteEntityType: "issue",
      remoteId: change.entityId,
      remoteUpdatedAt: change.changedAt,
      applicationKey: correlationId,
      correlationId,
      refId: ref.id,
    },
    skipDuplicates: true,
  });
  const application = await database.integrationInboundApplication.findUniqueOrThrow({
    where: { applicationKey: correlationId },
  });
  if (["applied", "conflict", "skipped"].includes(application.state)) {
    return "processed" as const;
  }

  if (ref.bindingId !== binding.id) {
    await conflictApplication(
      database,
      application.id,
      binding,
      ref.id,
      change,
      null,
      new AppError(
        409,
        "REFERENCE_BINDING_MISMATCH",
        "External reference belongs to another binding",
      ),
    );
    return "processed" as const;
  }
  if (ref.remoteUpdatedAt && ref.remoteUpdatedAt >= change.changedAt) {
    await database.integrationInboundApplication.update({
      where: { id: application.id },
      data: {
        state: "skipped",
        refId: ref.id,
        outcome: {
          reason: "stale-or-correlated-echo",
          baselineRemoteVersion: ref.remoteUpdatedAt.toISOString(),
        },
      },
    });
    return "processed" as const;
  }

  const issue = await database.issue.findFirst({
    where: { id: ref.entityId, projectId: binding.projectId },
    select: { id: true, key: true, state: true },
  });
  if (!issue) {
    await conflictApplication(
      database,
      application.id,
      binding,
      ref.id,
      change,
      null,
      new AppError(409, "LOCAL_ISSUE_MISSING", "Linked Kanon issue no longer exists"),
    );
    return "processed" as const;
  }

  let timeReconciled = false;
  let reportedTotalHours: number | null = null;
  const changed = issue.state !== change.state;
  if (changed) {
    const transition = () =>
      transitionIssue(
        issue.key,
        change.state,
        binding.actorMemberId,
        "redmine-inbound",
        undefined,
        {
          bindingId: binding.id,
          direction: "inbound",
          operation: change.operation,
          actorKey: `redmine:issue:${change.entityId}`,
          actorKind: "remote",
          correlationId,
          refId: ref.id,
        },
      );
    try {
      await transition();
    } catch (error) {
      if (!(error instanceof AppError)) throw error;
      if (error.code !== "RECONCILIATION_REQUIRED") {
        await conflictApplication(database, application.id, binding, ref.id, change, issue, error);
        return "processed" as const;
      }
      try {
        const reconciled = await reconcileIssueTime(issue.id, binding.actorMemberId);
        timeReconciled = true;
        reportedTotalHours = reconciled.totalHours;
        await database.activityLog.create({
          data: {
            issueId: issue.id,
            memberId: binding.actorMemberId,
            action: "edited",
            via: "redmine-inbound",
            details: {
              integration: "redmine",
              action: "accepted_reported_time",
              totalHours: reconciled.totalHours,
              correlationId,
            },
          },
        });
        await transition();
      } catch (retryError) {
        if (!(retryError instanceof AppError)) throw retryError;
        await conflictApplication(
          database,
          application.id,
          binding,
          ref.id,
          change,
          issue,
          retryError,
        );
        return "processed" as const;
      }
    }
  }

  const work = await database.integrationSyncWork.findFirst({
    where: { bindingId: binding.id, direction: "inbound", correlationId },
    select: { id: true },
  });
  await finishApplication(
    database,
    application.id,
    ref.id,
    correlationId,
    change,
    {
      from: issue.state,
      to: change.state,
      changed,
      timeReconciled,
      reportedTotalHours,
      provenance: "redmine-inbound",
    },
    work?.id ?? null,
    changed,
  );
  return "processed" as const;
}

async function pollBinding(
  database: PrismaClient,
  binding: ClaimedBinding,
  dependencies: Required<
    Pick<
      InboundSyncDependencies,
      "decrypt" | "createSource" | "loadIssueDetail" | "logger" | "now"
    >
  > & { leaseMs: number },
) {
  const readMap = binding.readMap;
  if (!readMap || typeof readMap !== "object" || Array.isArray(readMap)) {
    throw new Error("Invalid inbound status map");
  }
  const apiKey = dependencies.decrypt(binding.encryptedKey);
  const source = dependencies.createSource({
    baseUrl: binding.baseUrl,
    apiKey,
    remoteProjectId: binding.remoteProjectId,
    readMap: readMap as StatusReadMap,
  });
  const cursor: InboundCursor | null =
    binding.cursorUpdatedAt && binding.cursorRemoteId
      ? { updatedAt: binding.cursorUpdatedAt, entityId: binding.cursorRemoteId }
      : null;
  const page = await source.poll(cursor);
  if (page.hasMore) throw new Error("Inbound source returned an incomplete poll page");
  if (!(await database.$transaction((transaction) => lockPollSnapshot(transaction, binding)))) {
    return;
  }

  let detailReads = 0;
  let processedChanges = 0;
  let processedCursor = cursor;
  for (const change of page.changes) {
    const active = await database.integrationProjectBinding.updateMany({
      where: {
        id: binding.id,
        lifecycle: "active",
        inboundEnabled: true,
        bootstrapState: "ready",
        lifecycleEpoch: binding.lifecycleEpoch,
        pollLeaseToken: binding.pollLeaseToken,
        pollFence: binding.pollFence,
        connection: { lifecycle: "active" },
      },
      data: {
        pollLeaseUntil: new Date(dependencies.now().getTime() + dependencies.leaseMs),
      },
    });
    if (active.count !== 1) return;
    let result;
    try {
      result = await applyChange(
        database,
        binding,
        change,
        dependencies.loadIssueDetail,
        apiKey,
        detailReads < MAX_DETAIL_READS,
      );
    } catch (error) {
      log(
        dependencies.logger,
        "warn",
        { bindingId: binding.id, remoteIssueId: change.entityId, error: safeErrorEvidence(error) },
        "Inbound Redmine issue processing failed",
      );
      throw error;
    }
    if (result === "stale") return;
    if (result === "detail-limit") break;
    if (result === "detail") detailReads += 1;
    processedChanges += 1;
    processedCursor = { updatedAt: change.changedAt, entityId: change.entityId };
  }

  const advanced = await database.$transaction(async (transaction) => {
    if (!(await lockPollSnapshot(transaction, binding))) return false;
    await transaction.integrationProjectBinding.update({
      where: { id: binding.id },
      data: {
        cursorUpdatedAt: processedCursor?.updatedAt ?? null,
        cursorRemoteId: processedCursor?.entityId ?? null,
        pageToken: null,
        pollLeaseToken: null,
        pollLeaseUntil: null,
      },
    });
    return true;
  });
  if (advanced) {
    log(
      dependencies.logger,
      "info",
      {
        bindingId: binding.id,
        changes: processedChanges,
        detailReads,
        partial: processedChanges < page.changes.length,
      },
      "Inbound Redmine poll completed",
    );
  }
}

async function rejectCredential(database: PrismaClient, binding: ClaimedBinding) {
  await database.memberIntegrationCredential.updateMany({
    where: {
      id: binding.credentialId,
      encryptedKey: binding.encryptedKey,
      lastAuthStatus: "valid",
      revokedAt: null,
      lastValidatedAt: binding.credentialLastValidatedAt,
    },
    data: { lastAuthStatus: "invalid" },
  });
  await database.integrationProjectBinding.updateMany({
    where: {
      id: binding.id,
      pollLeaseToken: binding.pollLeaseToken,
      pollFence: binding.pollFence,
    },
    data: { pollLeaseToken: null, pollLeaseUntil: null },
  });
}

export async function runInboundSyncCycle(
  database: PrismaClient,
  dependencies: InboundSyncDependencies = {},
) {
  const limit = dependencies.limit ?? DEFAULT_LIMIT;
  const leaseMs = dependencies.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("inbound limit must be positive");
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
    throw new RangeError("inbound leaseMs must be positive");
  }
  const d = {
    decrypt: dependencies.decrypt ?? decryptCredential,
    createSource: dependencies.createSource ?? defaultSource,
    loadIssueDetail: dependencies.loadIssueDetail ?? defaultDetailLoader,
    logger: dependencies.logger ?? defaultLogger,
    now: dependencies.now ?? (() => new Date()),
    leaseMs,
  };
  const attemptedBindingIds: string[] = [];

  for (let remaining = limit; remaining > 0 && !dependencies.shouldStop?.(); remaining -= 1) {
    const now = d.now();
    const binding = await claimBinding(database, now, leaseMs, attemptedBindingIds);
    if (!binding) break;
    attemptedBindingIds.push(binding.id);
    try {
      await pollBinding(database, binding, d);
    } catch (error) {
      if (isProviderAuthenticationError(error)) {
        await rejectCredential(database, binding);
      } else {
        await database.integrationProjectBinding.updateMany({
          where: {
            id: binding.id,
            pollLeaseToken: binding.pollLeaseToken,
            pollFence: binding.pollFence,
          },
          data: {
            pollLeaseToken: null,
            pollLeaseUntil: new Date(d.now().getTime() + FAILED_POLL_DELAY_MS),
          },
        });
      }
      log(
        d.logger,
        "error",
        { bindingId: binding.id, credentialId: binding.credentialId, error: safeErrorEvidence(error) },
        "Inbound Redmine poll failed",
      );
    }
  }
}

export function createInboundSyncCycle(
  database: PrismaClient,
  dependencies: InboundSyncDependencies = {},
) {
  let running: Promise<void> | undefined;
  let stopped = false;
  const run = (() => {
    if (stopped) return running ?? Promise.resolve();
    return (running ??= runInboundSyncCycle(database, {
      ...dependencies,
      shouldStop: () => stopped || dependencies.shouldStop?.() === true,
    }).finally(() => {
      running = undefined;
    }));
  }) as (() => Promise<void>) & { stop(): void };
  run.stop = () => {
    stopped = true;
  };
  return run;
}
