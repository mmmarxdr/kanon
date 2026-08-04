import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { decrypt as decryptCredential } from "./core/crypto.js";
import type { PollCheckpoint } from "./core/types.js";
import { captureIssueMutationTx } from "./issue-tx.js";
import {
  decodeRedmineIssueDetail,
  decodeRedmineIssueListPage,
  type RedmineIssueChange,
} from "./providers/redmine/decoder.js";
import { RedmineHttpClient } from "./providers/redmine/http-client.js";
import { ownedConnection, serviceCredential } from "./service.js";

const PAGE_SIZE = 100;
// ponytail: one Redmine page avoids an unbounded candidate manifest and transaction.
const MAX_ISSUES = PAGE_SIZE;
const BOOTSTRAP_LEASE_MS = 120_000;
const IssueState = z.enum(["backlog", "analysis", "todo", "in_progress", "review", "done"]);
const Checkpoint = z
  .object({
    updatedAt: z.string().datetime(),
    remoteId: z.string().regex(/^\d+$/),
    pageToken: z.string().nullable(),
  })
  .strict();
const PreviewEvidence = z
  .object({
    version: z.literal(1),
    complete: z.boolean(),
    nextOffset: z.number().int().nonnegative().max(MAX_ISSUES),
    scannedCount: z.number().int().nonnegative().max(MAX_ISSUES),
    excludedPrivateCount: z.number().int().nonnegative().max(MAX_ISSUES),
    linkedCount: z.number().int().nonnegative().max(MAX_ISSUES),
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
      .max(MAX_ISSUES),
    unmappedStatusIds: z.array(z.string().regex(/^\d+$/)).max(MAX_ISSUES),
    unmappedAssigneeIds: z.array(z.string().regex(/^\d+$/)).max(MAX_ISSUES),
  })
  .strict();

type PreviewEvidence = z.infer<typeof PreviewEvidence>;
type Database = Prisma.TransactionClient;
type Client = Pick<RedmineHttpClient, "get">;

export interface RedmineIssueImportContext {
  readonly connectionId: string;
  readonly bindingId: string;
  readonly projectId: string;
  readonly projectKey: string;
  readonly workspaceId: string;
  readonly readMap: Prisma.JsonValue;
  readonly provenance: "redmine-inbound-bootstrap" | "redmine-inbound-discovery";
}

export interface RedmineImportDependencies {
  readonly now?: () => Date;
  readonly decrypt?: (ciphertext: string) => string;
  readonly client?: (baseUrl: string, apiKey: string) => Client;
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

function emptyEvidence(): PreviewEvidence {
  return {
    version: 1,
    complete: false,
    nextOffset: 0,
    scannedCount: 0,
    excludedPrivateCount: 0,
    linkedCount: 0,
    checkpoint: null,
    candidates: [],
    unmappedStatusIds: [],
    unmappedAssigneeIds: [],
  };
}

function assertActive(connection: { lifecycle: string }, binding: { lifecycle: string }): void {
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
) {
  const connection = await ownedConnection(database, connectionId, userId);
  if (connection.provider !== "redmine") {
    throw new AppError(400, "INVALID_INTEGRATION_PROVIDER", "Connection is not a Redmine integration");
  }
  const binding = await database.integrationProjectBinding.findFirst({
    where: { id: bindingId, connectionId },
    include: { project: { select: { key: true, workspaceId: true } } },
  });
  if (!binding) {
    throw new AppError(404, "INTEGRATION_BINDING_NOT_FOUND", "Integration project binding not found");
  }
  assertActive(connection, binding);
  const credential = await serviceCredential(database, connection);
  return { connection, binding, credential };
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

export async function persistRedmineIssueImportsTx(
  database: Database,
  context: RedmineIssueImportContext,
  changes: readonly RedmineIssueChange[],
): Promise<string[]> {
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
    return { change, fields: change.fields, state: state.data };
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
    const { change, fields, state } = entry;
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
        projectId: context.projectId,
        assigneeId,
        createdAt: change.createdAt ?? change.changedAt,
        completedAt: state === "done" ? (change.closedAt ?? change.changedAt) : null,
      },
    });
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
        fields: {
          title: issue.title,
          description: issue.description,
          state: issue.state,
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
        outcome: { provenance: context.provenance, issueKey: issue.key },
      },
    });
    issueKeys.push(issue.key);
  }

  return issueKeys;
}

export async function previewRedmineIssueImport(
  connectionId: string,
  bindingId: string,
  userId: string,
  dependencies: RedmineImportDependencies = {},
) {
  const now = dependencies.now ?? (() => new Date());
  const decrypt = dependencies.decrypt ?? decryptCredential;
  const createClient = dependencies.client ?? defaultClient;

  await importBinding(prisma, connectionId, bindingId, userId);
  const claim = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid FOR UPDATE`,
    );
    const current = await importBinding(transaction, connectionId, bindingId, userId);
    if (current.binding.inboundEnabled && current.binding.bootstrapState === "ready") {
      throw new AppError(409, "REDMINE_IMPORT_ACTIVE", "Redmine inbound import is already active");
    }
    const unsettledOutbound = await transaction.integrationSyncWork.count({
      where: {
        bindingId,
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
    const resumable = stored && stored.nextOffset < MAX_ISSUES ? stored : null;
    const evidence = resumable?.complete ? emptyEvidence() : (resumable ?? emptyEvidence());

    const cutoff = resumable ? current.binding.bootstrapCutoff! : claimedAt;
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
    const assigneeIds = new Set<string>();
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
      candidates.push({
        remoteId: change.identity.remoteId,
        sourceVersion: change.sourceVersion,
      });
      if (!IssueState.safeParse(readMap[change.fields.statusId]).success) {
        unmappedStatusIds.add(change.fields.statusId);
      }
      if (change.fields.assignee) assigneeIds.add(change.fields.assignee.remoteId);
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

    evidence = {
      version: 1,
      complete: !page.hasMore,
      nextOffset: evidence.nextOffset + page.changes.length,
      scannedCount: evidence.scannedCount + page.changes.length,
      excludedPrivateCount,
      linkedCount,
      checkpoint: storedCheckpoint(page.nextCheckpoint),
      candidates,
      unmappedStatusIds: sortRemoteIds(unmappedStatusIds),
      unmappedAssigneeIds: sortRemoteIds(unmappedAssigneeIds),
    };
    const persisted = await prisma.integrationProjectBinding.updateMany({
      where: {
        id: bindingId,
        connectionId,
        lifecycle: "active",
        lifecycleEpoch: claim.binding.lifecycleEpoch,
        bootstrapState: "pending",
        bootstrapLeaseToken: claim.leaseToken,
        bootstrapFence: claim.fence,
        connection: { lifecycle: "active" },
      },
      data: {
        bootstrapState: evidence.complete ? "previewed" : "pending",
        bootstrapPageToken: evidence as unknown as Prisma.InputJsonValue,
        bootstrapLeaseToken: evidence.complete ? null : claim.leaseToken,
        bootstrapLeaseUntil: evidence.complete
          ? null
          : new Date(now().getTime() + BOOTSTRAP_LEASE_MS),
      },
    });
    if (persisted.count !== 1) {
      throw new AppError(409, "REDMINE_PREVIEW_STALE", "The Redmine project binding changed");
    }
    if (!evidence.complete) {
      throw new AppError(
        409,
        "REDMINE_IMPORT_LIMIT",
        `Redmine import preview is limited to ${MAX_ISSUES} issues`,
      );
    }

    return {
      cutoff: claim.cutoff,
      eligibleUnlinkedCount: evidence.candidates.length,
      excludedPrivateCount: evidence.excludedPrivateCount,
      linkedCount: evidence.linkedCount,
      mappingGaps: {
        statusIds: evidence.unmappedStatusIds,
        assigneeRemoteUserIds: evidence.unmappedAssigneeIds,
      },
    };
  } catch (error) {
    await prisma.integrationProjectBinding.updateMany({
      where: {
        id: bindingId,
        bootstrapLeaseToken: claim.leaseToken,
        bootstrapFence: claim.fence,
      },
      data: { bootstrapLeaseToken: null, bootstrapLeaseUntil: null },
    });
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
  const current = await importBinding(prisma, connectionId, bindingId, userId);
  if (current.binding.inboundEnabled && current.binding.bootstrapState === "ready") {
    return { importedCount: 0, issueKeys: [] as string[], replayed: true };
  }
  if (current.binding.bootstrapState !== "previewed" || !current.binding.bootstrapCutoff) {
    throw new AppError(409, "REDMINE_PREVIEW_REQUIRED", "Complete a Redmine import preview first");
  }
  const evidence = parseEvidence(current.binding.bootstrapPageToken);
  if (!evidence.complete) {
    throw new AppError(409, "REDMINE_PREVIEW_REQUIRED", "Complete a Redmine import preview first");
  }

  const key = decryptServiceCredential(decrypt, current.credential.encryptedKey);
  const client = createClient(current.connection.baseUrl, key);
  const changes: RedmineIssueChange[] = [];
  try {
    for (const candidate of evidence.candidates) {
      const value = await client.get<unknown>(
        `/issues/${encodeURIComponent(candidate.remoteId)}.json?include=journals`,
      );
      const change = decodeRedmineIssueDetail(value, current.binding.remoteProjectId).issue;
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
    if (error instanceof AppError) throw error;
    throw remoteFailure();
  }

  try {
    return await prisma.$transaction(
      async (transaction) => {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid FOR UPDATE`,
        );
        const locked = await importBinding(transaction, connectionId, bindingId, userId);
        if (locked.binding.inboundEnabled && locked.binding.bootstrapState === "ready") {
          return { importedCount: 0, issueKeys: [] as string[], replayed: true };
        }
        if (
          locked.binding.bootstrapState !== "previewed" ||
          locked.binding.bootstrapFence !== current.binding.bootstrapFence ||
          locked.binding.lifecycleEpoch !== current.binding.lifecycleEpoch ||
          locked.binding.bootstrapCutoff?.getTime() !== current.binding.bootstrapCutoff!.getTime() ||
          locked.credential.id !== current.credential.id
        ) {
          throw new AppError(409, "REDMINE_PREVIEW_STALE", "The Redmine import preview changed");
        }
        const lockedEvidence = parseEvidence(locked.binding.bootstrapPageToken);
        if (
          !lockedEvidence.complete ||
          JSON.stringify(lockedEvidence.candidates) !== JSON.stringify(evidence.candidates)
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

        const activatedAt = now();
        const leaseToken = randomUUID();
        await transaction.integrationProjectBinding.update({
          where: { id: bindingId },
          data: {
            bootstrapState: "bootstrapping",
            bootstrapLeaseToken: leaseToken,
            bootstrapLeaseUntil: new Date(activatedAt.getTime() + BOOTSTRAP_LEASE_MS),
            bootstrapFence: { increment: 1 },
          },
        });

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

        const cursor = checkpoint(evidence.checkpoint) ?? {
          updatedAt: new Date(0),
          remoteId: "1",
          pageToken: null,
        };
        await transaction.integrationProjectBinding.update({
          where: { id: bindingId },
          data: {
            inboundEnabled: true,
            bootstrapState: "ready",
            bootstrapPageToken: Prisma.DbNull,
            bootstrapLeaseToken: null,
            bootstrapLeaseUntil: null,
            cursorUpdatedAt: cursor.updatedAt,
            cursorRemoteId: cursor.remoteId,
            pageToken: null,
            pollLeaseToken: null,
            pollLeaseUntil: null,
            auditCursorRemoteId: evidence.checkpoint?.remoteId ?? null,
            auditCompletedAt: activatedAt,
          },
        });
        return { importedCount: issueKeys.length, issueKeys, replayed: false };
      },
      { timeout: 30_000 },
    );
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      const binding = await prisma.integrationProjectBinding.findUnique({ where: { id: bindingId } });
      if (binding?.inboundEnabled && binding.bootstrapState === "ready") {
        return { importedCount: 0, issueKeys: [] as string[], replayed: true };
      }
      throw new AppError(409, "REDMINE_IMPORT_RACE", "Redmine import raced with another write");
    }
    throw error;
  }
}
