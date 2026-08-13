import { Prisma, type PrismaClient } from "@prisma/client";
import type { AuditCheckpoint, AuditObservation } from "./core/audit-evidence.js";
import type { AuditCensusLease, AuditCensusPersistence } from "./audit.js";
import { lockPollSnapshot, type BindingPollLease } from "./inbound.js";
const MAX_AUDIT_REASON_LENGTH = 96;
export type DurableAuditCensusLease = AuditCensusLease & BindingPollLease;
export interface DurableAuditRun {
  readonly id: string;
  readonly checkpoint: AuditCheckpoint | null;
  readonly providerObservedAt: Date | null;
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
export function createPrismaAuditCensusRepository(database: PrismaClient) {
  async function loadOrCreateRun(lease: DurableAuditCensusLease): Promise<DurableAuditRun | null> {
    if (!hasCanonicalLeaseIdentity(lease)) return null;
    return database.$transaction(async (transaction) => {
      if (!(await hasCurrentPollLease(transaction, lease))) return null;
      const existing = await transaction.integrationAuditRun.findFirst({
        where: { bindingId: lease.bindingId, scopeFingerprint: lease.scopeFingerprint, state: "partial" },
        include: { checkpoint: true },
        orderBy: { updatedAt: "desc" },
      });
      const run = existing ?? await transaction.integrationAuditRun.create({
        data: {
          bindingId: lease.bindingId,
          scopeFingerprint: lease.scopeFingerprint,
          leaseToken: lease.leaseToken,
          fence: lease.fence,
        },
        include: { checkpoint: true },
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
        checkpoint: run.checkpoint ? {
          ...checkpointValue(run.checkpoint),
          lastIssueUpdatedAt: run.checkpoint.lastIssueUpdatedAt,
          lastIssueId: run.checkpoint.lastIssueId,
        } : null,
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
        data: { state: "complete", reasonCode: null, completedAt: clock.now },
      });
      await transaction.integrationProjectBinding.update({
        where: { id: lease.bindingId },
        data: { auditCompletedAt: clock.now },
      });
      return true;
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

  return { loadOrCreateRun, commitIssue, finish, markFailed, persistence };
}
