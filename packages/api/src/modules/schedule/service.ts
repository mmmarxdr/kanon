import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { AppError } from "../../shared/types.js";
import type { UpsertPlanBody, ReviseEstimateBody } from "./schema.js";

// ── getSchedule ────────────────────────────────────────────────────────────

/**
 * Retrieve the IssueSchedule for a given issue, or null if not yet created.
 */
export async function getSchedule(issueId: string) {
  return prisma.issueSchedule.findUnique({
    where: { issueId },
  });
}

// ── upsertPlan ────────────────────────────────────────────────────────────

/**
 * Upsert the plan fields on IssueSchedule.
 * Guards:
 *   - progress must be 0..100 → 422 INVALID_PROGRESS
 *   - startDate must be ≤ dueDate → 422 INVALID_DATE_RANGE
 * Emits: schedule.updated (fire-and-forget)
 *
 * Invariant #5/#8: this is the ONLY writer for plan fields (startDate,
 * dueDate, progress). Baseline columns are NOT written here (future slice).
 */
export async function upsertPlan(
  issueKey: string,
  body: UpsertPlanBody,
  memberId: string,
  via?: string | null,
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true, project: { select: { workspaceId: true } } },
  });

  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  // Guard: progress 0-100
  if (body.progress !== undefined && (body.progress < 0 || body.progress > 100)) {
    throw new AppError(422, "INVALID_PROGRESS", "progress must be between 0 and 100");
  }

  // Guard: startDate ≤ dueDate
  if (body.startDate && body.dueDate) {
    const start = new Date(body.startDate);
    const due = new Date(body.dueDate);
    if (start > due) {
      throw new AppError(
        422,
        "INVALID_DATE_RANGE",
        "startDate must not be after dueDate",
      );
    }
  }

  const updateData: Prisma.IssueScheduleUpdateInput = {};
  const createData: Prisma.IssueScheduleCreateInput = {
    issue: { connect: { id: issue.id } },
  };

  if (body.startDate !== undefined) {
    updateData.startDate = new Date(body.startDate);
    createData.startDate = new Date(body.startDate);
  }
  if (body.dueDate !== undefined) {
    updateData.dueDate = new Date(body.dueDate);
    createData.dueDate = new Date(body.dueDate);
  }
  if (body.progress !== undefined) {
    updateData.progress = body.progress;
    createData.progress = body.progress;
  }

  const schedule = await prisma.issueSchedule.upsert({
    where: { issueId: issue.id },
    create: createData,
    update: updateData,
  });

  // Fire-and-forget post-commit event
  try {
    eventBus.emit({
      type: "schedule.updated",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      via: via ?? null,
      payload: { issueId: issue.id, progress: schedule.progress },
    });
  } catch {
    // Never break the mutation
  }

  return schedule;
}

// ── reviseEstimate ────────────────────────────────────────────────────────

/**
 * Revise the estimate for an issue.
 *
 * INVARIANT #9: estimateHours is ONLY written inside this function.
 * Uses $transaction(callback) to atomically:
 *   1. Create an EstimateRevision row (append-only audit log)
 *   2. Upsert IssueSchedule.estimateHours
 *
 * Guards:
 *   - hours must be ≥ 0 → 422 INVALID_ESTIMATE
 *   - issue must exist → 404 ISSUE_NOT_FOUND
 *
 * Emits: estimate.revised (fire-and-forget, post-commit)
 */
export async function reviseEstimate(
  issueKey: string,
  body: ReviseEstimateBody,
  memberId: string,
  via?: string | null,
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true, project: { select: { workspaceId: true } } },
  });

  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  // Guard: hours >= 0 (negative hours are invalid for estimates)
  const hoursDecimal = new Prisma.Decimal(body.hours);
  if (hoursDecimal.lessThan(0)) {
    throw new AppError(422, "INVALID_ESTIMATE", "hours must be >= 0");
  }

  // Atomic transaction: append revision + upsert estimateHours
  const { revision } = await prisma.$transaction(async (tx) => {
    const revision = await tx.estimateRevision.create({
      data: {
        issueId: issue.id,
        hours: hoursDecimal,
        reason: body.reason ?? null,
        authorId: memberId,
        via: via ?? null,
      },
    });

    await tx.issueSchedule.upsert({
      where: { issueId: issue.id },
      create: {
        issueId: issue.id,
        estimateHours: hoursDecimal,
      },
      update: {
        estimateHours: hoursDecimal,
      },
    });

    return { revision };
  });

  // Fire-and-forget post-commit event
  try {
    eventBus.emit({
      type: "estimate.revised",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      via: via ?? null,
      payload: {
        issueId: issue.id,
        revisionId: revision.id,
        hours: hoursDecimal.toString(),
      },
    });
  } catch {
    // Never break the mutation
  }

  return revision;
}
