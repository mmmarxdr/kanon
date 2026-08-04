import { randomUUID } from "node:crypto";
import { Prisma, type IntegrationSyncWork, type PrismaClient } from "@prisma/client";
import { env } from "../../config/env.js";
import {
  ProviderDispatchError,
  isProviderAuthenticationError,
  isRetryableProviderError,
  safeErrorEvidence,
  type CanonicalCycle,
  type CanonicalIssue,
  type CanonicalIssuePatch,
  type CanonicalProject,
  type CanonicalTimeEntry,
  type PmProviderAdapter,
  type ProviderCreateReconciliationRequest,
  type PushResult,
  type StatusWriteMap,
  TIME_ENTRY_ACTIVITY_MAP_KEY,
} from "./core/types.js";
import {
  ExternalRefBackfillInvariantError,
  withTargetedExternalRefBackfillWriteGate,
} from "./backfill.js";
import { claimIntegrationWork } from "./claims.js";
import { decrypt as decryptCredential } from "./core/crypto.js";
import {
  ISSUE_CAPTURE_FIELDS,
  ISSUE_SCHEDULE_CAPTURE_FIELDS,
} from "./issue-mutation-contract.js";
import { RedmineProviderAdapter } from "./providers/redmine/adapter.js";
import { RedmineHttpClient } from "./providers/redmine/http-client.js";
const MAX_ATTEMPTS = 8;
const BASE_RETRY_MS = 30_000;
const MAX_RETRY_MS = 3_600_000;
const DEFAULT_TIME_BUDGET_MS = 90_000;
const AUTH_BLOCKED_UNTIL = new Date("9999-12-31T23:59:59.999Z");
const ISSUE_FIELDS = new Set<string>([
  ...ISSUE_CAPTURE_FIELDS,
  ...ISSUE_SCHEDULE_CAPTURE_FIELDS,
]);
type ExternalEntityType = "project" | "cycle" | "issue" | "time_entry" | "user";
export type IntegrationDispatchAdapter = Pick<
  PmProviderAdapter,
  "ensureProject" | "ensureCycle" | "pushIssue" | "reconcileCreate"
> & Partial<Pick<PmProviderAdapter, "pushTimeEntry">>;
export interface IntegrationWorkerLogger {
  info(context: unknown, message: string): void;
  warn(context: unknown, message: string): void;
  error(context: unknown, message: string): void;
}
export interface IntegrationWorkerAdapterOptions {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly writeMap: StatusWriteMap;
  readonly resolveExternalId: (type: ExternalEntityType, id: string) => Promise<string | null>;
  readonly warn: (context: unknown, message: string) => void;
}
export interface IntegrationWorkerDependencies {
  readonly now?: () => Date;
  readonly jitter?: (baseDelayMs: number) => number;
  readonly decrypt?: (ciphertext: string) => string;
  readonly createAdapter?: (options: IntegrationWorkerAdapterOptions) => IntegrationDispatchAdapter;
  readonly claim?: typeof claimIntegrationWork;
  readonly logger?: IntegrationWorkerLogger;
  readonly limit?: number;
  readonly leaseMs?: number;
  readonly timeBudgetMs?: number;
  readonly shouldStop?: () => boolean;
}
type Dispatch =
  | { kind: "project"; entity: CanonicalProject }
  | { kind: "cycle"; entity: CanonicalCycle }
  | { kind: "issue"; entity: CanonicalIssue; patch: CanonicalIssuePatch }
  | { kind: "time_entry"; entity: CanonicalTimeEntry; activityId: string };
type Prepared = {
  work: IntegrationSyncWork;
  credential: UsedCredential;
  adapter: IntegrationWorkerAdapterOptions;
  dispatch: Dispatch;
  hasRemoteRef: boolean;
};
type PrepareResult =
  | { kind: "ready"; value: Prepared }
  | { kind: "stale" }
  | { kind: "skipped"; reason: string; state?: "skipped" | "dead" };
type UsedCredential = { id: string; encryptedKey: string; lastValidatedAt: Date | null };
type CredentialResult =
  | { ok: true; apiKey: string; credential: UsedCredential }
  | { ok: false; reason: string; credential?: UsedCredential };
type AmbiguityPrepared = {
  work: IntegrationSyncWork;
  credential: UsedCredential;
  adapter: IntegrationWorkerAdapterOptions;
  request: ProviderCreateReconciliationRequest;
};
type AmbiguityClaimResult =
  | { kind: "none" }
  | { kind: "handled" }
  | { kind: "claimed"; value: AmbiguityPrepared };
type AuthFailureMode = "definitive" | "ambiguous";
type Deps = Required<
  Pick<IntegrationWorkerDependencies, "jitter" | "decrypt" | "createAdapter" | "claim" | "logger">
> &
  Pick<
    IntegrationWorkerDependencies,
    "now" | "limit" | "leaseMs" | "timeBudgetMs" | "shouldStop"
  >;
class TerminalError extends Error {}
class StaleFinalizeError extends Error {}
class AttachConflictError extends Error {}
const defaultLogger: IntegrationWorkerLogger = {
  info: (context, message) => console.info(message, context),
  warn: (context, message) => console.warn(message, context),
  error: (context, message) => console.error(message, context),
};
const defaultAdapter = (options: IntegrationWorkerAdapterOptions): IntegrationDispatchAdapter =>
  new RedmineProviderAdapter(
    new RedmineHttpClient(options.baseUrl, options.apiKey, {
      endpointAllowlist: env.REDMINE_ENDPOINT_ALLOWLIST,
    }),
    options,
  );
function deps(value: IntegrationWorkerDependencies): Deps {
  return {
    now: value.now,
    jitter: value.jitter ?? ((base) => Math.floor(Math.random() * Math.min(base * 0.1, 30_000))),
    decrypt: value.decrypt ?? decryptCredential,
    createAdapter: value.createAdapter ?? defaultAdapter,
    claim: value.claim ?? claimIntegrationWork,
    logger: value.logger ?? defaultLogger,
    limit: value.limit,
    leaseMs: value.leaseMs,
    timeBudgetMs: value.timeBudgetMs,
    shouldStop: value.shouldStop,
  };
}
function log(d: Deps, level: keyof IntegrationWorkerLogger, context: unknown, message: string) {
  try {
    d.logger[level](context, message);
  } catch {
    // Logging never changes durable worker state.
  }
}
async function databaseNow(database: Pick<PrismaClient, "$queryRaw">, injected?: () => Date) {
  if (injected) return injected();
  const [row] = await database.$queryRaw<Array<{ now: Date }>>`SELECT clock_timestamp() AS "now"`;
  if (!row) throw new Error("Database clock unavailable");
  return row.now;
}
export function retryDelayMs(attempts: number, jitter: (base: number) => number = () => 0): number {
  if (!Number.isSafeInteger(attempts) || attempts < 1)
    throw new RangeError("retry attempts must be positive");
  const base = Math.min(BASE_RETRY_MS * 2 ** Math.min(attempts - 1, 20), MAX_RETRY_MS);
  const extra = jitter(base);
  if (!Number.isFinite(extra)) throw new RangeError("retry jitter must be finite");
  return Math.max(0, Math.min(MAX_RETRY_MS, Math.round(base + extra)));
}
const fenced = (work: IntegrationSyncWork): Prisma.IntegrationSyncWorkWhereInput => ({
  id: work.id,
  state: "leased",
  leaseToken: work.leaseToken,
  fence: work.fence,
  epoch: work.epoch,
});
const leased = (current: IntegrationSyncWork, claimed: IntegrationSyncWork, now: Date) =>
  current.bindingId === claimed.bindingId &&
  current.state === "leased" &&
  current.leaseToken !== null &&
  current.leaseToken === claimed.leaseToken &&
  current.fence === claimed.fence &&
  current.epoch === claimed.epoch &&
  current.leaseUntil !== null &&
  current.leaseUntil > now;
async function lockWork(
  transaction: Prisma.TransactionClient,
  work: Pick<IntegrationSyncWork, "id" | "bindingId">,
) {
  await transaction.$queryRaw`
    SELECT connection."id" FROM "integration_connections" connection
    JOIN "integration_project_bindings" binding ON binding."connection_id" = connection."id"
    WHERE binding."id" = ${work.bindingId}::uuid FOR UPDATE OF connection
  `;
  await transaction.$queryRaw`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${work.bindingId}::uuid FOR UPDATE`;
  await transaction.$queryRaw`SELECT "id" FROM "integration_sync_work" WHERE "id" = ${work.id}::uuid FOR UPDATE`;
  return transaction.integrationSyncWork.findUnique({
    where: { id: work.id },
    include: {
      binding: {
        include: { connection: true, project: { select: { workspaceId: true } } },
      },
    },
  });
}
type LockedWork = NonNullable<Awaited<ReturnType<typeof lockWork>>>;

async function entityOwned(
  transaction: Prisma.TransactionClient,
  current: LockedWork,
): Promise<boolean> {
  if (
    current.binding.connection.workspaceId !== current.binding.project.workspaceId ||
    current.binding.connection.lifecycle !== "active" ||
    current.binding.lifecycle !== "active"
  ) {
    return false;
  }
  if (current.entityType === "project") {
    if (current.entityId !== current.binding.projectId) return false;
    return (
      (await transaction.project.count({
        where: {
          id: current.entityId,
          workspaceId: current.binding.connection.workspaceId,
        },
      })) === 1
    );
  }
  if (current.entityType === "issue") {
    return (
      (await transaction.issue.count({
        where: {
          id: current.entityId,
          projectId: current.binding.projectId,
          project: { workspaceId: current.binding.connection.workspaceId },
        },
      })) === 1
    );
  }
  if (current.entityType === "cycle") {
    return (
      (await transaction.cycle.count({
        where: {
          id: current.entityId,
          projectId: current.binding.projectId,
          project: { workspaceId: current.binding.connection.workspaceId },
        },
      })) === 1
    );
  }
  if (current.entityType === "time_entry") {
    return (
      (await transaction.timeEntry.count({
        where: {
          id: current.entityId,
          issue: {
            projectId: current.binding.projectId,
            project: { workspaceId: current.binding.connection.workspaceId },
          },
        },
      })) === 1
    );
  }
  return false;
}
function issueFields(payload: Prisma.JsonValue) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload["version"] !== 1
  ) {
    throw new TerminalError("Unsupported integration issue payload");
  }
  const fields = payload["fields"];
  if (
    !fields ||
    typeof fields !== "object" ||
    Array.isArray(fields) ||
    Object.keys(fields).some((key) => !ISSUE_FIELDS.has(key))
  ) {
    throw new TerminalError("Unsupported integration issue fields");
  }
  return fields as Record<string, Prisma.JsonValue>;
}
function confirmedTimePayload(payload: Prisma.JsonValue) {
  if (
    !payload ||
    typeof payload !== "object" ||
    Array.isArray(payload) ||
    payload["version"] !== 1 ||
    typeof payload["targetHours"] !== "string" ||
    !Array.isArray(payload["entryIds"]) ||
    payload["entryIds"].some((id) => typeof id !== "string")
  ) {
    throw new TerminalError("Unsupported integration time-entry payload");
  }
  return {
    targetHours: payload["targetHours"],
    entryIds: [...payload["entryIds"]].sort() as string[],
  };
}
const omit = { kind: "omit" } as const;
const field = <T>(changed: boolean, value: T | null) =>
  changed
    ? value === null
      ? ({ kind: "clear", value: null } as const)
      : ({ kind: "set", value } as const)
    : omit;
async function credential(
  transaction: Prisma.TransactionClient,
  current: Awaited<ReturnType<typeof lockWork>>,
  d: Deps
): Promise<CredentialResult> {
  if (!current) return { ok: false, reason: "Work no longer exists" };
  let id = current.authCredentialId;
  if (current.actorKind !== "user") {
    if (
      !(["system", "ai"] as string[]).includes(current.actorKind) ||
      !current.binding.connection.serviceFallbackEnabled
    ) {
      return { ok: false, reason: "Service credential fallback is not enabled" };
    }
    id = current.binding.connection.serviceCredentialId;
  }
  if (!id) {
    return {
      ok: false,
      reason:
        current.actorKind === "user"
          ? "User work has no captured credential"
          : "Service credential fallback is missing",
    };
  }
  const value = await transaction.memberIntegrationCredential.findUnique({
    where: { id },
    include: { member: { select: { workspaceId: true } } },
  });
  if (
    !value ||
    value.connectionId !== current.binding.connectionId ||
    value.member.workspaceId !== current.binding.connection.workspaceId ||
    value.revokedAt ||
    (current.actorKind === "user" && current.actorKey !== `member:${value.memberId}`)
  ) {
    return {
      ok: false,
      reason: "Captured credential is missing, revoked, invalid, or outside the work scope",
    };
  }
  if (value.lastAuthStatus === "invalid") {
    return {
      ok: false,
      reason: "credential_invalid",
      credential: { id, encryptedKey: value.encryptedKey, lastValidatedAt: value.lastValidatedAt },
    };
  }
  if (value.lastAuthStatus !== "valid") {
    return {
      ok: false,
      reason: "Captured credential is missing, revoked, invalid, or outside the work scope",
    };
  }
  try {
    return {
      ok: true,
      apiKey: d.decrypt(value.encryptedKey),
      credential: {
        id: value.id,
        encryptedKey: value.encryptedKey,
        lastValidatedAt: value.lastValidatedAt,
      },
    };
  } catch {
    return { ok: false, reason: "Captured credential cannot be decrypted" };
  }
}
async function prepare(
  database: PrismaClient,
  claimed: IntegrationSyncWork,
  d: Deps
): Promise<PrepareResult> {
  return database.$transaction(async (transaction) => {
    const current = await lockWork(transaction, claimed);
    const now = await databaseNow(transaction, d.now);
    if (
      !current ||
      !leased(current, claimed, now) ||
      current.binding.lifecycle !== "active" ||
      current.binding.connection.lifecycle !== "active" ||
      current.binding.lifecycleEpoch !== current.epoch
    )
      return { kind: "stale" };
    const auth = await credential(transaction, current, d);
    if (!auth.ok) {
      const state = auth.credential ? "dead" : "skipped", authCredentialId = auth.credential?.id;
      const changed = await transaction.integrationSyncWork.updateMany({
        where: { ...fenced(claimed), leaseUntil: { gt: now } },
        data: { state, skippedReason: auth.reason, authCredentialId, leaseToken: null, leaseUntil: null },
      });
      return changed.count
        ? { kind: "skipped", reason: auth.reason, state }
        : { kind: "stale" };
    }
    const refs = new Map<string, string>();
    refs.set(`project:${current.binding.projectId}`, current.binding.remoteProjectId);
    const findRef = async (type: string, id: string, required: boolean) => {
      const ref = await transaction.externalRef.findUnique({
        where: {
          connectionId_entityType_entityId: {
            connectionId: current.binding.connectionId,
            entityType: type,
            entityId: id,
          },
        },
      });
      if (ref && ref.bindingId !== current.bindingId)
        throw new TerminalError(`${type} reference belongs to another binding`);
      if (!ref && required) throw new TerminalError(`Missing ${type} reference`);
      if (ref) refs.set(`${type}:${id}`, ref.externalId);
      return ref;
    };
    let dispatch: Dispatch;
    let ownRef: Awaited<ReturnType<typeof findRef>> = null;
    if (current.entityType === "issue") {
      const fields = issueFields(current.payload);
      const changed = (name: string) => Object.prototype.hasOwnProperty.call(fields, name);
      const issue = await transaction.issue.findFirst({
        where: { id: current.entityId, projectId: current.binding.projectId },
        include: { assignee: { include: { user: { select: { email: true } } } }, schedule: true },
      });
      if (!issue)
        throw new TerminalError("Canonical issue no longer exists in the binding project");
      ownRef = await findRef("issue", issue.id, false);
      if (current.refId && current.refId !== ownRef?.id)
        throw new TerminalError("Captured issue reference is stale");
      const creating = !ownRef;
      const currentValues: Record<string, Prisma.JsonValue> = {
        title: issue.title,
        description: issue.description,
        state: issue.state,
        assigneeId: issue.assigneeId,
        cycleId: issue.cycleId,
        estimate: issue.estimate,
        estimateHours:
          issue.schedule?.estimateHours == null ? null : Number(issue.schedule.estimateHours),
        startDate: issue.schedule?.startDate?.toISOString() ?? null,
        dueDate: issue.schedule?.dueDate?.toISOString() ?? null,
        progress: issue.schedule?.progress ?? 0,
      };
      if (
        current.operation !== "create" &&
        Object.entries(fields).some(([name, captured]) => captured !== currentValues[name])
      ) {
        const superseded = await transaction.integrationSyncWork.updateMany({
          where: { ...fenced(claimed), leaseUntil: { gt: now } },
          data: { state: "superseded", leaseToken: null, leaseUntil: null },
        });
        return superseded.count
          ? { kind: "skipped", reason: "Captured fields were superseded" }
          : { kind: "stale" };
      }
      if (issue.assignee && (creating || changed("assigneeId"))) {
        const identity = await transaction.integrationExternalIdentity.findUnique({
          where: {
            bindingId_memberId: { bindingId: current.bindingId, memberId: issue.assignee.id },
          },
        });
        if (!identity) throw new TerminalError("Missing user identity mapping");
        refs.set(`user:${issue.assignee.id}`, identity.remoteUserId);
      }
      if (issue.cycleId && (creating || changed("cycleId")))
        await findRef("cycle", issue.cycleId, true);
      const entity: CanonicalIssue = {
        id: issue.id,
        key: issue.key,
        projectId: issue.projectId,
        cycleId: issue.cycleId,
        title: issue.title,
        description: issue.description,
        status: issue.state,
        assignee: issue.assignee
          ? {
              id: issue.assignee.id,
              displayName: issue.assignee.username,
              email: issue.assignee.user.email,
            }
          : null,
        estimateHours:
          issue.schedule?.estimateHours == null ? null : Number(issue.schedule.estimateHours),
        startDate: issue.schedule?.startDate ?? null,
        dueDate: issue.schedule?.dueDate ?? null,
        progress: issue.schedule?.progress ?? 0,
      };
      dispatch = {
        kind: "issue",
        entity,
        patch: {
          title: changed("title") ? { kind: "set", value: entity.title } : omit,
          description: field(changed("description"), entity.description),
          status:
            changed("state") || current.operation === "close"
              ? { kind: "set", value: entity.status }
              : omit,
          assignee: field(changed("assigneeId"), entity.assignee),
          estimateHours: field(
            changed("estimate") || changed("estimateHours"),
            entity.estimateHours,
          ),
          cycleId: field(changed("cycleId"), entity.cycleId),
          startDate: field(changed("startDate"), entity.startDate),
          dueDate: field(changed("dueDate"), entity.dueDate),
          progress: changed("progress") ? { kind: "set", value: entity.progress } : omit,
        },
      };
    } else if (current.entityType === "time_entry") {
      const captured = confirmedTimePayload(current.payload);
      const root = await transaction.timeEntry.findFirst({
        where: {
          id: current.entityId,
          status: "approved",
          issue: { projectId: current.binding.projectId },
        },
        select: {
          id: true,
          issueId: true,
          memberId: true,
          hours: true,
          workedOn: true,
          adjustsId: true,
        },
      });
      if (!root || !root.issueId || root.adjustsId) {
        throw new TerminalError("Canonical time entry no longer exists in the binding project");
      }
      const entries = await transaction.timeEntry.findMany({
        where: { issueId: root.issueId, status: "approved" },
        select: { id: true, hours: true, adjustsId: true },
      });
      const byId = new Map(entries.map((entry) => [entry.id, entry]));
      const component = entries.filter((entry) => {
        let currentEntry = entry;
        const seen = new Set<string>();
        while (currentEntry.adjustsId) {
          if (seen.has(currentEntry.id)) throw new TerminalError("Time adjustment cycle detected");
          seen.add(currentEntry.id);
          const adjusted = byId.get(currentEntry.adjustsId);
          if (!adjusted) return false;
          currentEntry = adjusted;
        }
        return currentEntry.id === root.id;
      });
      const entryIds = component.map(({ id }) => id).sort();
      const targetHours = component
        .reduce((sum, entry) => sum.plus(entry.hours), new Prisma.Decimal(0))
        .toString();
      if (
        captured.targetHours !== targetHours ||
        captured.entryIds.length !== entryIds.length ||
        captured.entryIds.some((id, index) => id !== entryIds[index])
      ) {
        const superseded = await transaction.integrationSyncWork.updateMany({
          where: { ...fenced(claimed), leaseUntil: { gt: now } },
          data: { state: "superseded", leaseToken: null, leaseUntil: null },
        });
        return superseded.count
          ? { kind: "skipped", reason: "Captured time was superseded" }
          : { kind: "stale" };
      }
      if (new Prisma.Decimal(targetHours).lessThan(0)) {
        throw new TerminalError("Confirmed time total cannot be negative");
      }
      ownRef = await findRef("time_entry", root.id, false);
      if (current.refId && current.refId !== ownRef?.id) {
        throw new TerminalError("Captured time-entry reference is stale");
      }
      const issueRef = await findRef("issue", root.issueId, false);
      if (!issueRef) throw new Error("Remote issue reference is not ready");
      const writeMap = current.binding.writeMap as Record<string, unknown>;
      const activityId = writeMap[TIME_ENTRY_ACTIVITY_MAP_KEY];
      if (typeof activityId !== "string" || activityId.length === 0) {
        throw new TerminalError("Missing configured Redmine time-entry activity");
      }
      dispatch = {
        kind: "time_entry",
        activityId,
        entity: {
          id: root.id,
          issueId: root.issueId,
          hours: targetHours,
          workedOn: root.workedOn,
        },
      };
    } else if (current.entityType === "cycle") {
      const cycle = await transaction.cycle.findFirst({
        where: { id: current.entityId, projectId: current.binding.projectId },
      });
      if (!cycle)
        throw new TerminalError("Canonical cycle no longer exists in the binding project");
      ownRef = await findRef("cycle", cycle.id, false);
      if (current.refId && current.refId !== ownRef?.id)
        throw new TerminalError("Captured cycle reference is stale");
      dispatch = {
        kind: "cycle",
        entity: {
          id: cycle.id,
          projectId: cycle.projectId,
          name: cycle.name,
          startDate: cycle.startDate,
          endDate: cycle.endDate,
        },
      };
    } else if (current.entityType === "project") {
      const project = await transaction.project.findFirst({
        where: { id: current.entityId, workspaceId: current.binding.connection.workspaceId },
      });
      if (!project || project.id !== current.binding.projectId)
        throw new TerminalError("Canonical project no longer exists in the binding workspace");
      dispatch = {
        kind: "project",
        entity: {
          id: project.id,
          key: project.key,
          name: project.name,
          description: project.description,
        },
      };
    } else throw new TerminalError(`Unsupported integration entity type ${current.entityType}`);
    if (ownRef) refs.set(`${current.entityType}:${current.entityId}`, ownRef.externalId);
    const map = Object.fromEntries(refs);
    return {
      kind: "ready",
      value: {
        work: current,
        credential: auth.credential,
        hasRemoteRef: !!ownRef || current.entityType === "project",
        dispatch,
        adapter: {
          baseUrl: current.binding.connection.baseUrl,
          apiKey: auth.apiKey,
          writeMap: current.binding.writeMap as StatusWriteMap,
          resolveExternalId: async (type, id) => map[`${type}:${id}`] ?? null,
          warn: (context, message) => log(d, "warn", context, message),
        },
      },
    };
  });
}

function localAmbiguityEvidence(work: IntegrationSyncWork) {
  return {
    workId: work.id,
    bindingId: work.bindingId,
    entityType: work.entityType,
    entityId: work.entityId,
    correlationId: work.correlationId,
    epoch: work.epoch,
    fence: work.fence,
  };
}

function remoteMatches(matches: readonly PushResult[]) {
  return [...matches]
    .sort((left, right) =>
      left.externalId.localeCompare(right.externalId, undefined, { numeric: true }),
    )
    .slice(0, 10)
    .map((match) => ({
      externalId: match.externalId,
      requestedStatusId: match.requestedStatusId,
      achievedStatusId: match.achievedStatusId,
      remoteVersion: match.remoteVersion,
    }));
}

const staleEpochEvidence = (
  current: LockedWork,
  outcome?: Prisma.InputJsonObject,
): Prisma.InputJsonObject => ({
  reason: "stale-epoch-unresolved",
  workEpoch: current.epoch,
  bindingEpoch: current.binding.lifecycleEpoch,
  ...(outcome ? { outcome } : {}),
});

async function createAmbiguityConflict(
  transaction: Prisma.TransactionClient,
  current: LockedWork,
  remoteEvidence: Prisma.InputJsonObject,
  now: Date,
) {
  const existing = await transaction.integrationConflict.count({
    where: { workId: current.id, state: "open" },
  });
  if (existing === 0) {
    await transaction.integrationConflict.create({
      data: {
        kind: "outbound-create-ambiguity",
        bindingId: current.bindingId,
        workId: current.id,
        refId: current.refId,
        localEvidence: localAmbiguityEvidence(current),
        remoteEvidence,
      },
    });
  }
  const where: Prisma.IntegrationSyncWorkWhereInput =
    current.state === "leased"
      ? { ...fenced(current), leaseUntil: { gt: now } }
      : { id: current.id, state: "ambiguous", fence: current.fence, epoch: current.epoch };
  const changed = await transaction.integrationSyncWork.updateMany({
    where,
    data: { state: "ambiguous", leaseToken: null, leaseUntil: null },
  });
  if (changed.count !== 1) throw new StaleFinalizeError();
}

async function claimAmbiguous(
  database: PrismaClient,
  d: Deps,
): Promise<AmbiguityClaimResult> {
  const dueAt = d.now ? Prisma.sql`${d.now()}` : Prisma.sql`clock_timestamp()`;
  const [candidate] = await database.$queryRaw<Array<{ id: string; bindingId: string }>>(
    Prisma.sql`
      SELECT work."id", work."binding_id" AS "bindingId"
      FROM "integration_sync_work" AS work
      JOIN "integration_project_bindings" AS binding ON binding."id" = work."binding_id"
      JOIN "integration_connections" AS connection ON connection."id" = binding."connection_id"
      WHERE work."direction" = 'outbound'::"SyncDirection"
        AND work."state" = 'ambiguous'::"SyncWorkState"
        AND work."skipped_reason" IS DISTINCT FROM 'credential_invalid'
        AND work."available_at" <= ${dueAt}
        AND binding."lifecycle" = 'active'::"IntegrationLifecycle"
        AND connection."lifecycle" = 'active'::"IntegrationLifecycle"
        AND NOT EXISTS (
          SELECT 1 FROM "integration_conflicts" AS conflict
          WHERE conflict."work_id" = work."id" AND conflict."state" = 'open'::"ConflictState"
        )
      ORDER BY work."sequence", connection."id", binding."id", work."id"
      LIMIT 1
    `,
  );
  if (!candidate) return { kind: "none" };

  return database.$transaction(async (transaction) => {
    const current = await lockWork(transaction, candidate);
    const now = await databaseNow(transaction, d.now);
    if (
      !current ||
      current.state !== "ambiguous" ||
      current.skippedReason === "credential_invalid" ||
      current.availableAt > now ||
      current.binding.lifecycle !== "active" ||
      current.binding.connection.lifecycle !== "active" ||
      (await transaction.integrationConflict.count({
        where: { workId: current.id, state: "open" },
      })) > 0
    ) {
      return { kind: "none" };
    }

    const ref = await transaction.externalRef.findUnique({
      where: {
        connectionId_entityType_entityId: {
          connectionId: current.binding.connectionId,
          entityType: current.entityType,
          entityId: current.entityId,
        },
      },
    });
    if (current.epoch !== current.binding.lifecycleEpoch) {
      if (ref?.bindingId === current.bindingId) {
        await transaction.integrationSyncWork.update({
          where: { id: current.id },
          data: { state: "superseded", leaseToken: null, leaseUntil: null },
        });
      } else {
        await createAmbiguityConflict(
          transaction,
          current,
          staleEpochEvidence(current, {
            reference: ref ? "binding-mismatch" : "missing",
            ...(ref ? { externalRefId: ref.id } : {}),
          }),
          now,
        );
      }
      return { kind: "handled" };
    }
    if (ref) {
      if (ref.bindingId !== current.bindingId) {
        await createAmbiguityConflict(
          transaction,
          current,
          { reason: "reference-binding-mismatch", externalRefId: ref.id },
          now,
        );
      } else {
        await transaction.integrationSyncWork.update({
          where: { id: current.id },
          data: { state: "retry", availableAt: now, leaseToken: null, leaseUntil: null },
        });
      }
      return { kind: "handled" };
    }

    if (!(await entityOwned(transaction, current))) {
      await createAmbiguityConflict(
        transaction,
        current,
        { reason: "local-entity-unavailable", entityType: current.entityType },
        now,
      );
      return { kind: "handled" };
    }
    if (
      current.entityType !== "issue" &&
      current.entityType !== "cycle" &&
      current.entityType !== "time_entry"
    ) {
      await createAmbiguityConflict(
        transaction,
        current,
        { reason: "no-stable-marker", entityType: current.entityType },
        now,
      );
      return { kind: "handled" };
    }

    let request: ProviderCreateReconciliationRequest;
    if (current.entityType === "time_entry") {
      const entry = await transaction.timeEntry.findFirst({
        where: { id: current.entityId, issue: { projectId: current.binding.projectId } },
        select: { issueId: true, workedOn: true },
      });
      const issueRef = entry?.issueId
        ? await transaction.externalRef.findUnique({
            where: {
              connectionId_entityType_entityId: {
                connectionId: current.binding.connectionId,
                entityType: "issue",
                entityId: entry.issueId,
              },
            },
          })
        : null;
      if (!entry?.issueId || !issueRef || issueRef.bindingId !== current.bindingId) {
        await createAmbiguityConflict(
          transaction,
          current,
          { reason: "missing-time-entry-issue-reference" },
          now,
        );
        return { kind: "handled" };
      }
      request = {
        entityType: "time_entry",
        entityId: current.entityId,
        remoteProjectId: current.binding.remoteProjectId,
        remoteIssueId: issueRef.externalId,
        spentOn: entry.workedOn.toISOString().slice(0, 10),
      };
    } else {
      request = {
        entityType: current.entityType,
        entityId: current.entityId,
        remoteProjectId: current.binding.remoteProjectId,
      };
    }

    const auth = await credential(transaction, current, d);
    if (!auth.ok) {
      if (auth.credential) {
        await transaction.integrationSyncWork.update({
          where: { id: current.id },
          data: {
            state: "ambiguous",
            availableAt: AUTH_BLOCKED_UNTIL,
            skippedReason: "credential_invalid",
            authCredentialId: auth.credential.id,
          },
        });
        return { kind: "handled" };
      }
      await createAmbiguityConflict(
        transaction,
        current,
        { reason: "credential-unavailable" },
        now,
      );
      return { kind: "handled" };
    }
    const leaseMs = d.leaseMs ?? 120_000;
    const claimed = await transaction.integrationSyncWork.update({
      where: { id: current.id },
      data: {
        state: "leased",
        leaseToken: randomUUID(),
        leaseUntil: new Date(now.getTime() + leaseMs),
        fence: { increment: 1 },
      },
    });
    return {
      kind: "claimed",
      value: {
        work: claimed,
        credential: auth.credential,
        request,
        adapter: {
          baseUrl: current.binding.connection.baseUrl,
          apiKey: auth.apiKey,
          writeMap: current.binding.writeMap as StatusWriteMap,
          resolveExternalId: async (type, id) =>
            type === "project" && id === current.binding.projectId
              ? current.binding.remoteProjectId
              : null,
          warn: (context, message) => log(d, "warn", context, message),
        },
      },
    };
  });
}

async function attachResult(
  transaction: Prisma.TransactionClient,
  current: LockedWork,
  work: IntegrationSyncWork,
  result: PushResult,
  now: Date,
): Promise<string | null> {
  const binding = current.binding;
  if (result.deleted) {
    const existing = await transaction.externalRef.findUnique({
      where: {
        connectionId_entityType_entityId: {
          connectionId: binding.connectionId,
          entityType: work.entityType,
          entityId: work.entityId,
        },
      },
    });
    if (existing && existing.bindingId !== binding.id) {
      throw new AttachConflictError("External reference belongs to another binding");
    }
    if (existing) await transaction.externalRef.delete({ where: { id: existing.id } });
    const done = await transaction.integrationSyncWork.updateMany({
      where: { ...fenced(work), leaseUntil: { gt: now } },
      data: { state: "done", refId: null, leaseToken: null, leaseUntil: null },
    });
    if (done.count !== 1) throw new StaleFinalizeError();
    return null;
  }
  const [existing, remote] = await Promise.all([
    transaction.externalRef.findUnique({
      where: {
        connectionId_entityType_entityId: {
          connectionId: binding.connectionId,
          entityType: work.entityType,
          entityId: work.entityId,
        },
      },
    }),
    transaction.externalRef.findUnique({
      where: {
        connectionId_entityType_externalId: {
          connectionId: binding.connectionId,
          entityType: work.entityType,
          externalId: result.externalId,
        },
      },
    }),
  ]);
  if (existing && existing.bindingId !== binding.id) {
    throw new AttachConflictError("External reference belongs to another binding");
  }
  if (existing && existing.externalId !== result.externalId) {
    throw new AttachConflictError("Local entity already has a different external reference");
  }
  if (remote && remote.id !== existing?.id) {
    throw new AttachConflictError("External ID already belongs to another local entity");
  }
  const remoteUpdatedAt =
    result.remoteVersion && !Number.isNaN(Date.parse(result.remoteVersion))
      ? new Date(result.remoteVersion)
      : undefined;
  const common = {
    externalId: result.externalId,
    bindingId: binding.id,
    lastCorrelationId: work.correlationId,
    metadata: { remoteVersion: result.remoteVersion },
    ...(remoteUpdatedAt ? { remoteUpdatedAt } : {}),
  };
  const ref = existing
    ? await transaction.externalRef.update({
        where: { id: existing.id },
        data: { ...common, localVersion: { increment: 1 } },
      })
    : await transaction.externalRef.create({
        data: {
          ...common,
          entityType: work.entityType,
          entityId: work.entityId,
          connectionId: binding.connectionId,
          localVersion: 1,
        },
      });
  const done = await transaction.integrationSyncWork.updateMany({
    where: { ...fenced(work), leaseUntil: { gt: now } },
    data: {
      state: "done",
      refId: ref.id,
      requestedStatus: result.requestedStatusId,
      actualStatus: result.achievedStatusId,
      leaseToken: null,
      leaseUntil: null,
      skippedReason: null,
    },
  });
  if (done.count !== 1) throw new StaleFinalizeError();
  return ref.id;
}

async function finalize(
  database: PrismaClient,
  work: IntegrationSyncWork,
  result: PushResult,
  d: Deps,
  allowStaleEpoch = false,
) {
  await database.$transaction(async (transaction) => {
    const current = await lockWork(transaction, work);
    const now = await databaseNow(transaction, d.now);
    if (
      !current ||
      !leased(current, work, now) ||
      current.binding.lifecycle !== "active" ||
      current.binding.connection.lifecycle !== "active" ||
      (!allowStaleEpoch && current.binding.lifecycleEpoch !== work.epoch) ||
      !(await entityOwned(transaction, current))
    ) {
      throw new StaleFinalizeError();
    }
    await withTargetedExternalRefBackfillWriteGate(transaction, (gated) =>
      attachResult(gated, current, work, result, now),
    );
  });
}

async function backoffAmbiguity(
  database: PrismaClient,
  work: IntegrationSyncWork,
  error: Record<string, string | number>,
  d: Deps,
) {
  return database.$transaction(async (transaction) => {
    const current = await lockWork(transaction, work);
    const now = await databaseNow(transaction, d.now);
    if (!current || !leased(current, work, now)) return false;
    if (current.binding.lifecycleEpoch !== work.epoch) {
      await createAmbiguityConflict(
        transaction,
        current,
        staleEpochEvidence(current, { reason: "transient-read-failure", error }),
        now,
      );
      return "conflict" as const;
    }
    const attempts = current.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await createAmbiguityConflict(
        transaction,
        current,
        { reason: "transient-read-exhausted", attempts: MAX_ATTEMPTS, error },
        now,
      );
      await transaction.integrationSyncWork.update({
        where: { id: current.id },
        data: { attempts: MAX_ATTEMPTS },
      });
      return "conflict" as const;
    }
    const changed = await transaction.integrationSyncWork.updateMany({
      where: { ...fenced(work), leaseUntil: { gt: now } },
      data: {
        state: "ambiguous",
        attempts,
        availableAt: new Date(now.getTime() + retryDelayMs(attempts, d.jitter)),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    return changed.count === 1 ? ("retry" as const) : false;
  });
}

async function conflictAmbiguity(
  database: PrismaClient,
  work: IntegrationSyncWork,
  remoteEvidence: Prisma.InputJsonObject,
  d: Deps,
) {
  return database.$transaction(async (transaction) => {
    const current = await lockWork(transaction, work);
    const now = await databaseNow(transaction, d.now);
    if (!current || !leased(current, work, now)) return false;
    if (current.binding.lifecycleEpoch !== work.epoch) {
      await createAmbiguityConflict(
        transaction,
        current,
        staleEpochEvidence(current, remoteEvidence),
        now,
      );
      return true;
    }
    await createAmbiguityConflict(transaction, current, remoteEvidence, now);
    return true;
  });
}

async function reconcileAmbiguity(
  database: PrismaClient,
  prepared: AmbiguityPrepared,
  d: Deps,
) {
  let matches: readonly PushResult[];
  try {
    matches = await d.createAdapter(prepared.adapter).reconcileCreate(prepared.request);
  } catch (error) {
    if (isProviderAuthenticationError(error)) {
      return failAuthentication(database, prepared.work, prepared.credential, error, "ambiguous", d);
    }
    const safeError = safeErrorEvidence(error);
    if (isRetryableProviderError(error)) {
      const changed = await backoffAmbiguity(database, prepared.work, safeError, d);
      return log(
        d,
        "warn",
        { error: safeError, workId: prepared.work.id, state: changed ? "ambiguous" : "stale" },
        changed === "conflict"
          ? "Integration ambiguity reconciliation needs manual resolution"
          : "Integration ambiguity reconciliation scheduled for retry",
      );
    }
    const changed = await conflictAmbiguity(
      database,
      prepared.work,
      { reason: "terminal-read-failure", error: safeError },
      d,
    );
    return log(
      d,
      "error",
      { error: safeError, workId: prepared.work.id, state: changed ? "ambiguous" : "stale" },
      "Integration ambiguity reconciliation needs manual resolution",
    );
  }

  if (matches.length !== 1) {
    const changed = await conflictAmbiguity(
      database,
      prepared.work,
      {
        reason: matches.length === 0 ? "zero-matches" : "multiple-matches",
        matchCount: matches.length,
        matches: remoteMatches(matches),
      },
      d,
    );
    return log(
      d,
      "warn",
      { matchCount: matches.length, workId: prepared.work.id, state: changed ? "ambiguous" : "stale" },
      "Integration ambiguity reconciliation needs manual resolution",
    );
  }

  try {
    await finalize(database, prepared.work, matches[0]!, d, true);
    log(
      d,
      "info",
      { workId: prepared.work.id, state: "done" },
      "Integration ambiguity reconciled",
    );
  } catch (error) {
    if (
      error instanceof AttachConflictError ||
      error instanceof ExternalRefBackfillInvariantError ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002")
    ) {
      const changed = await conflictAmbiguity(
        database,
        prepared.work,
        { reason: "external-reference-collision", error: safeErrorEvidence(error) },
        d,
      );
      return log(
        d,
        "warn",
        { workId: prepared.work.id, state: changed ? "ambiguous" : "stale" },
        "Integration ambiguity reconciliation needs manual resolution",
      );
    }
    log(
      d,
      "error",
      { error: safeErrorEvidence(error), workId: prepared.work.id, state: "stale" },
      "Integration ambiguity finalize failed",
    );
  }
}

async function moveAmbiguous(database: PrismaClient, work: IntegrationSyncWork) {
  return (
    (
      await database.integrationSyncWork.updateMany({
        where: fenced(work),
        data: {
          state: "ambiguous",
          leaseToken: null,
          leaseUntil: null,
        },
      })
    ).count === 1
  );
}

async function failAuthentication(
  database: PrismaClient,
  work: IntegrationSyncWork,
  credential: UsedCredential,
  error: unknown,
  mode: AuthFailureMode,
  d: Deps,
) {
  try {
    const invalidated = await database.memberIntegrationCredential.updateMany({
      where: {
        id: credential.id,
        encryptedKey: credential.encryptedKey,
        lastAuthStatus: "valid",
        revokedAt: null,
        lastValidatedAt: credential.lastValidatedAt,
      },
      data: { lastAuthStatus: "invalid" },
    });
    const { blocked, state } = await database.$transaction(async (transaction) => {
      const current = await lockWork(transaction, work);
      const now = await databaseNow(transaction, d.now);
      if (!current || !leased(current, work, now)) throw new StaleFinalizeError();
      const currentCredential = await transaction.memberIntegrationCredential.findUnique({
        where: { id: credential.id },
        select: { lastAuthStatus: true, lastValidatedAt: true, revokedAt: true },
      });
      const sameValidation =
        currentCredential?.lastValidatedAt?.getTime() === credential.lastValidatedAt?.getTime() ||
        (currentCredential?.lastValidatedAt === null && credential.lastValidatedAt === null);
      const stillSelected =
        current.actorKind === "user" ||
        current.binding.connection.serviceCredentialId === credential.id;
      const blocked =
        invalidated.count === 1 &&
        currentCredential?.lastAuthStatus === "invalid" &&
        currentCredential.revokedAt === null &&
        sameValidation &&
        stillSelected;
      const state = mode === "ambiguous" ? "ambiguous" : blocked ? "dead" : "retry";
      const changed = await transaction.integrationSyncWork.updateMany({
        where: { ...fenced(work), leaseUntil: { gt: now } },
        data: {
          state,
          ...(blocked
            ? {
                ...(mode === "definitive" ? { attempts: work.attempts + 1 } : {}),
                availableAt: mode === "ambiguous" ? AUTH_BLOCKED_UNTIL : undefined,
                skippedReason: "credential_invalid",
                authCredentialId: credential.id,
              }
            : { availableAt: now, skippedReason: null }),
          leaseToken: null,
          leaseUntil: null,
        },
      });
      if (changed.count !== 1) throw new StaleFinalizeError();
      return { blocked, state };
    });
    log(
      d,
      blocked ? "error" : "warn",
      { credentialId: credential.id, error: safeErrorEvidence(error), workId: work.id, state },
      blocked ? "Integration work auth-blocked" : "Integration work retrying new credential",
    );
  } catch (transitionError) {
    log(
      d,
      "error",
      { error: safeErrorEvidence(transitionError), dispatchError: safeErrorEvidence(error), workId: work.id },
      "Integration work authentication transition failed",
    );
  }
}

async function fail(
  database: PrismaClient,
  prepared: Prepared | null,
  work: IntegrationSyncWork,
  error: unknown,
  d: Deps
) {
  if (prepared && isProviderAuthenticationError(error)) {
    const mode =
      error instanceof ProviderDispatchError && error.outcome === "ambiguous"
        ? "ambiguous"
        : "definitive";
    return failAuthentication(database, work, prepared.credential, error, mode, d);
  }
  const attempts = work.attempts + 1;
  const explicitOutcome = error instanceof ProviderDispatchError ? error.outcome : null;
  const retryable = explicitOutcome === "retry" || isRetryableProviderError(error);
  const ambiguous =
    explicitOutcome === "ambiguous" ||
    (explicitOutcome === null && !!prepared && !prepared.hasRemoteRef && retryable);
  const state =
    ambiguous
      ? "ambiguous"
      : retryable && attempts < MAX_ATTEMPTS
        ? "retry"
        : "dead";
  try {
    const now = await databaseNow(database, d.now);
    const changed = await database.integrationSyncWork.updateMany({
      where: { ...fenced(work), leaseUntil: { gt: now } },
      data: {
        state,
        attempts,
        ...(state === "retry"
          ? { availableAt: new Date(now.getTime() + retryDelayMs(attempts, d.jitter)) }
          : {}),
        leaseToken: null,
        leaseUntil: null,
      },
    });
    if (!changed.count)
      return log(
        d,
        "warn",
        { workId: work.id, state: "stale" },
        "Integration work stale after provider I/O"
      );
    log(
      d,
      state === "dead" ? "error" : "warn",
      { error: safeErrorEvidence(error), workId: work.id, attempts, state },
      state === "retry"
        ? "Integration work scheduled for retry"
        : state === "dead"
          ? "Integration work marked dead"
          : "Integration work became ambiguous"
    );
  } catch (transitionError) {
    log(
      d,
      "error",
      {
        error: safeErrorEvidence(transitionError),
        dispatchError: safeErrorEvidence(error),
        workId: work.id,
      },
      "Integration work failure transition failed"
    );
  }
}

async function process(database: PrismaClient, work: IntegrationSyncWork, d: Deps) {
  let result: PrepareResult;
  try {
    result = await prepare(database, work, d);
  } catch (error) {
    if (error instanceof TerminalError) return fail(database, null, work, error, d);
    return fail(database, null, work, new ProviderDispatchError("retry", error), d);
  }
  if (result.kind === "stale")
    return log(
      d,
      "warn",
      { workId: work.id, state: "stale" },
      "Integration work stale before provider I/O"
    );
  if (result.kind === "skipped")
    return log(
      d,
      "warn",
      { workId: work.id, reason: result.reason, state: result.state ?? "skipped" },
      result.state === "dead" ? "Integration work auth-blocked" : "Integration work skipped",
    );
  const prepared = result.value;
  let pushed: PushResult;
  try {
    const adapter = d.createAdapter(prepared.adapter);
    pushed =
      prepared.dispatch.kind === "issue"
        ? await adapter.pushIssue(prepared.dispatch.entity, prepared.dispatch.patch)
        : prepared.dispatch.kind === "time_entry"
          ? adapter.pushTimeEntry
            ? await adapter.pushTimeEntry(
                prepared.dispatch.entity,
                prepared.dispatch.activityId,
              )
            : (() => {
                throw new TerminalError("Integration adapter cannot write time entries");
              })()
        : prepared.dispatch.kind === "cycle"
          ? await adapter.ensureCycle(prepared.dispatch.entity)
          : await adapter.ensureProject(prepared.dispatch.entity);
  } catch (error) {
    return fail(database, prepared, work, error, d);
  }
  try {
    await finalize(database, prepared.work, pushed, d);
    log(d, "info", { workId: work.id, state: "done" }, "Integration work completed");
  } catch (error) {
    const ambiguous = await moveAmbiguous(database, work).catch((transitionError) => {
      log(
        d,
        "error",
        { error: safeErrorEvidence(transitionError), workId: work.id },
        "Integration work ambiguity transition failed"
      );
      return false;
    });
    log(
      d,
      "error",
      {
        error: safeErrorEvidence(error),
        workId: work.id,
        state: ambiguous ? "ambiguous" : "stale",
      },
      "Integration work finalize failed after provider success"
    );
    if (!ambiguous)
      log(
        d,
        "warn",
        { workId: work.id, state: "stale" },
        "Integration work stale after provider I/O"
      );
  }
}

async function expireLeases(database: PrismaClient, d: Deps, limit: number) {
  const rows = await database.$queryRaw<Array<{ id: string }>>(Prisma.sql`
    WITH expired AS MATERIALIZED (
      SELECT "id" FROM "integration_sync_work"
      WHERE "state" = 'leased'::"SyncWorkState" AND "lease_until" <= clock_timestamp()
      ORDER BY "sequence", "id"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    UPDATE "integration_sync_work" AS work
    SET "state" = 'ambiguous'::"SyncWorkState", "lease_token" = NULL,
        "lease_until" = NULL, "updated_at" = clock_timestamp()
    FROM expired WHERE work."id" = expired."id" RETURNING work."id"
  `);
  for (const row of rows)
    log(d, "warn", { workId: row.id, state: "ambiguous" }, "Integration work became ambiguous");
  return rows.length;
}

export async function runIntegrationWorkerCycle(
  database: PrismaClient,
  dependencies: IntegrationWorkerDependencies = {}
) {
  const d = deps(dependencies);
  const limit = d.limit ?? 100;
  const timeBudgetMs = d.timeBudgetMs ?? DEFAULT_TIME_BUDGET_MS;
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new RangeError("worker limit must be positive");
  if (d.leaseMs !== undefined && (!Number.isSafeInteger(d.leaseMs) || d.leaseMs < 1)) {
    throw new RangeError("leaseMs must be a positive integer");
  }
  if (!Number.isSafeInteger(timeBudgetMs) || timeBudgetMs < 1) {
    throw new RangeError("worker timeBudgetMs must be a positive integer");
  }
  const deadline = performance.now() + timeBudgetMs;
  const canContinue = () => !d.shouldStop?.() && performance.now() < deadline;
  let remaining = limit;
  while (remaining > 0 && canContinue()) {
    const ambiguity = await claimAmbiguous(database, d);
    if (ambiguity.kind === "none") break;
    remaining -= 1;
    if (ambiguity.kind === "claimed") await reconcileAmbiguity(database, ambiguity.value, d);
  }
  if (remaining > 0 && canContinue()) {
    remaining -= await expireLeases(database, d, remaining);
  }
  while (remaining > 0 && canContinue()) {
    const options = {
      limit: 1,
      ...(d.leaseMs === undefined ? {} : { leaseMs: d.leaseMs }),
      ...(d.now ? { now: d.now() } : {}),
    };
    const [work] = await d.claim(database, options);
    if (!work) break;
    remaining -= 1;
    await process(database, work, d);
  }
}

export async function readIntegrationWorkerStartupSnapshot(
  database: Pick<PrismaClient, "$queryRaw">,
  options: { now?: Date } = {},
) {
  const dueAt = options.now ? Prisma.sql`${options.now}` : Prisma.sql`clock_timestamp()`;
  const [snapshot] = await database.$queryRaw<
    Array<{
      queued: number;
      retry: number;
      ambiguous: number;
      dead: number;
      oldestDueAt: Date | null;
    }>
  >(Prisma.sql`
    SELECT
      count(*) FILTER (WHERE "state" = 'queued'::"SyncWorkState")::integer AS "queued",
      count(*) FILTER (WHERE "state" = 'retry'::"SyncWorkState")::integer AS "retry",
      count(*) FILTER (WHERE "state" = 'ambiguous'::"SyncWorkState")::integer AS "ambiguous",
      count(*) FILTER (WHERE "state" = 'dead'::"SyncWorkState")::integer AS "dead",
      min("available_at") FILTER (
        WHERE "state" IN (
          'queued'::"SyncWorkState", 'retry'::"SyncWorkState", 'ambiguous'::"SyncWorkState"
        ) AND "available_at" <= ${dueAt}
      ) AS "oldestDueAt"
    FROM "integration_sync_work"
  `);
  if (!snapshot) throw new Error("Integration worker startup snapshot unavailable");
  return snapshot;
}

export function createIntegrationWorkerCycle(
  database: PrismaClient,
  dependencies: IntegrationWorkerDependencies = {}
) {
  let running: Promise<void> | undefined;
  let stopped = false;
  const run = (() => {
    if (stopped) return running ?? Promise.resolve();
    return (running ??= runIntegrationWorkerCycle(database, {
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

export async function requeueDeadIntegrationWork(
  database: PrismaClient,
  workId: string,
  options: { now?: Date } = {}
) {
  const availableAt = options.now ? Prisma.sql`${options.now}` : Prisma.sql`clock_timestamp()`;
  const changed = await database.$executeRaw(Prisma.sql`
    UPDATE "integration_sync_work"
    SET "state" = 'retry'::"SyncWorkState", "available_at" = ${availableAt},
        "lease_token" = NULL, "lease_until" = NULL, "updated_at" = clock_timestamp()
    WHERE "id" = ${workId}::uuid AND "state" = 'dead'::"SyncWorkState"
  `);
  return changed === 1;
}
