import { prisma } from "../../config/prisma.js";
import { Prisma } from "@prisma/client";

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

function isRetryableConcurrencyError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  // P2034 = Prisma serialization failure; P2002 = unique (terminal event already written)
  if (e.code === "P2034" || e.code === "P2002") return true;
  // Raw SQL under SERIALIZABLE often surfaces as P2010 + Postgres 40001
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

/**
 * Claim one pending-past-expiry proposal with `FOR UPDATE SKIP LOCKED` and
 * transition it inside the same transaction so concurrent workers cannot
 * double-process.
 */
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
      // READ COMMITTED + SKIP LOCKED is the standard queue claim pattern;
      // SERIALIZABLE causes spurious 40001 conflicts under parallel workers.
      { isolationLevel: Prisma.TransactionIsolationLevel.ReadCommitted },
    );
  } catch (err) {
    if (isRetryableConcurrencyError(err)) return "skipped";
    throw err;
  }
}

/**
 * Sweep pending proposals past `expiresAt` and transition them to `expired`.
 *
 * Each row is claimed with `FOR UPDATE SKIP LOCKED` inside its own transaction
 * so concurrent workers skip locked rows without double-processing.
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

/**
 * Claim one retention-eligible proposal and dispose it (audit → delete content →
 * tombstone) inside the same transaction that holds `FOR UPDATE SKIP LOCKED`.
 */
async function claimAndDisposeOne(): Promise<ClaimResult> {
  try {
    return await prisma.$transaction(
      async (tx) => {
        // FOR UPDATE OF p — lock proposal rows only (not the joined policy).
        const claimed = await tx.$queryRaw<{ id: string }[]>`
          SELECT p.id
          FROM triage_proposals p
          JOIN triage_policies pol ON p.policy_id = pol.id
          WHERE p.lifecycle IN ('expired', 'dismissed')
            AND p.disposed_at IS NULL
            AND p.created_at < NOW() - (pol.retention_days * interval '1 day')
          ORDER BY p.created_at ASC
          LIMIT 1
          FOR UPDATE OF p SKIP LOCKED
        `;

        const row = claimed[0];
        if (!row) return "empty";

        const proposal = await tx.triageProposal.findUnique({
          where: { id: row.id },
          select: { lifecycle: true, disposedAt: true },
        });

        if (!proposal) return "empty";
        if (proposal.lifecycle !== "expired" && proposal.lifecycle !== "dismissed") {
          return "skipped";
        }
        if (proposal.disposedAt !== null) return "skipped";

        // Step 1: Audit event FIRST (append-only)
        await tx.triageProposalLifecycleEvent.create({
          data: {
            proposalId: row.id,
            state: "disposed",
            reason: "retention_policy",
            actorId: null,
          },
        });

        // Step 2: Delete content (RESTRICT FK — content must go before tombstone keep)
        await tx.triageProposalContent.deleteMany({
          where: { proposalId: row.id },
        });

        // Step 3: Mark as disposed tombstone
        await tx.triageProposal.update({
          where: { id: row.id },
          data: {
            lifecycle: "disposed",
            disposedAt: new Date(),
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
 * Sweep terminal-state proposals past their policy-defined retention period.
 *
 * For each eligible row (claimed under `FOR UPDATE SKIP LOCKED`):
 * 1. Create audit lifecycle event (`reason: "retention_policy"`)
 * 2. Delete content
 * 3. Mark proposal as disposed tombstone with `disposedAt`
 *
 * One row per transaction so a single failure does not roll back the batch and
 * concurrent workers cannot double-dispose.
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
  info: (msg: string, ...args: unknown[]) => void;
  error: (obj: Record<string, unknown>, msg: string) => void;
  debug?: (msg: string, ...args: unknown[]) => void;
}

/**
 * Register retention housekeeping workers.
 *
 * Creates two self-rescheduling timers:
 * 1. Expiry sweep — every 60s, max 100 per tick
 * 2. Retention sweep — every 24h (with startup jitter), max 100 per tick
 *
 * Both use `unref()` so the process can exit even if timers are pending.
 * Returns a stop function that clears all pending timers.
 */
export function registerRetentionHousekeeping(logger: HousekeepingLogger): () => void {
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
      sweepExpiry({ limit: EXPIRY_BATCH_LIMIT })
        .then((count) => {
          if (count > 0) {
            logger.info(`Triage expiry sweep processed ${count} proposals`);
          }
        })
        .catch((err) => {
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
      sweepRetention({ limit: RETENTION_BATCH_LIMIT })
        .then((count) => {
          if (count > 0) {
            logger.info(`Triage retention sweep disposed ${count} proposals`);
          }
        })
        .catch((err) => {
          logger.error({ err }, "Triage retention sweep failed");
        })
        .finally(() => {
          retentionRunning = false;
          scheduleRetentionTick();
        });
    }, RETENTION_INTERVAL_MS);
    retentionTimer.unref?.();
  };

  // Start expiry sweep immediately on schedule
  scheduleExpiryTick();

  // Start retention sweep with jitter to avoid thundering herd
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
