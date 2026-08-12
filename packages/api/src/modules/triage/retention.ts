import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import {
  buildStageTrace,
  observeProposalOp,
  triageOutcome,
  type TriageMetrics,
} from "./observability.js";

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default retention period — one year. */
export const DEFAULT_RETENTION_DAYS = 365;

/** Minimum retention period — seven days. */
export const MIN_RETENTION_DAYS = 7;

/** Maximum proposals processed per expiry sweep. */
export const EXPIRY_BATCH_LIMIT = 100;

/** Maximum proposals processed per retention sweep. */
export const RETENTION_BATCH_LIMIT = 100;

/** Interval for expiry sweeps — every 60 seconds. */
const EXPIRY_INTERVAL_MS = 60_000;

/** Interval for retention sweeps — every 24 hours. */
const RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1000;

/** Maximum startup jitter for retention worker — up to 60 seconds. */
const RETENTION_JITTER_MS = 60_000;

/**
 * Parse and clamp a retention-days policy value.
 * Values below {@link MIN_RETENTION_DAYS} are rejected; omitted values use the default.
 */
export function parseRetentionDays(value: unknown): number {
  if (value === undefined || value === null) return DEFAULT_RETENTION_DAYS;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < MIN_RETENTION_DAYS) {
    throw new Error(
      `retentionDays must be an integer >= ${MIN_RETENTION_DAYS} (got ${String(value)})`,
    );
  }
  return n;
}

/** Compute captured eligibility timestamp: createdAt + retentionDays. */
export function computeRetentionEligibleAt(
  createdAt: Date,
  retentionDays: number,
): Date {
  const days = parseRetentionDays(retentionDays);
  return new Date(createdAt.getTime() + days * 86_400_000);
}

export interface CapturedRetentionSnapshot {
  retentionEligibleAt: Date;
  capturedRetentionDays: number;
  capturedPolicyVersion: string;
}

/** Snapshot retention fields from a workspace policy at proposal creation. */
export function captureRetentionFromPolicy(
  policy: { retentionDays: number; version: string },
  createdAt: Date = new Date(),
): CapturedRetentionSnapshot {
  const capturedRetentionDays = parseRetentionDays(policy.retentionDays);
  return {
    retentionEligibleAt: computeRetentionEligibleAt(createdAt, capturedRetentionDays),
    capturedRetentionDays,
    capturedPolicyVersion: policy.version,
  };
}

/** Pure helper: disposed rows appear in list only for disposed|all when captured visible. */
export function disposedListDiscoveryAllowed(
  filter: string,
  dispositionListVisible: boolean | null | undefined,
): boolean {
  if (filter !== "disposed" && filter !== "all") return false;
  return dispositionListVisible === true;
}

/** Authorized disposed lookup projection (no content). Status 410 semantics for get. */
export function disposedTombstoneProjection(proposal: {
  id: string;
  lifecycle: string;
  disposedAt: Date | null;
  policyId: string;
  capturedPolicyVersion: string;
  capturedRetentionDays: number;
  dispositionListVisible: boolean | null;
  targetIssueId: string;
}) {
  return {
    httpStatus: 410 as const,
    id: proposal.id,
    lifecycle: "disposed" as const,
    disposedAt: proposal.disposedAt,
    targetIssueId: proposal.targetIssueId,
    dispositionListVisible: proposal.dispositionListVisible === true,
    retentionPolicy: {
      id: proposal.policyId,
      version: proposal.capturedPolicyVersion,
      retentionDays: proposal.capturedRetentionDays,
    },
  };
}

function isRetryableConcurrencyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  if (e.code === "P2034" || e.code === "P2002") return true;
  const msg = e.message ?? "";
  return (
    msg.includes("40001") ||
    msg.includes("could not serialize") ||
    msg.includes("write conflict") ||
    msg.includes("deadlock")
  );
}

/** Claim outcome: processed a row, queue empty, or lost a concurrency race. */
type ClaimResult = "done" | "empty" | "skipped";

// ── Expiry sweep ──────────────────────────────────────────────────────────────

async function claimAndExpireOne(): Promise<ClaimResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          SELECT id
          FROM triage_proposals
          WHERE lifecycle = 'pending'
            AND expires_at < NOW()
          ORDER BY expires_at ASC
          LIMIT 1
          FOR UPDATE SKIP LOCKED
        `;

        const row = claimed[0];
        if (!row) return "empty";

        await tx.triageProposal.update({
          where: { id: row.id },
          data: { lifecycle: "expired" },
        });

        await tx.triageProposalLifecycleEvent.create({
          data: {
            proposalId: row.id,
            state: "expired",
            reason: "lazy_expiry_worker",
            actorId: null,
          },
        });

        return "done";
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (err) {
    if (isRetryableConcurrencyError(err)) return "skipped";
    throw err;
  }
}

/**
 * Sweep pending proposals past `expiresAt` and transition them to `expired`.
 * Each row is claimed with `FOR UPDATE SKIP LOCKED` inside its own transaction.
 */
export async function sweepExpiry(options?: { limit?: number }): Promise<number> {
  const limit = options?.limit ?? EXPIRY_BATCH_LIMIT;
  let processed = 0;

  for (let i = 0; i < limit; i++) {
    const result = await claimAndExpireOne();
    if (result === "empty") break;
    if (result === "done") processed++;
  }

  return processed;
}

// ── Retention sweep ───────────────────────────────────────────────────────────

async function claimAndDisposeOne(): Promise<ClaimResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // Eligibility uses captured retention_eligible_at (not live policy days).
        // Non-current: expired/dismissed, effectively expired pending, or superseded.
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          SELECT p.id
          FROM triage_proposals p
          WHERE p.disposed_at IS NULL
            AND p.retention_eligible_at < NOW()
            AND (
              p.lifecycle IN ('expired', 'dismissed')
              OR (p.lifecycle = 'pending' AND p.expires_at < NOW())
              OR EXISTS (
                SELECT 1 FROM triage_proposals s WHERE s.supersedes_id = p.id
              )
            )
          ORDER BY p.retention_eligible_at ASC
          LIMIT 1
          FOR UPDATE OF p SKIP LOCKED
        `;

        const row = claimed[0];
        if (!row) return "empty";

        const proposal = await tx.triageProposal.findUnique({
          where: { id: row.id },
          include: {
            policy: {
              select: {
                id: true,
                version: true,
                dispositionListVisibility: true,
              },
            },
          },
        });

        if (!proposal || proposal.disposedAt !== null) return "skipped";

        const listVisible = proposal.policy.dispositionListVisibility === "visible";
        const dispositionDetails = {
          action: "retention_disposed",
          policyId: proposal.policyId,
          policyVersion: proposal.capturedPolicyVersion,
          retentionDays: proposal.capturedRetentionDays,
          dispositionListVisible: listVisible,
        };

        // Step 1: Audit event FIRST. If a prior partial failure already wrote the
        // unique disposed event, skip create (cannot catch unique inside the same
        // PG transaction — it aborts the tx) and finish content delete + tombstone.
        const existingDisposedEvent = await tx.triageProposalLifecycleEvent.findUnique({
          where: {
            proposalId_state: { proposalId: row.id, state: "disposed" },
          },
          select: { id: true },
        });
        if (!existingDisposedEvent) {
          await tx.triageProposalLifecycleEvent.create({
            data: {
              proposalId: row.id,
              state: "disposed",
              reason: "retention_policy",
              actorId: null,
              details: dispositionDetails,
            },
          });
        }

        // Step 2: Delete content
        await tx.triageProposalContent.deleteMany({
          where: { proposalId: row.id },
        });

        // Step 3: Mark as disposed tombstone; capture list visibility now
        await tx.triageProposal.update({
          where: { id: row.id },
          data: {
            lifecycle: "disposed",
            disposedAt: new Date(),
            dispositionListVisible: listVisible,
          },
        });

        return "done";
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (err) {
    if (isRetryableConcurrencyError(err)) return "skipped";
    throw err;
  }
}

/**
 * Sweep non-current proposals past their captured retention eligibility.
 * Uses `retention_eligible_at` captured at creation — live policy edits cannot
 * silently shorten existing rows.
 */
export async function sweepRetention(options?: { limit?: number }): Promise<number> {
  const limit = options?.limit ?? RETENTION_BATCH_LIMIT;
  let processed = 0;

  for (let i = 0; i < limit; i++) {
    const result = await claimAndDisposeOne();
    if (result === "empty") break;
    if (result === "done") processed++;
  }

  return processed;
}

// ── Housekeeping registration ─────────────────────────────────────────────────

interface HousekeepingLogger {
  info: (obj: unknown, msg?: string, ...args: unknown[]) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
  debug?: (msg: string, ...args: unknown[]) => void;
}

/**
 * Register retention housekeeping workers (expiry 60s / retention 24h + jitter).
 * Both timers use `unref()`. Returns a stop function.
 */
export function registerRetentionHousekeeping(
  logger: HousekeepingLogger,
  metrics?: TriageMetrics,
  runExpiry = sweepExpiry,
  runRetention = sweepRetention,
): () => void {
  let expiryTimer: ReturnType<typeof setTimeout> | undefined;
  let retentionTimer: ReturnType<typeof setTimeout> | undefined;
  let expiryRunning = false;
  let retentionRunning = false;

  const scheduleExpiryTick = (): void => {
    expiryTimer = setTimeout(() => {
      if (expiryRunning) {
        scheduleExpiryTick();
        return;
      }
      expiryRunning = true;
      const started = performance.now();
      const correlationId = randomUUID();
      runExpiry({ limit: EXPIRY_BATCH_LIMIT })
        .then((count) => {
          const durationMs = performance.now() - started;
          if (metrics) observeProposalOp(metrics, { operation: "expire", outcome: "success" }, durationMs / 1000);
          logger.info(buildStageTrace({
            correlationId, operation: "expire", stage: "sweep", durationMs,
            outcome: "success", details: { processed: count },
          }), "Triage expiry sweep completed");
          if (count > 0) {
            logger.info(`Triage expiry sweep processed ${count} proposals`);
          }
        })
        .catch((err) => {
          const durationMs = performance.now() - started;
          const outcome = triageOutcome(err);
          if (metrics) observeProposalOp(metrics, { operation: "expire", outcome }, durationMs / 1000);
          logger.info(buildStageTrace({
            correlationId, operation: "expire", stage: "sweep", durationMs, outcome,
          }), "Triage expiry sweep failed");
          logger.error({ err }, "Triage expiry sweep failed");
        })
        .finally(() => {
          expiryRunning = false;
          scheduleExpiryTick();
        });
    }, EXPIRY_INTERVAL_MS);
    expiryTimer.unref?.();
  };

  const scheduleRetentionTick = (): void => {
    retentionTimer = setTimeout(() => {
      if (retentionRunning) {
        scheduleRetentionTick();
        return;
      }
      retentionRunning = true;
      const started = performance.now();
      const correlationId = randomUUID();
      runRetention({ limit: RETENTION_BATCH_LIMIT })
        .then((count) => {
          const durationMs = performance.now() - started;
          if (metrics) observeProposalOp(metrics, { operation: "retain", outcome: "success" }, durationMs / 1000);
          logger.info(buildStageTrace({
            correlationId, operation: "retain", stage: "sweep", durationMs,
            outcome: "success", details: { processed: count },
          }), "Triage retention sweep completed");
          if (count > 0) {
            logger.info(`Triage retention sweep disposed ${count} proposals`);
          }
        })
        .catch((err) => {
          const durationMs = performance.now() - started;
          const outcome = triageOutcome(err);
          if (metrics) observeProposalOp(metrics, { operation: "retain", outcome }, durationMs / 1000);
          logger.info(buildStageTrace({
            correlationId, operation: "retain", stage: "sweep", durationMs, outcome,
          }), "Triage retention sweep failed");
          logger.error({ err }, "Triage retention sweep failed");
        })
        .finally(() => {
          retentionRunning = false;
          scheduleRetentionTick();
        });
    }, RETENTION_INTERVAL_MS);
    retentionTimer.unref?.();
  };

  scheduleExpiryTick();

  const jitter = Math.floor(Math.random() * RETENTION_JITTER_MS);
  retentionTimer = setTimeout(() => {
    scheduleRetentionTick();
  }, jitter);
  retentionTimer.unref?.();

  logger.info(
    `Triage retention housekeeping started (expiry: ${EXPIRY_INTERVAL_MS / 1000}s, retention: ${RETENTION_INTERVAL_MS / 1000}s, jitter: ${jitter}ms)`,
  );

  return () => {
    if (expiryTimer) {
      clearTimeout(expiryTimer);
      expiryTimer = undefined;
    }
    if (retentionTimer) {
      clearTimeout(retentionTimer);
      retentionTimer = undefined;
    }
    logger.info("Triage retention housekeeping stopped");
  };
}
