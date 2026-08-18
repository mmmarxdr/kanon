import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuditCheckpoint, AuditObservation, TerminalAuditTrustRead } from "./core/audit-evidence.js";
import type { AuditCensusLease, AuditCensusPersistence, AuditTerminalPersistence } from "./audit.js";
import { lockPollSnapshot, type BindingPollLease } from "./inbound.js";
const MAX_AUDIT_REASON_LENGTH = 96;
export type DurableAuditCensusLease = AuditCensusLease & BindingPollLease;
export interface DurableAuditRun {
  readonly id: string;
  readonly checkpoint: AuditCheckpoint | null;
  readonly providerObservedAt: Date | null;
  readonly observations: readonly AuditObservation[];
}
function hasCanonicalLeaseIdentity(lease: DurableAuditCensusLease): boolean {
  return lease.bindingId === lease.id && lease.leaseToken === lease.pollLeaseToken && lease.fence === lease.pollFence;
}
async function hasCurrentPollLease(transaction: Prisma.TransactionClient, lease: DurableAuditCensusLease): Promise<boolean> {
  try {
    return Boolean(await lockPollSnapshot(transaction, lease));
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "INBOUND_CREDENTIAL_STALE") return false;
    throw error;
  }
}
function checkpointValue(checkpoint: AuditCheckpoint) {
  return {
    pass: checkpoint.pass,
    offset: checkpoint.offset,
    itemIndex: checkpoint.itemIndex,
    expectedTotal: checkpoint.expectedTotal,
    lastIssueUpdatedAt: checkpoint.lastIssueUpdatedAt,
    lastIssueId: checkpoint.lastIssueId,
    pageCheckpointUpdatedAt: checkpoint.pageCheckpoint?.updatedAt ?? null,
    pageCheckpointRemoteId: checkpoint.pageCheckpoint?.remoteId ?? null,
    pageCheckpointToken: checkpoint.pageCheckpoint?.pageToken ?? null,
    checkpointVersion: 1,
    previousPassFingerprint: checkpoint.previousPassFingerprint ?? null,
    passComplete: checkpoint.passComplete ?? false,
  };
}
function boundedReason(reasonCode: string): string {
  return new RegExp(`^[a-z0-9_]{1,${MAX_AUDIT_REASON_LENGTH}}$`).test(reasonCode)
    ? reasonCode
    : "unknown";
}
/**
 * Durable audit state always validates the binding-owned inbound poll lease. It
 * deliberately claims no additional mutex, so provider I/O and audit writes
 * share the existing binding fence.
 */
export function createPrismaAuditCensusRepository(database: PrismaClient, options: { readonly terminalFreshnessMs: number; readonly retentionDays: number }) {
  if (!Number.isSafeInteger(options.terminalFreshnessMs) || options.terminalFreshnessMs < 1) throw new RangeError("terminalFreshnessMs must be positive");
  if (!Number.isSafeInteger(options.retentionDays) || options.retentionDays < 1) throw new RangeError("retentionDays must be positive");
  async function loadOrCreateRun(lease: DurableAuditCensusLease): Promise<DurableAuditRun | null> {
    if (!hasCanonicalLeaseIdentity(lease)) return null;
    return database.$transaction(async (transaction) => {
      if (!(await hasCurrentPollLease(transaction, lease))) return null;
      const existing = await transaction.integrationAuditRun.findFirst({
        where: { bindingId: lease.bindingId, scopeFingerprint: lease.scopeFingerprint, state: "partial" },
        include: { checkpoint: true, observations: true },
        orderBy: { updatedAt: "desc" },
      });
      const run = existing ?? await transaction.integrationAuditRun.create({
        data: {
          bindingId: lease.bindingId,
          scopeFingerprint: lease.scopeFingerprint,
          leaseToken: lease.leaseToken,
          fence: lease.fence,
        },
        include: { checkpoint: true, observations: true },
      });
      if (existing && (existing.leaseToken !== lease.leaseToken || existing.fence !== lease.fence)) {
        await transaction.integrationAuditRun.update({
          where: { id: existing.id },
          data: { leaseToken: lease.leaseToken, fence: lease.fence },
        });
      }
      return {
        id: run.id,
        providerObservedAt: run.providerObservedAt,
        checkpoint: run.checkpoint ? (() => {
          const isVersioned = run.checkpoint.checkpointVersion === 1;
          return {
            pass: run.checkpoint.pass,
            offset: run.checkpoint.offset,
            itemIndex: run.checkpoint.itemIndex,
            expectedTotal: run.checkpoint.expectedTotal,
            lastIssueUpdatedAt: run.checkpoint.lastIssueUpdatedAt,
            lastIssueId: run.checkpoint.lastIssueId,
            checkpointVersion: isVersioned ? 1 : undefined,
            pageCheckpoint: isVersioned
              ? run.checkpoint.pageCheckpointUpdatedAt && run.checkpoint.pageCheckpointRemoteId
                ? {
                    updatedAt: run.checkpoint.pageCheckpointUpdatedAt,
                    remoteId: run.checkpoint.pageCheckpointRemoteId,
                    pageToken: run.checkpoint.pageCheckpointToken,
                  }
                : null
              : undefined,
            previousPassFingerprint: isVersioned ? run.checkpoint.previousPassFingerprint ?? null : undefined,
            passComplete: isVersioned ? run.checkpoint.passComplete ?? false : undefined,
          };
        })() : null,
        observations: (run.observations ?? []).map((observation) => ({
          identityType: observation.identityType as AuditObservation["identityType"],
          remoteId: observation.remoteId,
          parentRemoteId: observation.parentRemoteId || null,
          sourceUpdatedAt: observation.sourceUpdatedAt,
        })),
      };
    });
  }
  async function commitIssue(lease: DurableAuditCensusLease, input: {
    readonly providerObservedAt: Date;
    readonly observations: readonly AuditObservation[];
    readonly checkpoint: AuditCheckpoint;
    readonly replace?: boolean;
  }): Promise<boolean> {
    if (!hasCanonicalLeaseIdentity(lease)) return false;
    return database.$transaction(async (transaction) => {
      if (!(await hasCurrentPollLease(transaction, lease))) return false;
      const run = await transaction.integrationAuditRun.findFirst({
        where: { bindingId: lease.bindingId, scopeFingerprint: lease.scopeFingerprint, state: "partial" },
        orderBy: { updatedAt: "desc" },
      }) ?? await transaction.integrationAuditRun.create({
        data: { bindingId: lease.bindingId, scopeFingerprint: lease.scopeFingerprint, leaseToken: lease.leaseToken, fence: lease.fence },
      });
      if (run.providerObservedAt && run.providerObservedAt.getTime() !== input.providerObservedAt.getTime()) return false;
      await transaction.integrationAuditRun.update({
        where: { id: run.id },
        data: { leaseToken: lease.leaseToken, fence: lease.fence, providerObservedAt: run.providerObservedAt ?? input.providerObservedAt },
      });
      if (input.replace) await transaction.integrationAuditObservation.deleteMany({ where: { runId: run.id } });
      await transaction.integrationAuditObservation.createMany({
        data: input.observations.map((observation) => ({
          runId: run.id,
          identityType: observation.identityType,
          remoteId: observation.remoteId,
          parentRemoteId: observation.parentRemoteId ?? "",
          sourceUpdatedAt: observation.sourceUpdatedAt,
        })),
        skipDuplicates: true,
      });
      await transaction.integrationAuditCheckpoint.upsert({
        where: { runId: run.id },
        create: { runId: run.id, scopeFingerprint: lease.scopeFingerprint, fence: lease.fence, ...checkpointValue(input.checkpoint) },
        update: { scopeFingerprint: lease.scopeFingerprint, fence: lease.fence, ...checkpointValue(input.checkpoint) },
      });
      return true;
    });
  }
  async function cleanupRetainedEvidence(transaction: Prisma.TransactionClient, bindingId: string, currentRunId: string, currentScopeFingerprint: string, now: Date): Promise<void> {
    const expiredTerminalRuns: Prisma.IntegrationAuditRunWhereInput = {
      OR: [
        { state: { in: ["failed", "stale"] } },
        { state: "complete", OR: [{ validUntil: null }, { validUntil: { lte: now } }] },
      ],
    };
    await transaction.integrationAuditRun.deleteMany({
      where: {
        bindingId,
        state: "partial",
        scopeFingerprint: { not: currentScopeFingerprint },
      },
    });
    await transaction.integrationAuditObservation.deleteMany({
      where: {
        observedAt: { lt: new Date(now.getTime() - options.retentionDays * 86_400_000) },
        run: { bindingId, id: { not: currentRunId }, ...expiredTerminalRuns },
      },
    });
    await transaction.integrationAuditRun.deleteMany({
      where: {
        bindingId,
        id: { not: currentRunId },
        state: { in: ["complete", "failed", "stale"] },
        observations: { none: {} },
        ...expiredTerminalRuns,
      },
    });
  }

  async function finish(lease: DurableAuditCensusLease, providerObservedAt: Date): Promise<boolean> {
    if (!hasCanonicalLeaseIdentity(lease)) return false;
    return database.$transaction(async (transaction) => {
      if (!(await hasCurrentPollLease(transaction, lease))) return false;
      const run = await transaction.integrationAuditRun.findFirst({
        where: { bindingId: lease.bindingId, scopeFingerprint: lease.scopeFingerprint, state: "partial", providerObservedAt },
        orderBy: { updatedAt: "desc" },
      });
      if (!run) return false;
      const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS "now"`);
      if (!clock) throw new Error("Database clock unavailable");
      await transaction.integrationAuditRun.update({
        where: { id: run.id },
        data: { state: "complete", reasonCode: null, completedAt: clock.now, validUntil: new Date(clock.now.getTime() + options.terminalFreshnessMs) },
      });
      await cleanupRetainedEvidence(transaction, lease.bindingId, run.id, lease.scopeFingerprint, clock.now);
      await transaction.integrationProjectBinding.update({
        where: { id: lease.bindingId },
        data: { auditCompletedAt: clock.now },
      });
      return true;
    });
  }

  async function readTerminalTrust(lease: DurableAuditCensusLease): Promise<TerminalAuditTrustRead | null> {
    if (!hasCanonicalLeaseIdentity(lease)) return null;
    return database.$transaction(async (transaction) => {
      if (!(await hasCurrentPollLease(transaction, lease))) return null;
      const [clock] = await transaction.$queryRaw<Array<{ now: Date }>>(Prisma.sql`SELECT clock_timestamp() AS "now"`);
      if (!clock) throw new Error("Database clock unavailable");
      const run = await transaction.integrationAuditRun.findFirst({
        where: {
          bindingId: lease.bindingId,
          scopeFingerprint: lease.scopeFingerprint,
          state: "complete",
          completedAt: { not: null },
          validUntil: { gt: clock.now },
        },
        orderBy: { completedAt: "desc" },
      });
      return {
        trust: run ? {
          state: run.state,
          completedAt: run.completedAt,
          validUntil: run.validUntil,
          scopeFingerprint: run.scopeFingerprint,
        } : null,
        databaseNow: clock.now,
      };
    });
  }

  async function markFailed(lease: DurableAuditCensusLease, reasonCode: string): Promise<boolean> {
    if (!hasCanonicalLeaseIdentity(lease)) return false;
    return database.$transaction(async (transaction) => {
      if (!(await hasCurrentPollLease(transaction, lease))) return false;
      const run = await transaction.integrationAuditRun.findFirst({
        where: { bindingId: lease.bindingId, scopeFingerprint: lease.scopeFingerprint, state: "partial" },
        orderBy: { updatedAt: "desc" },
      });
      if (!run) return false;
      await transaction.integrationAuditRun.update({ where: { id: run.id }, data: { state: "failed", reasonCode: boundedReason(reasonCode) } });
      return true;
    });
  }

  function persistence(lease: DurableAuditCensusLease): AuditCensusPersistence {
    return {
      loadRun: async (currentLease) => currentLease.bindingId === lease.bindingId && currentLease.leaseToken === lease.leaseToken && currentLease.fence === lease.fence
        ? loadOrCreateRun(lease)
        : null,
      isLeaseCurrent: async (currentLease) => {
        if (currentLease !== lease) return false;
        return database.$transaction((transaction) => hasCurrentPollLease(transaction, lease));
      },
      commitIssue: (input) => commitIssue(lease, input),
      finish: (input) => finish(lease, input.providerObservedAt),
    };
  }

  function terminalPersistence(lease: DurableAuditCensusLease): AuditTerminalPersistence {
    return { readTerminalTrust: (currentLease) => currentLease === lease ? readTerminalTrust(lease) : Promise.resolve(null) };
  }

  return { loadOrCreateRun, commitIssue, finish, readTerminalTrust, markFailed, persistence, terminalPersistence };
}
