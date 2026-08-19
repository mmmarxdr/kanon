import { createHash, randomUUID } from "node:crypto";
import { Prisma, type IssuePriority, type IssueState, type PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import type { IssueTransitionedPayload } from "../../services/event-bus/types.js";
import { AppError } from "../../shared/types.js";
import { checkAndAdvanceParent } from "../issue/auto-transition.js";
import { validateTransition } from "../issue/state-machine.js";
import { reconcileIssueTime } from "../issue/reconcile.js";
import { createCommentWithActivityTx } from "../comment/service.js";
import { syncRoadmapItemStatus } from "../roadmap/roadmap-sync.js";
import { SESSION_TTL_MS } from "../work-session/service.js";
import { decrypt as decryptCredential } from "./core/crypto.js";
import {
  isProviderAuthenticationError,
  isRetryableProviderError,
  safeErrorEvidence,
  type InboundCursor,
  type InboundIssueStatusChange,
  type InboundSource,
  type StatusReadMap,
} from "./core/types.js";
import {
  canonicalRedmineDescription,
  ISSUE_SYNC_FIELDS,
  issueSyncMetadata,
  priorityReadKey,
  readBlockedIssueFields,
  readIssueSyncBaseline,
  reconcileIssueSnapshots,
  type IssueFieldConflict,
  type IssueSyncField,
  type IssueSyncSnapshot,
  type IssueSyncValue,
} from "./issue-convergence.js";
import { captureIntegrationWorkTx } from "./outbox.js";
import {
  completeRetriedApplicationTx,
  isEligibleRedmineIssueImport,
  persistRedmineIssueImportsTx,
  type InboundApplicationClaim,
  type RedmineImportDependencies,
  type RedmineIssueImportContext,
} from "./redmine-import.js";
import {
  decodeRedmineIssueDetail,
  type RedmineCommentChange,
  type RedmineIssueChange,
} from "./providers/redmine/decoder.js";
import { parseCommentMarker } from "./providers/redmine/comment-marker.js";
import { RedmineHttpClient } from "./providers/redmine/http-client.js";
import { RedminePollingInboundSource } from "./providers/redmine/inbound-source.js";
import { ownedConnection, serviceCredential } from "./service.js";

const DEFAULT_LIMIT = 10;
const DEFAULT_LEASE_MS = 120_000;
const FAILED_POLL_DELAY_MS = 60_000;
const MAX_DETAIL_READS = 10;
const RETRY_LEASE_MS = 120_000;
const REDMINE_INBOUND_COMMENT_VIA = "redmine-inbound";

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

type InboundIssueDetail = RedmineIssueChange & {
  readonly comments?: readonly RedmineCommentChange[];
};

export interface InboundSyncDependencies {
  readonly now?: () => Date;
  readonly decrypt?: (ciphertext: string) => string;
  readonly createSource?: (
    options: InboundSourceOptions,
  ) => InboundSource<InboundIssueStatusChange>;
  readonly loadIssueDetail?: (options: InboundIssueDetailOptions) => Promise<InboundIssueDetail>;
  readonly logger?: InboundSyncLogger;
  readonly limit?: number;
  readonly leaseMs?: number;
  readonly shouldStop?: () => boolean;
}

export type BindingPollLease = {
  readonly id: string;
  readonly connectionId: string;
  readonly projectId: string;
  readonly remoteProjectId: string;
  readonly readMap: Prisma.JsonValue;
  readonly lifecycleEpoch: number;
  readonly cursorUpdatedAt: Date | null;
  readonly cursorRemoteId: string | null;
  readonly bootstrapCutoff: Date;
  readonly pollLeaseToken: string;
  readonly pollFence: number;
  readonly baseUrl: string;
  readonly encryptedKey: string;
  readonly credentialId: string;
  readonly credentialLastValidatedAt: Date | null;
};

export type ClaimedBinding = BindingPollLease & {
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
  const decoded = decodeRedmineIssueDetail(value, options.remoteProjectId);
  return { ...decoded.issue, comments: decoded.comments };
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

export async function claimBindingPollLease(
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
      JOIN "projects" AS project ON project."id" = binding."project_id"
      JOIN "member_integration_credentials" AS credential
        ON credential."id" = connection."service_credential_id"
      JOIN "members" AS member ON member."id" = credential."member_id"
      WHERE connection."provider" = 'redmine'
        AND connection."lifecycle" = 'active'::"IntegrationLifecycle"
        AND binding."lifecycle" = 'active'::"IntegrationLifecycle"
        AND binding."released_at" IS NULL
        AND binding."release_requested_at" IS NULL
        AND project."archived" = false
        AND binding."inbound_enabled" = true
        AND binding."bootstrap_state" = 'ready'::"IntegrationBootstrapState"
        AND binding."bootstrap_cutoff" IS NOT NULL
        AND credential."connection_id" = connection."id"
        AND credential."last_auth_status" = 'valid'::"CredentialAuthStatus"
        AND credential."revoked_at" IS NULL
        AND member."workspace_id" = connection."workspace_id"
        AND member."role" = 'owner'
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
    if (!binding.bootstrapCutoff) throw new Error("Inbound binding cutoff disappeared during claim");

    return {
      id: binding.id,
      connectionId: binding.connectionId,
      projectId: binding.projectId,
      remoteProjectId: binding.remoteProjectId,
      readMap: binding.readMap,
      lifecycleEpoch: binding.lifecycleEpoch,
      cursorUpdatedAt: binding.cursorUpdatedAt,
      cursorRemoteId: binding.cursorRemoteId,
      bootstrapCutoff: binding.bootstrapCutoff,
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

export async function renewBindingPollLease(
  database: PrismaClient,
  binding: BindingPollLease,
  pollLeaseUntil: Date,
): Promise<boolean> {
  const result = await database.integrationProjectBinding.updateMany({
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
    data: { pollLeaseUntil },
  });
  return result.count === 1;
}

export async function releaseBindingPollLease(
  database: PrismaClient,
  binding: BindingPollLease,
  pollLeaseUntil: Date | null = null,
): Promise<boolean> {
  const result = await database.integrationProjectBinding.updateMany({
    where: {
      id: binding.id,
      pollLeaseToken: binding.pollLeaseToken,
      pollFence: binding.pollFence,
    },
    data: { pollLeaseToken: null, pollLeaseUntil },
  });
  return result.count === 1;
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

export async function lockPollSnapshot(
  transaction: Prisma.TransactionClient,
  binding: BindingPollLease,
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
      releasedAt: null,
      releaseRequestedAt: null,
      inboundEnabled: true,
      bootstrapState: "ready",
      lifecycleEpoch: binding.lifecycleEpoch,
      remoteProjectId: binding.remoteProjectId,
      pollLeaseToken: binding.pollLeaseToken,
      pollFence: binding.pollFence,
      connection: { lifecycle: "active" },
      project: { archived: false },
    },
    include: {
      project: { select: { key: true } },
      connection: { select: { serviceCredentialId: true, workspaceId: true, baseUrl: true } },
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
    active.connection.baseUrl !== binding.baseUrl ||
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

const ISSUE_STATES = new Set<IssueState>([
  "backlog",
  "analysis",
  "todo",
  "in_progress",
  "review",
  "done",
]);
const ISSUE_PRIORITIES = new Set<IssuePriority>(["critical", "high", "medium", "low"]);

function jsonObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function dateOnly(value: Date | null | undefined): string | null {
  return value?.toISOString().slice(0, 10) ?? null;
}

async function databaseNow(transaction: Prisma.TransactionClient): Promise<Date> {
  const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>(
    Prisma.sql`SELECT clock_timestamp() AS "now"`,
  );
  if (!clock) throw new Error("Database clock unavailable");
  return clock.now;
}

async function recordInboundFailure(
  database: PrismaClient,
  binding: ClaimedBinding,
  change: InboundIssueStatusChange,
  refId: string | null,
  error: unknown,
  sourceVersion: string | null = null,
) {
  const correlationId = applicationIdentity(binding.id, change);
  return database.$transaction(async (transaction) => {
    if (!(await lockPollSnapshot(transaction, binding))) return "stale" as const;
    const created = await transaction.integrationInboundApplication.createMany({
      data: {
        bindingId: binding.id,
        remoteEntityType: "issue",
        remoteId: change.entityId,
        remoteUpdatedAt: change.changedAt,
        sourceVersion,
        applicationKey: correlationId,
        correlationId,
        refId,
      },
      skipDuplicates: true,
    });
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "integration_inbound_applications" WHERE "application_key" = ${correlationId} FOR UPDATE`,
    );
    const application = await transaction.integrationInboundApplication.findUniqueOrThrow({
      where: { applicationKey: correlationId },
    });
    const activeClaim =
      created.count === 0 &&
      application.state === "claimed" &&
      application.leaseToken !== null &&
      application.leaseUntil !== null &&
      application.leaseUntil > (await databaseNow(transaction));
    if (
      ["applied", "conflict", "skipped"].includes(application.state) ||
      activeClaim
    ) {
      return "detail" as const;
    }

    const remoteEvidence = {
      provider: "redmine",
      remoteIssueId: change.entityId,
      remoteVersion: change.remoteVersion,
      error: safeErrorEvidence(error),
    };
    const retained = await transaction.integrationConflict.updateMany({
      where: {
        applicationId: application.id,
        kind: "inbound-observation-failure",
        state: "open",
      },
      data: { refId, localEvidence: { refId }, remoteEvidence },
    });
    if (retained.count === 0) {
      await transaction.integrationConflict.create({
        data: {
          kind: "inbound-observation-failure",
          bindingId: binding.id,
          applicationId: application.id,
          refId,
          localEvidence: { refId },
          remoteEvidence,
        },
      });
    }
    if (refId) {
      await transaction.externalRef.updateMany({
        where: { id: refId, bindingId: binding.id },
        data: { remoteUpdatedAt: change.changedAt, lastCorrelationId: correlationId },
      });
    }
    await transaction.integrationInboundApplication.update({
      where: { id: application.id },
      data: {
        state: "conflict",
        leaseToken: null,
        leaseUntil: null,
        refId,
        outcome: { reason: "INBOUND_OBSERVATION_FAILED", error: safeErrorEvidence(error) },
      },
    });
    return "detail" as const;
  });
}

async function recordHistoricalClosedIssue(
  database: PrismaClient,
  binding: ClaimedBinding,
  change: InboundIssueStatusChange,
  detail: InboundIssueDetail,
) {
  const correlationId = applicationIdentity(binding.id, {
    ...change,
    changedAt: detail.changedAt,
  });
  return database.$transaction(async (transaction) => {
    if (!(await lockPollSnapshot(transaction, binding))) return "stale" as const;
    await transaction.integrationInboundApplication.createMany({
      data: {
        bindingId: binding.id,
        remoteEntityType: "issue",
        remoteId: change.entityId,
        remoteUpdatedAt: detail.changedAt,
        sourceVersion: detail.sourceVersion,
        applicationKey: correlationId,
        correlationId,
        state: "skipped",
        outcome: {
          reason: "pre-activation-closed-history",
          cutoff: binding.bootstrapCutoff.toISOString(),
          provenance: "redmine-inbound-discovery",
        },
      },
      skipDuplicates: true,
    });
    return "detail" as const;
  });
}

async function persistInboundCommentsTx(
  transaction: Prisma.TransactionClient,
  binding: Pick<ClaimedBinding, "id" | "connectionId">,
  issueId: string,
  remoteIssueId: string,
  comments: readonly RedmineCommentChange[],
) {
  for (const change of comments) {
    const correlationId = createHash("sha256")
      .update(`${binding.id}|comment|${change.identity.remoteId}|${change.sourceVersion}`)
      .digest("hex");

    const existing = await transaction.externalRef.findUnique({
      where: {
        connectionId_entityType_externalId: {
          connectionId: binding.connectionId,
          entityType: "comment",
          externalId: change.identity.remoteId,
        },
      },
    });

    if (change.operation !== "upsert" || !("body" in change.fields)) {
      if (!existing) {
        await transaction.integrationInboundApplication.createMany({
          data: {
            bindingId: binding.id,
            remoteEntityType: "comment",
            remoteParentType: "issue",
            remoteParentId: remoteIssueId,
            remoteId: change.identity.remoteId,
            remoteUpdatedAt: change.changedAt,
            sourceVersion: change.sourceVersion,
            applicationKey: correlationId,
            correlationId,
            state: "skipped",
            outcome: { reason: "private-comment" },
          },
          skipDuplicates: true,
        });
        continue;
      }

      await transaction.integrationInboundApplication.createMany({
        data: {
          bindingId: binding.id,
          remoteEntityType: "comment",
          remoteParentType: "issue",
          remoteParentId: remoteIssueId,
          remoteId: change.identity.remoteId,
          remoteUpdatedAt: change.changedAt,
          sourceVersion: change.sourceVersion,
          applicationKey: correlationId,
          correlationId,
          refId: existing.id,
        },
        skipDuplicates: true,
      });
      const application = await transaction.integrationInboundApplication.findFirstOrThrow({
        where: {
          OR: [
            { applicationKey: correlationId },
            {
              bindingId: binding.id,
              remoteEntityType: "comment",
              remoteParentType: "issue",
              remoteParentId: remoteIssueId,
              remoteId: change.identity.remoteId,
              sourceVersion: change.sourceVersion,
            },
          ],
        },
      });
      if (application.state === "applied" || application.state === "conflict") continue;
      if (existing.remoteUpdatedAt && existing.remoteUpdatedAt > change.changedAt) {
        await transaction.integrationInboundApplication.update({
          where: { id: application.id },
          data: {
            state: "skipped",
            refId: existing.id,
            outcome: {
              reason: "stale-private-comment",
              observedRemoteVersion: existing.remoteUpdatedAt.toISOString(),
            },
          },
        });
        continue;
      }

      const comment = await transaction.comment.findFirst({
        where: { id: existing.entityId, issueId },
        select: { id: true, body: true, source: true, via: true, authorId: true, remoteAuthorId: true },
      });
      if (!comment || existing.bindingId !== binding.id) {
        await transaction.integrationConflict.create({
          data: {
            kind: "inbound-reference",
            bindingId: binding.id,
            applicationId: application.id,
            refId: existing.id,
            localEvidence: {
              reason: comment ? "binding-mismatch" : "local-comment-missing",
              commentId: existing.entityId,
            },
            remoteEvidence: {
              provider: "redmine",
              remoteIssueId,
              remoteCommentId: change.identity.remoteId,
              remoteVersion: change.sourceVersion,
            },
          },
        });
        await transaction.integrationInboundApplication.update({
          where: { id: application.id },
          data: {
            state: "conflict",
            refId: existing.id,
            outcome: { reason: comment ? "REFERENCE_BINDING_MISMATCH" : "LOCAL_COMMENT_MISSING" },
          },
        });
        continue;
      }

      const metadata =
        existing.metadata && typeof existing.metadata === "object" && !Array.isArray(existing.metadata)
          ? existing.metadata
          : {};
      const redmineInboundComment =
        comment.remoteAuthorId !== null ||
        (comment.source === "system" && comment.via === REDMINE_INBOUND_COMMENT_VIA);
      if (!redmineInboundComment) {
        await transaction.externalRef.update({
          where: { id: existing.id },
          data: {
            remoteUpdatedAt: change.changedAt,
            lastCorrelationId: correlationId,
            metadata: {
              ...metadata,
              remoteVersion: change.sourceVersion,
              privacy: "private",
              localContentRetained: true,
            },
          },
        });
        await transaction.integrationInboundApplication.update({
          where: { id: application.id },
          data: {
            state: "skipped",
            refId: existing.id,
            outcome: { reason: "local-comment-preserved", provenance: "redmine-inbound" },
          },
        });
        continue;
      }

      const bodySha256 =
        metadata["privacy"] === "private" && typeof metadata["bodySha256"] === "string"
          ? metadata["bodySha256"]
          : createHash("sha256").update(comment.body).digest("hex");
      const mentions = await transaction.mention.findMany({
        where: { commentId: comment.id },
        select: { id: true },
      });
      await transaction.notification.deleteMany({
        where: {
          OR: [
            { commentId: comment.id },
            { mentionId: { in: mentions.map(({ id }) => id) } },
          ],
        },
      });
      await transaction.mention.deleteMany({ where: { commentId: comment.id } });
      await transaction.activityLog.updateMany({
        where: {
          issueId,
          details: { path: ["commentId"], equals: comment.id },
        },
        data: { details: { commentId: comment.id, source: comment.source, redacted: true } },
      });
      const works = await transaction.integrationSyncWork.findMany({
        where: {
          bindingId: binding.id,
          entityType: "comment",
          entityId: comment.id,
          direction: "outbound",
        },
        select: { id: true, state: true, skippedReason: true, payload: true },
      });
      const uncertainWorkIds: string[] = [];
      for (const work of works) {
        const payload =
          work.payload && typeof work.payload === "object" && !Array.isArray(work.payload)
            ? { ...work.payload }
            : {};
        delete payload["body"];
        const uncertain =
          work.state === "leased" ||
          work.state === "ambiguous" ||
          (work.state === "dead" && work.skippedReason === "private-comment-write-uncertain");
        if (uncertain) uncertainWorkIds.push(work.id);
        await transaction.integrationSyncWork.update({
          where: { id: work.id },
          data: {
            payload: { ...payload, redacted: true, bodySha256 },
            ...(work.state === "leased" || work.state === "ambiguous"
              ? {
                  state: "dead",
                  skippedReason: "private-comment-write-uncertain",
                  leaseToken: null,
                  leaseUntil: null,
                  fence: { increment: 1 },
                }
              : work.state === "queued" || work.state === "retry"
                ? {
                    state: "superseded",
                    leaseToken: null,
                    leaseUntil: null,
                    fence: { increment: 1 },
                  }
                : {}),
          },
        });
      }
      await transaction.comment.update({
        where: { id: comment.id },
        data: { body: "[Redacted private Redmine comment]" },
      });
      await transaction.externalRef.update({
        where: { id: existing.id },
        data: {
          remoteUpdatedAt: change.changedAt,
          lastCorrelationId: correlationId,
          metadata: {
            ...metadata,
            remoteVersion: change.sourceVersion,
            remoteIssueId,
            privacy: "private",
            bodySha256,
          },
        },
      });
      const localEvidence = {
        commentId: comment.id,
        bodySha256,
        ...(uncertainWorkIds.length > 0
          ? { outboundWriteUncertain: true, uncertainWorkIds }
          : {}),
      };
      const remoteEvidence = {
        provider: "redmine",
        remoteIssueId,
        remoteCommentId: change.identity.remoteId,
        remoteVersion: change.sourceVersion,
        reason: "private",
      };
      const retained = await transaction.integrationConflict.updateMany({
        where: {
          bindingId: binding.id,
          refId: existing.id,
          kind: "inbound-comment-privacy",
          state: "open",
        },
        data: { applicationId: application.id, localEvidence, remoteEvidence },
      });
      if (retained.count === 0) {
        await transaction.integrationConflict.create({
          data: {
            kind: "inbound-comment-privacy",
            bindingId: binding.id,
            applicationId: application.id,
            refId: existing.id,
            localEvidence,
            remoteEvidence,
          },
        });
      }
      await transaction.integrationInboundApplication.update({
        where: { id: application.id },
        data: {
          state: "conflict",
          refId: existing.id,
          outcome: { reason: "private-comment-redacted", provenance: "redmine-inbound" },
        },
      });
      continue;
    }

    if (existing) continue;

    const privateTombstone = await transaction.integrationInboundApplication.findFirst({
      where: {
        bindingId: binding.id,
        remoteEntityType: "comment",
        remoteParentType: "issue",
        remoteParentId: remoteIssueId,
        remoteId: change.identity.remoteId,
        state: "skipped",
        outcome: { path: ["reason"], equals: "private-comment" },
      },
      select: { id: true },
    });
    if (privateTombstone) {
      await transaction.integrationInboundApplication.createMany({
        data: {
          bindingId: binding.id,
          remoteEntityType: "comment",
          remoteParentType: "issue",
          remoteParentId: remoteIssueId,
          remoteId: change.identity.remoteId,
          remoteUpdatedAt: change.changedAt,
          sourceVersion: change.sourceVersion,
          applicationKey: correlationId,
          correlationId,
          state: "skipped",
          outcome: { reason: "private-comment-tombstoned" },
        },
        skipDuplicates: true,
      });
      continue;
    }

    const marker = parseCommentMarker(change.fields.body);
    if (marker) {
      const remoteActorId = change.actor?.remoteId;
      const parentRef = await transaction.externalRef.findFirst({
        where: {
          bindingId: binding.id,
          connectionId: binding.connectionId,
          entityType: "issue",
          entityId: issueId,
          externalId: remoteIssueId,
        },
      });
      const [work] = parentRef
        && remoteActorId
        ? await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
            SELECT work."id" FROM "integration_sync_work" work
            WHERE work."binding_id" = ${binding.id}::uuid
              AND work."entity_type" = 'comment' AND work."entity_id" = ${marker.commentId}::uuid
              AND work."direction" = 'outbound'::"SyncDirection" AND work."operation" = 'create'::"SyncOperation"
              AND work."payload"->>'issueId' = ${issueId}
               AND work."payload"->>'parentRefId' = ${parentRef.id}
               AND work."payload"->>'parentRemoteIssueId' = ${remoteIssueId}
               AND work."payload"->>'credentialRemoteUserId' = ${remoteActorId}
               AND work."marker" = ${marker.marker}
              AND work."state" IN ('leased'::"SyncWorkState", 'ambiguous'::"SyncWorkState", 'done'::"SyncWorkState")
            ORDER BY work."created_at" LIMIT 1 FOR UPDATE OF work
          `)
        : [];
      const provenWork = work
        ? await transaction.integrationSyncWork.findFirst({
            where: {
              id: work.id,
              AND: [
                { payload: { path: ["issueId"], equals: issueId } },
                { payload: { path: ["parentRefId"], equals: parentRef!.id } },
                { payload: { path: ["parentRemoteIssueId"], equals: remoteIssueId } },
                { payload: { path: ["credentialRemoteUserId"], equals: remoteActorId! } },
              ],
              state: { in: ["leased", "ambiguous", "done"] },
              conflicts: { none: { state: "open" } },
            },
          })
        : null;
      const localComment = provenWork
        ? await transaction.comment.findFirst({
            where: { id: marker.commentId, issueId },
          })
        : null;
      const localRef = localComment
        ? await transaction.externalRef.findFirst({
            where: {
              connectionId: binding.connectionId,
              entityType: "comment",
              entityId: localComment.id,
            },
          })
        : null;
      if (provenWork && localComment && marker.body === localComment.body && !localRef) {
        const ref = await transaction.externalRef.create({
          data: {
            connectionId: binding.connectionId,
            bindingId: binding.id,
            entityType: "comment",
            entityId: localComment.id,
            externalId: change.identity.remoteId,
            remoteUpdatedAt: change.changedAt,
            localVersion: 1,
            lastCorrelationId: correlationId,
            metadata: {
              remoteVersion: change.sourceVersion,
              remoteIssueId,
              remoteActorId: change.actor?.remoteId ?? null,
              marker: marker.marker,
            },
          },
        });
        await transaction.integrationSyncWork.update({
          where: { id: provenWork.id },
          data: { state: "done", refId: ref.id, leaseToken: null, leaseUntil: null },
        });
        await transaction.integrationInboundApplication.create({
          data: {
            bindingId: binding.id,
            remoteEntityType: "comment",
            remoteParentType: "issue",
            remoteParentId: remoteIssueId,
            remoteId: change.identity.remoteId,
            remoteUpdatedAt: change.changedAt,
            sourceVersion: change.sourceVersion,
            applicationKey: correlationId,
            correlationId,
            state: "applied",
            refId: ref.id,
            workId: provenWork.id,
            outcome: { provenance: "redmine-inbound-echo", marker: marker.marker },
          },
        });
        continue;
      }
    }

    if (!change.actor) {
      await transaction.integrationInboundApplication.createMany({
        data: {
          bindingId: binding.id,
          remoteEntityType: "comment",
          remoteParentType: "issue",
          remoteParentId: remoteIssueId,
          remoteId: change.identity.remoteId,
          remoteUpdatedAt: change.changedAt,
          sourceVersion: change.sourceVersion,
          applicationKey: correlationId,
          correlationId,
          state: "skipped",
          outcome: { reason: "remote-comment-author-missing" },
        },
        skipDuplicates: true,
      });
      continue;
    }

    const remoteAuthor = await transaction.integrationExternalIdentity.upsert({
      where: {
        bindingId_remoteUserId: {
          bindingId: binding.id,
          remoteUserId: change.actor.remoteId,
        },
      },
      create: {
        bindingId: binding.id,
        remoteUserId: change.actor.remoteId,
        remoteLogin: change.actor.username ?? null,
        remoteDisplayName: change.actor.displayName,
      },
      update: {
        ...(change.actor.username === undefined
          ? {}
          : { remoteLogin: change.actor.username }),
        remoteDisplayName: change.actor.displayName,
      },
    });
    const comment = await createCommentWithActivityTx(transaction, {
      issueId,
      body: change.fields.body,
      source: "system",
      via: "redmine-inbound",
      createdAt: change.createdAt ?? change.changedAt,
      origin: {
        kind: "remote",
        bindingId: binding.id,
        externalIdentityId: remoteAuthor.id,
      },
    });
    const ref = await transaction.externalRef.create({
      data: {
        connectionId: binding.connectionId,
        bindingId: binding.id,
        entityType: "comment",
        entityId: comment.id,
        externalId: change.identity.remoteId,
        remoteUpdatedAt: change.changedAt,
        localVersion: 1,
        lastCorrelationId: correlationId,
        metadata: {
          remoteVersion: change.sourceVersion,
          remoteIssueId,
          remoteActorId: change.actor?.remoteId ?? null,
        },
      },
    });
    await transaction.integrationInboundApplication.create({
      data: {
        bindingId: binding.id,
        remoteEntityType: "comment",
        remoteParentType: "issue",
        remoteParentId: remoteIssueId,
        remoteId: change.identity.remoteId,
        remoteUpdatedAt: change.changedAt,
        sourceVersion: change.sourceVersion,
        applicationKey: correlationId,
        correlationId,
        state: "applied",
        refId: ref.id,
        outcome: { provenance: "redmine-inbound" },
      },
    });
  }
}

async function convergeLinkedIssue(
  database: PrismaClient,
  binding: ClaimedBinding,
  change: InboundIssueStatusChange,
  detail: InboundIssueDetail,
) {
  const correlationId = applicationIdentity(binding.id, {
    ...change,
    changedAt: detail.changedAt,
  });

  const outcome = await database.$transaction(async (transaction) => {
    const active = await lockPollSnapshot(transaction, binding);
    if (!active) return "stale" as const;

    const ref = await transaction.externalRef.findUnique({
      where: {
        connectionId_entityType_externalId: {
          connectionId: binding.connectionId,
          entityType: "issue",
          externalId: change.entityId,
        },
      },
    });
    await transaction.integrationInboundApplication.createMany({
      data: {
        bindingId: binding.id,
        remoteEntityType: "issue",
        remoteId: change.entityId,
        remoteUpdatedAt: detail.changedAt,
        sourceVersion: detail.sourceVersion,
        applicationKey: correlationId,
        correlationId,
        refId: ref?.id,
      },
      skipDuplicates: true,
    });
    const application = await transaction.integrationInboundApplication.findFirstOrThrow({
      where: {
        OR: [
          { applicationKey: correlationId },
          {
            bindingId: binding.id,
            remoteEntityType: "issue",
            remoteId: change.entityId,
            sourceVersion: detail.sourceVersion,
          },
        ],
      },
    });
    if (["applied", "conflict", "skipped"].includes(application.state)) return "detail" as const;

    if (!ref || ref.bindingId !== binding.id) {
      await transaction.integrationConflict.create({
        data: {
          kind: "inbound-reference",
          bindingId: binding.id,
          applicationId: application.id,
          refId: ref?.id,
          localEvidence: { reason: ref ? "binding-mismatch" : "reference-missing" },
          remoteEvidence: {
            provider: "redmine",
            remoteIssueId: change.entityId,
            remoteVersion: detail.sourceVersion,
          },
        },
      });
      await transaction.integrationInboundApplication.update({
        where: { id: application.id },
        data: {
          state: "conflict",
          outcome: { reason: ref ? "REFERENCE_BINDING_MISMATCH" : "REFERENCE_MISSING" },
        },
      });
      return "detail" as const;
    }
    if (ref.remoteUpdatedAt && ref.remoteUpdatedAt >= detail.changedAt) {
      await transaction.integrationInboundApplication.update({
        where: { id: application.id },
        data: {
          state: "skipped",
          refId: ref.id,
          outcome: { reason: "stale-or-correlated-echo" },
        },
      });
      return "detail" as const;
    }
    if (detail.operation === "tombstone" || !("statusId" in detail.fields)) {
      await transaction.externalRef.update({
        where: { id: ref.id },
        data: { remoteUpdatedAt: detail.changedAt, lastCorrelationId: correlationId },
      });
      await transaction.integrationInboundApplication.update({
        where: { id: application.id },
        data: {
          state: "skipped",
          refId: ref.id,
          outcome: { reason: "private-issue", provenance: "redmine-inbound" },
        },
      });
      return "detail" as const;
    }

    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "issues" WHERE "id" = ${ref.entityId}::uuid FOR UPDATE`,
    );
    const issue = await transaction.issue.findFirst({
      where: { id: ref.entityId, projectId: binding.projectId },
      include: { schedule: true },
    });
    if (!issue) {
      await transaction.integrationConflict.create({
        data: {
          kind: "inbound-reference",
          bindingId: binding.id,
          applicationId: application.id,
          refId: ref.id,
          localEvidence: { reason: "local-issue-missing", issueId: ref.entityId },
          remoteEvidence: {
            provider: "redmine",
            remoteIssueId: change.entityId,
            remoteVersion: detail.sourceVersion,
          },
        },
      });
      await transaction.integrationInboundApplication.update({
        where: { id: application.id },
        data: { state: "conflict", refId: ref.id, outcome: { reason: "LOCAL_ISSUE_MISSING" } },
      });
      return "detail" as const;
    }

    await persistInboundCommentsTx(
      transaction,
      binding,
      ref.entityId,
      change.entityId,
      detail.comments ?? [],
    );

    const actors = [detail.actor, detail.fields.assignee].filter(
      (actor): actor is NonNullable<typeof actor> => actor !== undefined && actor !== null,
    );
    for (const actor of actors) {
      await transaction.integrationExternalIdentity.upsert({
        where: {
          bindingId_remoteUserId: { bindingId: binding.id, remoteUserId: actor.remoteId },
        },
        create: {
          bindingId: binding.id,
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

    const readMap =
      active.readMap && typeof active.readMap === "object" && !Array.isArray(active.readMap)
        ? (active.readMap as Record<string, unknown>)
        : {};
    const remote: Partial<Record<IssueSyncField, IssueSyncValue>> = {
      title: detail.fields.title,
      description: canonicalRedmineDescription(detail.fields.description, issue.id),
      startDate: detail.fields.startDate,
      dueDate: detail.fields.dueDate,
      progress: detail.fields.progress,
    };
    const mappingFailures: Partial<Record<IssueSyncField, unknown>> = {};
    const mappedState = readMap[detail.fields.statusId];
    if (typeof mappedState === "string" && ISSUE_STATES.has(mappedState as IssueState)) {
      remote.state = mappedState;
    } else {
      mappingFailures.state = { remoteStatusId: detail.fields.statusId };
    }
    const mappedPriority = readMap[priorityReadKey(detail.fields.priorityId)];
    if (
      typeof mappedPriority === "string" &&
      ISSUE_PRIORITIES.has(mappedPriority as IssuePriority)
    ) {
      remote.priority = mappedPriority;
    } else {
      mappingFailures.priority = { remotePriorityId: detail.fields.priorityId };
    }
    if (detail.fields.assignee === null) {
      remote.assigneeId = null;
    } else {
      const identity = await transaction.integrationExternalIdentity.findUnique({
        where: {
          bindingId_remoteUserId: {
            bindingId: binding.id,
            remoteUserId: detail.fields.assignee.remoteId,
          },
        },
        select: { memberId: true, member: { select: { workspaceId: true } } },
      });
      if (identity?.memberId && identity.member?.workspaceId === active.connection.workspaceId) {
        remote.assigneeId = identity.memberId;
      } else {
        mappingFailures.assigneeId = { remoteUserId: detail.fields.assignee.remoteId };
      }
    }

    const local: IssueSyncSnapshot = {
      title: issue.title,
      description: issue.description,
      state: issue.state,
      priority: issue.priority,
      assigneeId: issue.assigneeId,
      startDate: dateOnly(issue.schedule?.startDate),
      dueDate: dateOnly(issue.schedule?.dueDate),
      progress: issue.schedule?.progress ?? 0,
    };
    const baseline = readIssueSyncBaseline(ref.metadata);
    const result = reconcileIssueSnapshots(baseline, local, remote, mappingFailures);
    const patch = { ...result.patch };
    const nextBaseline = { ...result.nextBaseline };
    const appliedFields = [...result.appliedFields];
    const preservedFields = [...result.preservedFields];
    const convergedFields = [...result.convergedFields];
    const conflicts: Partial<Record<IssueSyncField, IssueFieldConflict>> = {
      ...result.conflicts,
    };
    const activeFieldConflicts = await transaction.integrationConflict.findMany({
      where: {
        bindingId: binding.id,
        refId: ref.id,
        kind: "inbound-field-convergence",
        state: "open",
      },
      orderBy: { createdAt: "asc" },
    });
    const activeFieldConflict = activeFieldConflicts[0];
    const activeLocalEvidence = activeFieldConflicts.reduce(
      (evidence, conflict) => ({ ...evidence, ...(jsonObject(conflict.localEvidence) ?? {}) }),
      {} as Record<string, unknown>,
    );
    const activeLocalFields = activeFieldConflicts.reduce(
      (fields, conflict) => ({
        ...fields,
        ...(jsonObject(jsonObject(conflict.localEvidence)?.["fields"]) ?? {}),
      }),
      {} as Record<string, unknown>,
    );
    const activeRemoteEvidence = activeFieldConflicts.reduce(
      (evidence, conflict) => ({ ...evidence, ...(jsonObject(conflict.remoteEvidence) ?? {}) }),
      {} as Record<string, unknown>,
    );
    const activeRemoteFields = activeFieldConflicts.reduce(
      (fields, conflict) => ({
        ...fields,
        ...(jsonObject(jsonObject(conflict.remoteEvidence)?.["fields"]) ?? {}),
      }),
      {} as Record<string, unknown>,
    );
    let timeReconciled = false;
    let reportedTotalHours: number | null = null;
    let transitionRegression = false;
    const rejectAppliedField = (field: IssueSyncField, remoteEvidence: unknown) => {
      delete patch[field];
      const index = appliedFields.indexOf(field);
      if (index >= 0) appliedFields.splice(index, 1);
      if (Object.prototype.hasOwnProperty.call(baseline?.fields ?? {}, field)) {
        nextBaseline[field] = baseline!.fields[field];
      } else {
        delete nextBaseline[field];
      }
      conflicts[field] = {
        reason: "invalid",
        baselinePresent: Object.prototype.hasOwnProperty.call(baseline?.fields ?? {}, field),
        baseline: baseline?.fields[field] ?? null,
        local: local[field],
        remote: remoteEvidence,
      };
    };
    const removeField = (fields: IssueSyncField[], field: IssueSyncField) => {
      const index = fields.indexOf(field);
      if (index >= 0) fields.splice(index, 1);
    };
    const activeBlockedFields = new Set(
      activeFieldConflicts.flatMap(({ localEvidence }) => readBlockedIssueFields(localEvidence)),
    );
    // Matching snapshots stay blocked until an owner explicitly resolves the conflict.
    for (const field of ISSUE_SYNC_FIELDS.filter((candidate) => activeBlockedFields.has(candidate))) {
      delete patch[field];
      removeField(appliedFields, field);
      removeField(preservedFields, field);
      removeField(convergedFields, field);
      if (Object.prototype.hasOwnProperty.call(baseline?.fields ?? {}, field)) {
        nextBaseline[field] = baseline!.fields[field];
      } else {
        delete nextBaseline[field];
      }
      if (conflicts[field]) continue;
      const previous = jsonObject(activeLocalFields[field]);
      const reason = previous?.["reason"];
      conflicts[field] = {
        reason: ["missing-baseline", "diverged", "mapping", "invalid"].includes(
          String(reason),
        )
          ? (reason as IssueFieldConflict["reason"])
          : "diverged",
        baselinePresent: Object.prototype.hasOwnProperty.call(baseline?.fields ?? {}, field),
        baseline: baseline?.fields[field] ?? null,
        local: local[field],
        remote:
          mappingFailures[field] ??
          (Object.prototype.hasOwnProperty.call(remote, field)
            ? remote[field]
            : (activeRemoteFields[field] ?? null)),
      };
    }

    if (Object.prototype.hasOwnProperty.call(patch, "state")) {
      const target = patch.state as IssueState;
      const transition = validateTransition(issue.state, target);
      if (!transition.allowed) {
        rejectAppliedField("state", { state: target, reason: transition.reason });
      } else {
        transitionRegression = transition.isRegression;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "state") && target === "done") {
        const now = await databaseNow(transaction);
        const [activeSessions, latestWorkLog, latestTimeEntry] = await Promise.all([
          transaction.workSession.count({
            where: {
              issueId: issue.id,
              lastHeartbeat: { gt: new Date(now.getTime() - SESSION_TTL_MS) },
            },
          }),
          transaction.workLog.findFirst({
            where: { issueId: issue.id },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          }),
          transaction.timeEntry.findFirst({
            where: { issueId: issue.id },
            orderBy: { createdAt: "desc" },
            select: { createdAt: true },
          }),
        ]);
        const latestCapturedAt = [latestWorkLog?.createdAt, latestTimeEntry?.createdAt]
          .filter((value): value is Date => value !== undefined)
          .sort((left, right) => right.getTime() - left.getTime())[0];
        if (activeSessions > 0) {
          rejectAppliedField("state", {
            state: target,
            reason: "active-work-session",
          });
        } else if (
          latestCapturedAt &&
          (!issue.timeConfirmedAt || latestCapturedAt >= issue.timeConfirmedAt)
        ) {
          const reconciled = await reconcileIssueTime(
            issue.id,
            binding.actorMemberId,
            undefined,
            transaction,
          );
          timeReconciled = true;
          reportedTotalHours = reconciled.totalHours;
          await transaction.activityLog.create({
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
        }
      }
    }

    const effective = (field: "startDate" | "dueDate") =>
      Object.prototype.hasOwnProperty.call(patch, field) ? patch[field] : local[field];
    const effectiveStart = effective("startDate");
    const effectiveDue = effective("dueDate");
    if (
      typeof effectiveStart === "string" &&
      typeof effectiveDue === "string" &&
      effectiveStart > effectiveDue
    ) {
      for (const field of ["startDate", "dueDate"] as const) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
          rejectAppliedField(field, { value: patch[field], reason: "invalid-date-range" });
        }
      }
    }

    const issueData: Prisma.IssueUncheckedUpdateInput = {};
    for (const field of ["title", "description", "priority", "assigneeId"] as const) {
      if (Object.prototype.hasOwnProperty.call(patch, field)) issueData[field] = patch[field] as never;
    }
    if (Object.prototype.hasOwnProperty.call(patch, "state")) {
      issueData.state = patch.state as IssueState;
      issueData.completedAt =
        patch.state === "done" ? (detail.closedAt ?? detail.changedAt) : null;
    }
    if (Object.keys(issueData).length) {
      await transaction.issue.update({ where: { id: issue.id }, data: issueData });
    }
    if (Object.prototype.hasOwnProperty.call(patch, "state")) {
      await transaction.activityLog.create({
        data: {
          issueId: issue.id,
          memberId: binding.actorMemberId,
          action: "state_changed",
          via: "redmine-inbound",
          details: {
            from: issue.state,
            to: patch.state,
            regression: transitionRegression,
          },
        },
      });
    }

    const scheduleFields = (["startDate", "dueDate", "progress"] as const).filter((field) =>
      Object.prototype.hasOwnProperty.call(patch, field),
    );
    if (scheduleFields.length) {
      const scheduleData: Prisma.IssueScheduleUncheckedUpdateInput = {};
      if (Object.prototype.hasOwnProperty.call(patch, "startDate")) {
        scheduleData.startDate =
          typeof patch.startDate === "string"
            ? new Date(`${patch.startDate}T00:00:00.000Z`)
            : null;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "dueDate")) {
        scheduleData.dueDate =
          typeof patch.dueDate === "string"
            ? new Date(`${patch.dueDate}T00:00:00.000Z`)
            : null;
      }
      if (Object.prototype.hasOwnProperty.call(patch, "progress")) {
        scheduleData.progress = patch.progress as number;
      }
      await transaction.issueSchedule.upsert({
        where: { issueId: issue.id },
        create: { issueId: issue.id, ...scheduleData } as Prisma.IssueScheduleUncheckedCreateInput,
        update: scheduleData,
      });
    }

    let workId: string | null = null;
    if (appliedFields.length) {
      const work = await captureIntegrationWorkTx(transaction, {
        bindingId: binding.id,
        entityType: "issue",
        entityId: issue.id,
        direction: "inbound",
        operation: change.operation,
        actorKey: `redmine:issue:${change.entityId}`,
        actorKind: "remote",
        payload: { version: 1, fields: patch } as Prisma.InputJsonValue,
        correlationId,
        refId: ref.id,
      });
      await transaction.integrationSyncWork.update({
        where: { id: work.id },
        data: { state: "done" },
      });
      workId = work.id;
      await transaction.activityLog.create({
        data: {
          issueId: issue.id,
          memberId: binding.actorMemberId,
          action: "edited",
          via: "redmine-inbound",
          details: {
            integration: "redmine",
            action: "field_convergence",
            correlationId,
            appliedFields,
          },
        },
      });
    }

    const conflictFields = ISSUE_SYNC_FIELDS.filter((field) => conflicts[field] !== undefined);
    if (conflictFields.length) {
      const pending = await transaction.integrationSyncWork.findMany({
        where: {
          bindingId: binding.id,
          entityType: "issue",
          entityId: issue.id,
          direction: "outbound",
          state: { in: ["queued", "retry"] },
        },
        select: { id: true, payload: true },
      });
      for (const outbound of pending) {
        const payload =
          outbound.payload && typeof outbound.payload === "object" && !Array.isArray(outbound.payload)
            ? outbound.payload
            : null;
        const fields =
          payload?.["fields"] &&
          typeof payload["fields"] === "object" &&
          !Array.isArray(payload["fields"])
            ? payload["fields"]
            : null;
        if (fields && conflictFields.some((field) => Object.hasOwn(fields, field))) {
          const remainingFields = Object.fromEntries(
            Object.entries(fields).filter(([field]) => !conflictFields.includes(field as IssueSyncField)),
          );
          await transaction.integrationSyncWork.update({
            where: { id: outbound.id },
            data: Object.keys(remainingFields).length
              ? {
                  payload: { ...payload, fields: remainingFields } as Prisma.InputJsonObject,
                }
              : { state: "dead", skippedReason: "inbound_field_conflict" },
          });
        }
      }
      const localFields = { ...activeLocalFields };
      const remoteFields = { ...activeRemoteFields };
      for (const field of conflictFields) {
        const previous = jsonObject(activeLocalFields[field]);
        const currentLocalVersion = ["startDate", "dueDate", "progress"].includes(field)
          ? (issue.schedule?.updatedAt ?? issue.updatedAt).toISOString()
          : issue.updatedAt.toISOString();
        localFields[field] = {
          ...previous,
          reason: conflicts[field]!.reason,
          baselinePresent: conflicts[field]!.baselinePresent,
          baseline: conflicts[field]!.baseline,
          local: conflicts[field]!.local,
          localVersion:
            previous?.["local"] === conflicts[field]!.local &&
            typeof previous["localVersion"] === "string"
              ? previous["localVersion"]
              : currentLocalVersion,
        };
        remoteFields[field] = conflicts[field]!.remote ?? null;
      }
      const localEvidence = {
        ...activeLocalEvidence,
        issueId: issue.id,
        issueKey: issue.key,
        blockedFields: conflictFields,
        fields: localFields,
      } as Prisma.InputJsonObject;
      const remoteEvidence = {
        ...activeRemoteEvidence,
        provider: "redmine",
        remoteIssueId: change.entityId,
        remoteVersion: detail.sourceVersion,
        blockedFields: conflictFields,
        fields: remoteFields,
      } as Prisma.InputJsonObject;
      if (activeFieldConflict) {
        await transaction.integrationConflict.update({
          where: { id: activeFieldConflict.id },
          data: { applicationId: application.id, localEvidence, remoteEvidence },
        });
        await transaction.integrationConflict.updateMany({
          where: { id: { in: activeFieldConflicts.slice(1).map(({ id }) => id) } },
          data: { state: "resolved" },
        });
      } else {
        await transaction.integrationConflict.create({
          data: {
            kind: "inbound-field-convergence",
            bindingId: binding.id,
            applicationId: application.id,
            refId: ref.id,
            localEvidence,
            remoteEvidence,
          },
        });
      }
    }

    const stateConflict = conflicts.state !== undefined;
    const metadata = issueSyncMetadata(ref.metadata, {
      sourceVersion: detail.sourceVersion,
      changedAt: detail.changedAt,
      createdAt: detail.createdAt ?? null,
      ...(remote.state !== undefined && !stateConflict
        ? {
            completedAt:
              remote.state === "done" ? (detail.closedAt ?? detail.changedAt) : null,
          }
        : {}),
      fields: nextBaseline,
    });
    await transaction.externalRef.update({
      where: { id: ref.id },
      data: {
        remoteUpdatedAt: detail.changedAt,
        lastCorrelationId: correlationId,
        metadata,
        ...(appliedFields.length ? { localVersion: { increment: 1 } } : {}),
      },
    });
    await transaction.integrationInboundApplication.update({
      where: { id: application.id },
      data: {
        state: conflictFields.length ? "conflict" : "applied",
        refId: ref.id,
        workId,
        outcome: {
          provenance: "redmine-inbound",
          from: local.state,
          to: remote.state ?? local.state,
          timeReconciled,
          reportedTotalHours,
          appliedFields,
          preservedFields,
          convergedFields,
          conflictFields,
        },
      },
    });
    return {
      result: "detail" as const,
      transition: Object.prototype.hasOwnProperty.call(patch, "state")
        ? {
            issueId: issue.id,
            issueKey: issue.key,
            parentId: issue.parentId,
            projectKey: active.project.key,
            workspaceId: active.connection.workspaceId,
            from: issue.state,
            to: patch.state as IssueState,
          }
        : null,
    };
  }, { timeout: 30_000 });

  if (typeof outcome === "string") return outcome;
  if (!outcome.transition) return outcome.result;
  const transition = outcome.transition;
  const effects = await Promise.allSettled([
    checkAndAdvanceParent(database, { parentId: transition.parentId }, binding.actorMemberId),
    syncRoadmapItemStatus(database, transition.issueId),
  ]);
  for (const effect of effects) {
    if (effect.status === "rejected") console.error("Redmine transition side effect failed", effect.reason);
  }
  const payload: IssueTransitionedPayload = {
    issueKey: transition.issueKey,
    issueId: transition.issueId,
    projectKey: transition.projectKey,
    from: transition.from,
    to: transition.to,
    actorMemberId: binding.actorMemberId,
    actorUserId: null,
  };
  try {
    eventBus.emit({
      type: "issue.transitioned",
      workspaceId: transition.workspaceId,
      actorId: binding.actorMemberId,
      payload: payload as unknown as Record<string, unknown>,
      via: "redmine-inbound",
    });
  } catch {
    // Event delivery never changes durable convergence state.
  }
  return outcome.result;
}

type UnlinkedImportContext = RedmineIssueImportContext & { readonly actorMemberId: string };

async function importUnlinkedIssueTx(
  transaction: Prisma.TransactionClient,
  context: UnlinkedImportContext,
  detail: InboundIssueDetail,
) {
  const linked = await transaction.externalRef.findUnique({
    where: {
      connectionId_entityType_externalId: {
        connectionId: context.connectionId,
        entityType: "issue",
        externalId: detail.identity.remoteId,
      },
    },
    select: { id: true, bindingId: true },
  });
  if (linked) {
    if (context.applicationClaim) {
      if (linked.bindingId !== context.bindingId) {
        throw new AppError(
          409,
          "REFERENCE_BINDING_MISMATCH",
          "Redmine issue is linked to another project binding",
        );
      }
      await completeRetriedApplicationTx(transaction, context.applicationClaim, {
        state: "skipped",
        refId: linked.id,
        workId: null,
        outcome: { reason: "already-imported", provenance: "redmine-inbound-retry" },
      });
    }
    return { kind: "linked" as const, issueKey: null };
  }

  const localIssueIds =
    "description" in detail.fields ? outboundIssueIds(detail.fields.description) : [];
  const outboundCreate = localIssueIds.length
    ? await transaction.integrationSyncWork.findFirst({
        where: {
          bindingId: context.bindingId,
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

  const [issueKey] = await persistRedmineIssueImportsTx(transaction, context, [detail]);
  const importedRef = await transaction.externalRef.findUniqueOrThrow({
    where: {
      connectionId_entityType_externalId: {
        connectionId: context.connectionId,
        entityType: "issue",
        externalId: detail.identity.remoteId,
      },
    },
    select: { entityId: true },
  });
  await persistInboundCommentsTx(
    transaction,
    {
      id: context.bindingId,
      connectionId: context.connectionId,
    },
    importedRef.entityId,
    detail.identity.remoteId,
    detail.comments ?? [],
  );
  return { kind: "imported" as const, issueKey: issueKey! };
}

type RetryClaim = InboundApplicationClaim & {
  readonly remoteId: string;
  readonly remoteUpdatedAt: Date;
};

async function retryBinding(
  transaction: Prisma.TransactionClient,
  connectionId: string,
  bindingId: string,
  userId: string,
  workspaceId?: string,
  allowedProjectIds?: string[] | null,
) {
  const connection = await ownedConnection(transaction, connectionId, userId, workspaceId);
  if (connection.provider !== "redmine") {
    throw new AppError(400, "INVALID_INTEGRATION_PROVIDER", "Connection is not a Redmine integration");
  }
  const binding = await transaction.integrationProjectBinding.findFirst({
    where: {
      id: bindingId,
      connectionId,
      releaseRequestedAt: null,
      releasedAt: null,
      project: { archived: false },
      ...(allowedProjectIds ? { projectId: { in: allowedProjectIds } } : {}),
    },
    include: { project: { select: { key: true } } },
  });
  if (!binding) {
    throw new AppError(404, "INTEGRATION_BINDING_NOT_FOUND", "Integration project binding not found");
  }
  if (
    connection.lifecycle !== "active" ||
    binding.lifecycle !== "active" ||
    !binding.inboundEnabled ||
    binding.bootstrapState !== "ready"
  ) {
    throw new AppError(409, "INTEGRATION_NOT_ACTIVE", "Inbound Redmine sync must be active");
  }
  const credential = await serviceCredential(transaction, connection);
  return { connection, binding, credential };
}

async function retainRetryConflict(claim: RetryClaim, error: unknown): Promise<boolean> {
  const evidence = safeErrorEvidence(error);
  return prisma.$transaction(async (transaction) => {
    const retained = await transaction.integrationInboundApplication.updateMany({
      where: {
        id: claim.id,
        state: "claimed",
        leaseToken: claim.leaseToken,
        fence: claim.fence,
      },
      data: {
        state: "conflict",
        leaseToken: null,
        leaseUntil: null,
        outcome: { reason: "INBOUND_OBSERVATION_FAILED", error: evidence },
      },
    });
    if (retained.count !== 1) return false;
    await transaction.integrationConflict.updateMany({
      where: {
        applicationId: claim.id,
        kind: "inbound-observation-failure",
        state: "open",
      },
      data: {
        remoteEvidence: {
          provider: "redmine",
          remoteIssueId: claim.remoteId,
          error: evidence,
        },
      },
    });
    return true;
  });
}

async function rejectRetry(claim: RetryClaim, error: unknown): Promise<never> {
  if (!(await retainRetryConflict(claim, error))) {
    throw new AppError(409, "INBOUND_APPLICATION_STALE", "Inbound application retry is stale");
  }
  if (error instanceof AppError) throw error;
  throw new AppError(
    409,
    "INBOUND_RETRY_CONFLICT",
    "Current Redmine issue still cannot be imported",
  );
}

export async function retryRedmineIssueImport(
  connectionId: string,
  bindingId: string,
  applicationId: string,
  userId: string,
  options: RedmineImportDependencies = {},
) {
  const decrypt = options.decrypt ?? decryptCredential;
  const createClient =
    options.client ??
    ((baseUrl: string, apiKey: string) =>
      new RedmineHttpClient(baseUrl, apiKey, {
        endpointAllowlist: env.REDMINE_ENDPOINT_ALLOWLIST,
      }));
  const initial = await prisma.$transaction((transaction) =>
    retryBinding(
      transaction,
      connectionId,
      bindingId,
      userId,
      options.workspaceId,
      options.allowedProjectIds,
    ),
  );
  const claim = await prisma.$transaction(async (transaction): Promise<RetryClaim> => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "integration_inbound_applications" WHERE "id" = ${applicationId}::uuid AND "binding_id" = ${bindingId}::uuid FOR UPDATE`,
    );
    const application = await transaction.integrationInboundApplication.findFirst({
      where: { id: applicationId, bindingId },
      include: {
        conflicts: {
          where: { kind: "inbound-observation-failure", state: "open" },
          select: { id: true },
        },
      },
    });
    if (!application) {
      throw new AppError(
        404,
        "INBOUND_APPLICATION_NOT_FOUND",
        "Retryable inbound application was not found",
      );
    }
    const outcome =
      application.outcome &&
      typeof application.outcome === "object" &&
      !Array.isArray(application.outcome)
        ? application.outcome
        : {};
    const now = await databaseNow(transaction);
    const retryableApplication =
      application.remoteEntityType === "issue" &&
      application.refId === null &&
      application.conflicts.length > 0;
    const retryable =
      retryableApplication &&
      ((application.state === "conflict" && outcome["reason"] === "INBOUND_OBSERVATION_FAILED") ||
        (application.state === "claimed" &&
          application.leaseUntil !== null &&
          application.leaseUntil <= now));
    if (!retryable) {
      throw new AppError(
        409,
        "INBOUND_APPLICATION_NOT_RETRYABLE",
        "Inbound application is not retryable",
      );
    }
    const leaseToken = randomUUID();
    const claimed = await transaction.integrationInboundApplication.update({
      where: { id: application.id },
      data: {
        state: "claimed",
        leaseToken,
        leaseUntil: new Date(now.getTime() + RETRY_LEASE_MS),
        fence: { increment: 1 },
      },
    });
    return {
      id: claimed.id,
      remoteId: claimed.remoteId,
      remoteUpdatedAt: claimed.remoteUpdatedAt,
      leaseToken,
      fence: claimed.fence,
    };
  });

  let detail: InboundIssueDetail;
  try {
    const apiKey = decrypt(initial.credential.encryptedKey);
    if (!apiKey) throw new Error("Service credential could not be decrypted");
    const value = await createClient(initial.connection.baseUrl, apiKey).get<unknown>(
      `/issues/${encodeURIComponent(claim.remoteId)}.json?include=journals`,
    );
    const decoded = decodeRedmineIssueDetail(value, initial.binding.remoteProjectId);
    detail = { ...decoded.issue, comments: decoded.comments };
    if (
      detail.identity.remoteId !== claim.remoteId ||
      detail.changedAt < claim.remoteUpdatedAt
    ) {
      throw new AppError(
        409,
        "REDMINE_DETAIL_MISMATCH",
        "Redmine issue detail did not match the retry target",
      );
    }
  } catch (error) {
    return rejectRetry(claim, error);
  }

  try {
    return await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "integration_connections" WHERE "id" = ${connectionId}::uuid FOR SHARE`,
      );
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid FOR SHARE`,
      );
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "member_integration_credentials" WHERE "id" = ${initial.credential.id}::uuid FOR SHARE`,
      );
      const owner = await transaction.member.findUnique({
        where: {
          userId_workspaceId: { userId, workspaceId: initial.connection.workspaceId },
        },
        select: { id: true },
      });
      if (owner) {
        await transaction.$queryRaw(
          Prisma.sql`SELECT "id" FROM "members" WHERE "id" = ${owner.id}::uuid FOR SHARE`,
        );
      }
      const current = await retryBinding(
        transaction,
        connectionId,
        bindingId,
        userId,
        options.workspaceId,
        options.allowedProjectIds,
      );
      if (
        current.connection.lifecycleEpoch !== initial.connection.lifecycleEpoch ||
        current.binding.lifecycleEpoch !== initial.binding.lifecycleEpoch ||
        current.credential.id !== initial.credential.id ||
        current.credential.encryptedKey !== initial.credential.encryptedKey ||
        current.credential.updatedAt.getTime() !== initial.credential.updatedAt.getTime()
      ) {
        throw new AppError(
          409,
          "INBOUND_RETRY_FENCE_CHANGED",
          "Redmine binding or credential changed during retry",
        );
      }

      if (detail.operation !== "upsert" || !("statusId" in detail.fields)) {
        await completeRetriedApplicationTx(transaction, claim, {
          state: "skipped",
          refId: null,
          workId: null,
          outcome: { reason: "private-issue", provenance: "redmine-inbound-retry" },
        });
        return { applicationId: claim.id, state: "skipped" as const, issueKey: null };
      }
      const readMap =
        current.binding.readMap &&
        typeof current.binding.readMap === "object" &&
        !Array.isArray(current.binding.readMap)
          ? (current.binding.readMap as Record<string, unknown>)
          : {};
      if (!current.binding.bootstrapCutoff) {
        throw new AppError(
          409,
          "REDMINE_BOOTSTRAP_CUTOFF_MISSING",
          "Redmine binding has no bootstrap cutoff",
        );
      }
      if (
        !isEligibleRedmineIssueImport(
          detail,
          readMap[detail.fields.statusId],
          current.binding.bootstrapCutoff,
        )
      ) {
        await completeRetriedApplicationTx(transaction, claim, {
          state: "skipped",
          refId: null,
          workId: null,
          outcome: {
            reason: "pre-activation-closed-history",
            provenance: "redmine-inbound-retry",
          },
          remoteUpdatedAt: detail.changedAt,
          sourceVersion: detail.sourceVersion,
        });
        return { applicationId: claim.id, state: "skipped" as const, issueKey: null };
      }
      const result = await importUnlinkedIssueTx(
        transaction,
        {
          connectionId,
          bindingId,
          projectId: current.binding.projectId,
          projectKey: current.binding.project.key,
          workspaceId: current.connection.workspaceId,
          readMap: current.binding.readMap,
          provenance: "redmine-inbound-retry",
          applicationClaim: claim,
          actorMemberId: current.credential.memberId,
        },
        detail,
      );
      return {
        applicationId: claim.id,
        state: result.kind === "imported" ? ("applied" as const) : ("skipped" as const),
        issueKey: result.issueKey,
      };
    }, { timeout: 30_000 });
  } catch (error) {
    return rejectRetry(claim, error);
  }
}

async function applyChange(
  database: PrismaClient,
  binding: ClaimedBinding,
  change: InboundIssueStatusChange,
  loadIssueDetail: (options: InboundIssueDetailOptions) => Promise<InboundIssueDetail>,
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
    let detail: InboundIssueDetail;
    try {
      detail = await loadIssueDetail({
        baseUrl: binding.baseUrl,
        apiKey,
        remoteProjectId: binding.remoteProjectId,
        remoteIssueId: change.entityId,
      });
    } catch (error) {
      if (isProviderAuthenticationError(error) || isRetryableProviderError(error)) throw error;
      return recordInboundFailure(database, binding, change, null, error);
    }
    if (
      detail.identity.remoteId !== change.entityId ||
      detail.identity.remoteProjectId !== binding.remoteProjectId ||
      detail.changedAt < change.changedAt
    ) {
      return recordInboundFailure(
        database,
        binding,
        change,
        null,
        new AppError(409, "REDMINE_DETAIL_MISMATCH", "Redmine issue detail did not match the poll observation"),
        detail.sourceVersion,
      );
    }
    if (detail.operation === "tombstone" || !("statusId" in detail.fields)) {
      return "detail" as const;
    }
    if (
      !isEligibleRedmineIssueImport(
        detail,
        (binding.readMap as StatusReadMap)[detail.fields.statusId],
        binding.bootstrapCutoff,
      )
    ) {
      return recordHistoricalClosedIssue(database, binding, change, detail);
    }

    try {
      return await database.$transaction(async (transaction) => {
        const active = await lockPollSnapshot(transaction, binding);
        if (!active) return "stale" as const;

        await importUnlinkedIssueTx(
          transaction,
          {
            connectionId: binding.connectionId,
            bindingId: binding.id,
            projectId: binding.projectId,
            projectKey: active.project.key,
            workspaceId: active.connection.workspaceId,
            readMap: active.readMap,
            provenance: "redmine-inbound-discovery",
            actorMemberId: binding.actorMemberId,
          },
          detail,
        );
        return "detail" as const;
      });
    } catch (error) {
      if (
        error instanceof AppError &&
        ["REDMINE_STATUS_UNMAPPED", "REDMINE_PRIORITY_UNMAPPED", "REDMINE_PREVIEW_STALE"].includes(
          error.code,
        )
      ) {
        return recordInboundFailure(
          database,
          binding,
          change,
          null,
          error,
          detail.sourceVersion,
        );
      }
      throw error;
    }
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
        state: "skipped",
        outcome: {
          reason: "stale-or-correlated-echo",
          baselineRemoteVersion: ref.remoteUpdatedAt.toISOString(),
        },
      },
      skipDuplicates: true,
    });
    return "processed" as const;
  }
  if (!allowDetail) return "detail-limit" as const;
  let detail: InboundIssueDetail;
  try {
    detail = await loadIssueDetail({
      baseUrl: binding.baseUrl,
      apiKey,
      remoteProjectId: binding.remoteProjectId,
      remoteIssueId: change.entityId,
    });
  } catch (error) {
    if (isProviderAuthenticationError(error) || isRetryableProviderError(error)) throw error;
    return recordInboundFailure(database, binding, change, ref.id, error);
  }
  if (
    detail.identity.remoteId !== change.entityId ||
    detail.identity.remoteProjectId !== binding.remoteProjectId ||
    detail.changedAt < change.changedAt
  ) {
    return recordInboundFailure(
      database,
      binding,
      change,
      ref.id,
      new AppError(
        409,
        "REDMINE_DETAIL_MISMATCH",
        "Redmine issue detail did not match the poll observation",
      ),
      detail.sourceVersion,
    );
  }
  return convergeLinkedIssue(database, binding, change, detail);
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
    if (!(await renewBindingPollLease(
      database,
      binding,
      new Date(dependencies.now().getTime() + dependencies.leaseMs),
    ))) return;
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
    const binding = await claimBindingPollLease(database, now, leaseMs, attemptedBindingIds);
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
