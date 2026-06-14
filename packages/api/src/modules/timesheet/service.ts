import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { AppError } from "../../shared/types.js";
import type { PromoteWorkLogBody, UpdateEntryBody, RejectEntryBody, CreateAdjustmentBody } from "./schema.js";

// ── promoteWorkLog ────────────────────────────────────────────────────────

/**
 * Promote a WorkLog to a draft TimeEntry.
 *
 * INVARIANT #1 (ppm-engine §8): WorkLog is READ-ONLY from the timesheet side.
 *   This function reads the WorkLog but NEVER writes to it.
 * INVARIANT #7: via threaded to every row and event.
 *
 * Guards:
 *   - WorkLog must exist → 404 WORKLOG_NOT_FOUND
 *   - Caller must be the WorkLog owner → 403 FORBIDDEN
 *
 * Idempotency:
 *   On P2002 unique constraint violation (sourceWorkLogId already taken),
 *   return the existing TimeEntry without throwing.
 *
 * hours default = workLog.durationS / 3600 as Prisma.Decimal.
 * hours body override (string) → new Prisma.Decimal(body.hours).
 *
 * Emits: worklog.promoted (optional, fire-and-forget)
 */
export async function promoteWorkLog(
  workLogId: string,
  body: PromoteWorkLogBody,
  memberId: string,
  via?: string | null,
) {
  const workLog = await prisma.workLog.findUnique({
    where: { id: workLogId },
    select: {
      id: true,
      memberId: true,
      issueId: true,
      durationS: true,
      startedAt: true,
      issue: { select: { project: { select: { workspaceId: true } } } },
    },
  });

  if (!workLog) {
    throw new AppError(404, "WORKLOG_NOT_FOUND", `WorkLog "${workLogId}" not found`);
  }

  // Guard: owner-only
  if (workLog.memberId !== memberId) {
    throw new AppError(403, "FORBIDDEN", "Only the WorkLog owner may promote it");
  }

  // hours: body override OR durationS / 3600
  const hours =
    body.hours !== undefined
      ? new Prisma.Decimal(body.hours)
      : new Prisma.Decimal(workLog.durationS).dividedBy(3600);

  const workedOn = body.workedOn ? new Date(body.workedOn) : workLog.startedAt;
  const issueId = body.issueId ?? workLog.issueId;

  try {
    const entry = await prisma.timeEntry.create({
      data: {
        memberId,
        issueId,
        hours,
        workedOn,
        status: "draft",
        sourceWorkLogId: workLogId,
        via: via ?? null,
      },
    });

    return { entry, created: true };
  } catch (err: unknown) {
    // Idempotent: P2002 unique violation on sourceWorkLogId → return existing entry.
    // created=false signals the caller this is the existing row, not a new one.
    if (
      err instanceof Error &&
      (err as any).code === "P2002"
    ) {
      const existing = await prisma.timeEntry.findUnique({
        where: { sourceWorkLogId: workLogId },
      });
      if (existing) return { entry: existing, created: false };
    }
    throw err;
  }
}

// ── updateEntry ────────────────────────────────────────────────────────────

/**
 * Update a draft or submitted TimeEntry.
 *
 * INVARIANT #2 (ppm-engine §8): Approved entries are IMMUTABLE.
 *   An approved/rejected entry MUST NOT be updated — use createAdjustment instead.
 * INVARIANT #3: Negative hours only when adjustsId IS NOT NULL.
 *
 * Guards:
 *   - Entry must exist → 404 TIME_ENTRY_NOT_FOUND
 *   - Caller must be the entry owner → 403 FORBIDDEN
 *   - Status must be draft or submitted → 409 ENTRY_IMMUTABLE
 *   - Negative hours without adjustsId → 422 INVALID_HOURS
 */
export async function updateEntry(
  entryId: string,
  body: UpdateEntryBody,
  memberId: string,
  via?: string | null,
) {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      memberId: true,
      status: true,
      adjustsId: true,
    },
  });

  if (!entry) {
    throw new AppError(404, "TIME_ENTRY_NOT_FOUND", `Time entry "${entryId}" not found`);
  }

  // Guard: owner-only
  if (entry.memberId !== memberId) {
    throw new AppError(403, "FORBIDDEN", "Only the time entry owner may update it");
  }

  // INVARIANT #2: approved/rejected entries are immutable
  if (entry.status === "approved" || entry.status === "rejected") {
    throw new AppError(
      409,
      "ENTRY_IMMUTABLE",
      "Approved or rejected time entries cannot be updated; use createAdjustment instead",
    );
  }

  // INVARIANT #3: negative hours only allowed on adjustments
  if (body.hours !== undefined) {
    const hoursDecimal = new Prisma.Decimal(body.hours);
    if (hoursDecimal.lessThan(0) && !entry.adjustsId) {
      throw new AppError(
        422,
        "INVALID_HOURS",
        "Negative hours are only allowed on adjustment entries",
      );
    }
  }

  return prisma.timeEntry.update({
    where: { id: entryId },
    data: {
      ...(body.hours !== undefined ? { hours: new Prisma.Decimal(body.hours) } : {}),
      ...(body.issueId !== undefined ? { issueId: body.issueId } : {}),
      ...(body.workedOn !== undefined ? { workedOn: new Date(body.workedOn) } : {}),
      via: via ?? null,
    },
  });
}

// ── submitEntry ────────────────────────────────────────────────────────────

/**
 * Transition a draft TimeEntry to submitted.
 *
 * Guards:
 *   - Entry must exist → 404 TIME_ENTRY_NOT_FOUND
 *   - Caller must be the entry owner → 403 FORBIDDEN
 *   - Status must be draft → 409 INVALID_STATUS
 */
export async function submitEntry(
  entryId: string,
  memberId: string,
  via?: string | null,
) {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: { id: true, memberId: true, status: true },
  });

  if (!entry) {
    throw new AppError(404, "TIME_ENTRY_NOT_FOUND", `Time entry "${entryId}" not found`);
  }

  // Guard: owner-only
  if (entry.memberId !== memberId) {
    throw new AppError(403, "FORBIDDEN", "Only the time entry owner may submit it");
  }

  // Guard: must be in draft to submit
  if (entry.status !== "draft") {
    throw new AppError(
      409,
      "INVALID_STATUS",
      `Cannot submit a time entry with status "${entry.status}"; must be "draft"`,
    );
  }

  return prisma.timeEntry.update({
    where: { id: entryId },
    data: { status: "submitted", via: via ?? null },
  });
}

// ── approveEntry ──────────────────────────────────────────────────────────

/**
 * Approve a submitted TimeEntry — PM-gated (enforced at route level).
 *
 * TOCTOU-safe: the status check is ATOMIC with the write.
 * Uses tx.timeEntry.updateMany with `where: { id, status: "submitted" }`.
 * If count === 0, re-read to distinguish 404 NOT_FOUND from 409 INVALID_STATUS.
 * On success, fetch the updated entry for the response + event payload.
 *
 * INVARIANT #2: only submitted entries may be approved.
 *
 * Guards:
 *   - Entry must exist → 404 TIME_ENTRY_NOT_FOUND
 *   - Status must be submitted → 409 INVALID_STATUS
 *
 * Emits: time-entry.approved (fire-and-forget, post-commit)
 *
 * TODO(KAN-rate / PPM P1): copy MemberRate snapshots (costRateSnapshot,
 *   billRateSnapshot) into the TimeEntry when the money model lands.
 *   For now, snapshots stay null and approval is a human gate only.
 */
export async function approveEntry(
  entryId: string,
  memberId: string,
  via?: string | null,
) {
  const now = new Date();

  const approved = await prisma.$transaction(async (tx) => {
    // Atomic conditional update: only succeeds when status is still "submitted".
    // This collapses the read-check-then-write into a single DB round-trip,
    // preventing two concurrent PMs from both passing the status guard.
    const result = await tx.timeEntry.updateMany({
      where: { id: entryId, status: "submitted" },
      data: {
        status: "approved",
        approvedById: memberId,
        approvedAt: now,
        via: via ?? null,
        // TODO(KAN-rate / PPM P1): copy MemberRate snapshots when the money model lands.
        // costRateSnapshot: ...,
        // billRateSnapshot: ...,
      },
    });

    if (result.count === 0) {
      // Re-read to give a precise error: 404 if missing, 409 if wrong status.
      const existing = await tx.timeEntry.findUnique({
        where: { id: entryId },
        select: { id: true, status: true },
      });
      if (!existing) {
        throw new AppError(404, "TIME_ENTRY_NOT_FOUND", `Time entry "${entryId}" not found`);
      }
      throw new AppError(
        409,
        "INVALID_STATUS",
        `Cannot approve a time entry with status "${existing.status}"; must be "submitted"`,
      );
    }

    // Fetch the updated row for the response + event payload.
    return tx.timeEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: {
        id: true,
        memberId: true,
        issueId: true,
        hours: true,
        workedOn: true,
        status: true,
        sourceWorkLogId: true,
        adjustsId: true,
        costRateSnapshot: true,
        billRateSnapshot: true,
        via: true,
        approvedById: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
        member: { select: { workspaceId: true } },
      },
    });
  });

  // Fire-and-forget post-commit event (outside the transaction)
  try {
    eventBus.emit({
      type: "time-entry.approved",
      workspaceId: approved.member.workspaceId,
      actorId: memberId,
      via: via ?? null,
      payload: {
        entryId,
        issueId: approved.issueId ?? null,
        approvedAt: now.toISOString(),
      },
    });
  } catch {
    // Never break the mutation
  }

  return approved;
}

// ── rejectEntry ───────────────────────────────────────────────────────────

/**
 * Reject a submitted TimeEntry — PM-gated (enforced at route level).
 *
 * TOCTOU-safe: same atomic conditional-update pattern as approveEntry.
 * Uses tx.timeEntry.updateMany with `where: { id, status: "submitted" }`.
 * If count === 0, re-read to distinguish 404 NOT_FOUND from 409 INVALID_STATUS.
 *
 * Guards:
 *   - Entry must exist → 404 TIME_ENTRY_NOT_FOUND
 *   - Status must be submitted → 409 INVALID_STATUS
 *
 * Emits: time-entry.rejected (fire-and-forget, post-commit)
 */
export async function rejectEntry(
  entryId: string,
  memberId: string,
  _body: RejectEntryBody,
  via?: string | null,
) {
  const rejected = await prisma.$transaction(async (tx) => {
    // Atomic conditional update: only succeeds when status is still "submitted".
    const result = await tx.timeEntry.updateMany({
      where: { id: entryId, status: "submitted" },
      data: { status: "rejected", via: via ?? null },
    });

    if (result.count === 0) {
      // Re-read to give a precise error: 404 if missing, 409 if wrong status.
      const existing = await tx.timeEntry.findUnique({
        where: { id: entryId },
        select: { id: true, status: true },
      });
      if (!existing) {
        throw new AppError(404, "TIME_ENTRY_NOT_FOUND", `Time entry "${entryId}" not found`);
      }
      throw new AppError(
        409,
        "INVALID_STATUS",
        `Cannot reject a time entry with status "${existing.status}"; must be "submitted"`,
      );
    }

    // Fetch the updated row for the response + event payload.
    return tx.timeEntry.findUniqueOrThrow({
      where: { id: entryId },
      select: {
        id: true,
        memberId: true,
        issueId: true,
        hours: true,
        workedOn: true,
        status: true,
        sourceWorkLogId: true,
        adjustsId: true,
        costRateSnapshot: true,
        billRateSnapshot: true,
        via: true,
        approvedById: true,
        approvedAt: true,
        createdAt: true,
        updatedAt: true,
        member: { select: { workspaceId: true } },
      },
    });
  });

  // Fire-and-forget post-commit event (outside the transaction)
  try {
    eventBus.emit({
      type: "time-entry.rejected",
      workspaceId: rejected.member.workspaceId,
      actorId: memberId,
      via: via ?? null,
      payload: { entryId, issueId: rejected.issueId ?? null },
    });
  } catch {
    // Never break the mutation
  }

  return rejected;
}

// ── createAdjustment ──────────────────────────────────────────────────────

/**
 * Create an adjustment TimeEntry for an approved entry.
 *
 * An adjustment is a NEW TimeEntry with:
 *   - adjustsId pointing to the approved original
 *   - Negative hours ALLOWED (ppm-engine §8 invariant #3 exception)
 *   - status = draft (flows through the same submit→approve gate)
 *
 * INVARIANT #2: the original MUST be approved; draft/submitted/rejected → 409
 *
 * Ownership policy (least-privilege, consistent with promote/update/submit):
 *   Only the OWNER of the original entry may create an adjustment for it.
 *   Any project member discovering an approved entry they do not own MUST NOT
 *   be able to inject an adjustment row — this protects payroll integrity.
 *
 * Guards:
 *   - Original entry must exist → 404 TIME_ENTRY_NOT_FOUND
 *   - Original status must be approved → 409 NOT_APPROVED
 *   - Caller must be the owner of the original entry → 403 FORBIDDEN
 */
export async function createAdjustment(
  originalEntryId: string,
  body: CreateAdjustmentBody,
  memberId: string,
  via?: string | null,
) {
  const original = await prisma.timeEntry.findUnique({
    where: { id: originalEntryId },
    select: {
      id: true,
      status: true,
      issueId: true,
      memberId: true,
    },
  });

  if (!original) {
    throw new AppError(404, "TIME_ENTRY_NOT_FOUND", `Time entry "${originalEntryId}" not found`);
  }

  // INVARIANT #2: adjustment can only be made against an approved entry
  if (original.status !== "approved") {
    throw new AppError(
      409,
      "NOT_APPROVED",
      `Cannot create an adjustment for a time entry with status "${original.status}"; original must be "approved"`,
    );
  }

  // Ownership guard (owner-only policy): only the original entry owner may create an adjustment.
  // Checked AFTER the status guard so we don't leak membership info for non-approved entries.
  if (original.memberId !== memberId) {
    throw new AppError(403, "FORBIDDEN", "Only the time entry owner may create an adjustment");
  }

  const hours = new Prisma.Decimal(body.hours);
  // issueId: body override if explicitly provided (including null), else inherit from original
  const issueId =
    body.issueId !== undefined ? body.issueId : original.issueId;

  return prisma.timeEntry.create({
    data: {
      memberId,
      issueId,
      hours,
      workedOn: new Date(body.workedOn),
      status: "draft",
      adjustsId: originalEntryId,
      via: via ?? null,
    },
  });
}
