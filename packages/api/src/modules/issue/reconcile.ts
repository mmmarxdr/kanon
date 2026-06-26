import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";

/**
 * KAN-157 — Reconciliation service for the review→done gate.
 *
 * The reconciliation invariant (ADR-0001 amendment):
 *   `done` may only hold tickets with CONFIRMED time.
 *   An issue is "needs reconciliation" when it has ANY WorkLog or TimeEntry
 *   AND (timeConfirmedAt is null OR any WorkLog/TimeEntry.createdAt > timeConfirmedAt).
 *   An issue with ZERO captured time auto-passes (no reconcile needed).
 */

export interface ReconcileOpts {
  /** Decimal-string hours to top-up as a manual approved TimeEntry (e.g. "1.5"). Omit or "0" = no top-up. */
  addHours?: string;
}

export interface ReconcileSummary {
  entries: Array<{ id: string; hours: string; status: string; sourceWorkLogId: string | null }>;
  totalHours: number;
  confirmedAt: Date;
}

// ── needsReconciliation ─────────────────────────────────────────────────────

/**
 * Determine whether the given issue requires reconciliation before →done.
 *
 * Returns a descriptor that the caller uses to either throw RECONCILIATION_REQUIRED
 * or allow the transition.
 *
 * "needs reconciliation" = has any WorkLog OR TimeEntry AND
 *   (timeConfirmedAt is null OR some row.createdAt > timeConfirmedAt).
 *
 * Zero captured time → auto-pass (returns { needed: false }).
 */
export async function checkReconciliation(issueId: string, timeConfirmedAt: Date | null): Promise<{
  needed: boolean;
  workLogs: any[];
  timeEntries: any[];
  totalHours: number;
}> {
  const [workLogs, timeEntries] = await Promise.all([
    prisma.workLog.findMany({
      where: { issueId },
      select: { id: true, durationS: true, startedAt: true, endedAt: true, createdAt: true, memberId: true },
    }),
    prisma.timeEntry.findMany({
      where: { issueId },
      select: { id: true, hours: true, status: true, sourceWorkLogId: true, createdAt: true, memberId: true },
    }),
  ]);

  // Zero captured time → auto-pass
  if (workLogs.length === 0 && timeEntries.length === 0) {
    return { needed: false, workLogs: [], timeEntries: [], totalHours: 0 };
  }

  // If confirmed, check staleness: any row created at or after confirmation?
  // Fix 4: use >= so a row created at the same millisecond counts as stale.
  if (timeConfirmedAt !== null) {
    const staleWorkLog = workLogs.some((wl) => wl.createdAt >= timeConfirmedAt);
    const staleEntry = timeEntries.some((te) => te.createdAt >= timeConfirmedAt);
    if (!staleWorkLog && !staleEntry) {
      // Fix 7: compute the real total even in the confirmed/non-stale branch.
      const linkedWorkLogIds = new Set(
        timeEntries.map((te) => te.sourceWorkLogId).filter(Boolean),
      );
      const unlinkedWorkLogHours = workLogs
        .filter((wl) => !linkedWorkLogIds.has(wl.id))
        .reduce((sum, wl) => sum + wl.durationS / 3600, 0);
      const entryHours = timeEntries.reduce(
        (sum, te) => sum + parseFloat(te.hours.toString()),
        0,
      );
      const totalHours = Math.round((unlinkedWorkLogHours + entryHours) * 100) / 100;
      return { needed: false, workLogs, timeEntries, totalHours };
    }
  }

  // Compute total hours from TimeEntries (authoritative) + unlinked WorkLogs
  const linkedWorkLogIds = new Set(
    timeEntries.map((te) => te.sourceWorkLogId).filter(Boolean),
  );
  const unlinkedWorkLogHours = workLogs
    .filter((wl) => !linkedWorkLogIds.has(wl.id))
    .reduce((sum, wl) => sum + wl.durationS / 3600, 0);
  const entryHours = timeEntries.reduce(
    (sum, te) => sum + parseFloat(te.hours.toString()),
    0,
  );
  const totalHours = Math.round((unlinkedWorkLogHours + entryHours) * 100) / 100;

  return { needed: true, workLogs, timeEntries, totalHours };
}

// ── reconcileIssueTime ──────────────────────────────────────────────────────

/**
 * Reconcile captured time for an issue before it can transition to done.
 *
 * Steps:
 *   1. Promote any unpromoted WorkLogs (no TimeEntry yet) → approved TimeEntry.
 *   2. Bulk-approve all draft/submitted TimeEntries for the issue (dev self-confirm).
 *   3. If opts.addHours > 0: create a manual approved TimeEntry (sourceWorkLogId=null).
 *   4. Stamp issue.timeConfirmedAt = now.
 *   5. Return summary { entries, totalHours, confirmedAt }.
 */
export async function reconcileIssueTime(
  issueId: string,
  memberId: string,
  opts?: ReconcileOpts,
): Promise<ReconcileSummary> {
  const issue = await prisma.issue.findUnique({
    where: { id: issueId },
    select: { id: true, key: true },
  });

  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueId}" not found`);
  }

  const now = new Date();

  // Fix 5: parse addHours as Decimal upfront; guard with Decimal.gt to avoid float mixing.
  const addHoursDecimal = opts?.addHours !== undefined
    ? new Prisma.Decimal(opts.addHours)
    : new Prisma.Decimal(0);
  const shouldAddHours = addHoursDecimal.greaterThan(0);

  // Fix 3: wrap all writes in a single transaction so they are all-or-nothing.
  const { finalEntries, confirmedAt } = await prisma.$transaction(async (tx) => {
    // Step 1: find WorkLogs with no linked TimeEntry → promote to approved TimeEntry
    const unpromoted = await tx.workLog.findMany({
      where: { issueId, timeEntry: { is: null } },
      select: { id: true, durationS: true, startedAt: true, memberId: true },
    });

    for (const wl of unpromoted) {
      const hours = new Prisma.Decimal(wl.durationS).dividedBy(3600);
      await tx.timeEntry.create({
        data: {
          memberId: wl.memberId,
          issueId,
          hours,
          workedOn: wl.startedAt,
          status: "approved",
          sourceWorkLogId: wl.id,
          approvedById: memberId,
          approvedAt: now,
          via: "reconcile",
        },
      });
    }

    // Step 2: bulk-approve all remaining draft/submitted TimeEntries for THIS member only.
    // Fix 2: scope to memberId so member A cannot approve member B's entries.
    await tx.timeEntry.updateMany({
      where: {
        issueId,
        memberId,
        status: { in: ["draft", "submitted"] },
      },
      data: {
        status: "approved",
        approvedById: memberId,
        approvedAt: now,
        via: "reconcile",
      },
    });

    // Step 3: optional manual top-up
    if (shouldAddHours) {
      await tx.timeEntry.create({
        data: {
          memberId,
          issueId,
          hours: addHoursDecimal,
          workedOn: now,
          status: "approved",
          sourceWorkLogId: null,
          approvedById: memberId,
          approvedAt: now,
          via: "reconcile-manual",
        },
      });
    }

    // Step 4: read the final TimeEntry set inside the transaction for
    // consistency. createdAt is selected so Step 5 can stamp timeConfirmedAt
    // strictly AFTER the newest entry.
    const entries = await tx.timeEntry.findMany({
      where: { issueId },
      select: {
        id: true,
        hours: true,
        status: true,
        sourceWorkLogId: true,
        createdAt: true,
      },
    });

    // Step 5: stamp timeConfirmedAt STRICTLY AFTER every entry's createdAt.
    // KAN-165: the promoted/manual entries created above get their createdAt from
    // the DB clock DURING this tx, i.e. AFTER the JS `now` captured before the tx
    // opened. checkReconciliation flags an entry stale when
    // `createdAt >= timeConfirmedAt` (the `>=` is intentional so a brand-new entry
    // from a LATER reconcile counts as stale). Stamping timeConfirmedAt = now
    // would therefore mark THIS reconcile's own just-created entries stale and
    // re-block the review→done gate, forcing a second no-op reconcile. Stamp it
    // 1ms past the newest entry so every entry created in this reconcile is
    // strictly older (not stale), while a genuinely later entry stays > and stale.
    // Bound: holds at millisecond resolution; the +1ms guard cannot distinguish a
    // concurrent entry created within the same JS millisecond (Postgres timestamptz
    // is microsecond, JS Date truncates to ms) — acceptable given reconcile is a
    // deliberate single-user confirm action.
    const latestMs = entries.reduce(
      (max, e) => Math.max(max, e.createdAt.getTime()),
      now.getTime(),
    );
    const confirmedAt = new Date(latestMs + 1);

    await tx.issue.update({
      where: { id: issueId },
      data: { timeConfirmedAt: confirmedAt },
    });

    return { finalEntries: entries, confirmedAt };
  });

  const totalHours = finalEntries.reduce(
    (sum, te) => sum + parseFloat(te.hours.toString()),
    0,
  );

  return {
    entries: finalEntries.map((te) => ({
      id: te.id,
      hours: te.hours.toString(),
      status: te.status,
      sourceWorkLogId: te.sourceWorkLogId,
    })),
    totalHours: Math.round(totalHours * 100) / 100,
    confirmedAt,
  };
}
