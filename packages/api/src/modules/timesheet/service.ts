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

    return entry;
  } catch (err: unknown) {
    // Idempotent: P2002 unique violation on sourceWorkLogId → return existing entry
    if (
      err instanceof Error &&
      (err as any).code === "P2002"
    ) {
      const existing = await prisma.timeEntry.findUnique({
        where: { sourceWorkLogId: workLogId },
      });
      if (existing) return existing;
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
 * Uses $transaction(callback) to atomically:
 *   1. Update status → approved, set approvedById + approvedAt
 *   (Rate snapshots remain null in W1 — see TODO below)
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
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      status: true,
      issueId: true,
      member: { select: { workspaceId: true } },
    },
  });

  if (!entry) {
    throw new AppError(404, "TIME_ENTRY_NOT_FOUND", `Time entry "${entryId}" not found`);
  }

  // Guard: only submitted entries may be approved
  if (entry.status !== "submitted") {
    throw new AppError(
      409,
      "INVALID_STATUS",
      `Cannot approve a time entry with status "${entry.status}"; must be "submitted"`,
    );
  }

  const now = new Date();

  const approved = await prisma.$transaction(async (tx) => {
    return tx.timeEntry.update({
      where: { id: entryId },
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
  });

  // Fire-and-forget post-commit event
  try {
    eventBus.emit({
      type: "time-entry.approved",
      workspaceId: entry.member.workspaceId,
      actorId: memberId,
      via: via ?? null,
      payload: {
        entryId,
        issueId: entry.issueId ?? null,
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
 * Guards:
 *   - Entry must exist → 404 TIME_ENTRY_NOT_FOUND
 *   - Status must be submitted → 409 INVALID_STATUS
 *
 * Emits: time-entry.rejected (fire-and-forget)
 */
export async function rejectEntry(
  entryId: string,
  memberId: string,
  _body: RejectEntryBody,
  via?: string | null,
) {
  const entry = await prisma.timeEntry.findUnique({
    where: { id: entryId },
    select: {
      id: true,
      status: true,
      issueId: true,
      member: { select: { workspaceId: true } },
    },
  });

  if (!entry) {
    throw new AppError(404, "TIME_ENTRY_NOT_FOUND", `Time entry "${entryId}" not found`);
  }

  // Guard: only submitted entries may be rejected
  if (entry.status !== "submitted") {
    throw new AppError(
      409,
      "INVALID_STATUS",
      `Cannot reject a time entry with status "${entry.status}"; must be "submitted"`,
    );
  }

  const rejected = await prisma.timeEntry.update({
    where: { id: entryId },
    data: { status: "rejected", via: via ?? null },
  });

  // Fire-and-forget event
  try {
    eventBus.emit({
      type: "time-entry.rejected",
      workspaceId: entry.member.workspaceId,
      actorId: memberId,
      via: via ?? null,
      payload: { entryId, issueId: entry.issueId ?? null },
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
 * Guards:
 *   - Original entry must exist → 404 TIME_ENTRY_NOT_FOUND
 *   - Original status must be approved → 409 NOT_APPROVED
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
