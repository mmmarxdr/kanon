import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { AppError } from "../../shared/types.js";
import {
  captureIssueScheduleMutationTx,
  resolveIssueCaptureContext,
} from "../integrations/issue-tx.js";
import type { UpsertPlanBody, ReviseEstimateBody, ScheduleConfigBody } from "./schema.js";

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
  options?: { startDateIfMissing?: boolean },
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true, projectId: true, project: { select: { workspaceId: true } } },
  });

  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  // Guard: progress 0-100
  if (body.progress !== undefined && (body.progress < 0 || body.progress > 100)) {
    throw new AppError(422, "INVALID_PROGRESS", "progress must be between 0 and 100");
  }

  // Guard: startDate ≤ dueDate — partial-update safe.
  // If only one date is in the body, read the persisted row to get the other
  // so we can validate the combined range before writing.
  if (!options?.startDateIfMissing && (body.startDate !== undefined || body.dueDate !== undefined)) {
    let effectiveStart: Date | null = body.startDate ? new Date(body.startDate) : null;
    let effectiveDue: Date | null = body.dueDate ? new Date(body.dueDate) : null;

    if (effectiveStart === null || effectiveDue === null) {
      // At least one side is missing from the body — fetch the persisted row
      const existing = await prisma.issueSchedule.findUnique({
        where: { issueId: issue.id },
        select: { startDate: true, dueDate: true },
      });
      if (existing) {
        if (effectiveStart === null) effectiveStart = existing.startDate;
        if (effectiveDue === null) effectiveDue = existing.dueDate;
      }
    }

    if (effectiveStart !== null && effectiveDue !== null && effectiveStart > effectiveDue) {
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

  const upsert = {
    where: { issueId: issue.id },
    create: createData,
    update: updateData,
  };
  const capture = await resolveIssueCaptureContext(issue.projectId, memberId);
  const captureFields = (result: { startDate: Date | null; dueDate: Date | null; progress: number }) => ({
    ...(body.startDate !== undefined
      ? { startDate: result.startDate?.toISOString() ?? null }
      : {}),
    ...(body.dueDate !== undefined ? { dueDate: result.dueDate?.toISOString() ?? null } : {}),
    ...(body.progress !== undefined ? { progress: result.progress } : {}),
  });
  const writeSchedule = async (transaction: Prisma.TransactionClient) => {
    if (options?.startDateIfMissing && body.startDate !== undefined) {
      const startDate = new Date(body.startDate);
      const existing = await transaction.issueSchedule.findUnique({
        where: { issueId: issue.id },
      });
      if (existing?.startDate) return existing;
      if (existing?.dueDate && startDate > existing.dueDate) {
        throw new AppError(422, "INVALID_DATE_RANGE", "startDate must not be after dueDate");
      }

      let written = existing
        ? (
            await transaction.issueSchedule.updateMany({
              where: { issueId: issue.id, startDate: null },
              data: { startDate },
            })
          ).count
        : (
            await transaction.issueSchedule.createMany({
              data: [{ issueId: issue.id, startDate }],
              skipDuplicates: true,
            })
          ).count;
      if (written === 0) {
        const raced = await transaction.issueSchedule.findUniqueOrThrow({
          where: { issueId: issue.id },
        });
        if (raced.startDate) return raced;
        if (raced.dueDate && startDate > raced.dueDate) {
          throw new AppError(422, "INVALID_DATE_RANGE", "startDate must not be after dueDate");
        }
        written = (
          await transaction.issueSchedule.updateMany({
            where: { issueId: issue.id, startDate: null },
            data: { startDate },
          })
        ).count;
      }

      const result = await transaction.issueSchedule.findUniqueOrThrow({
        where: { issueId: issue.id },
      });
      if (capture && written > 0) {
        await captureIssueScheduleMutationTx(transaction, issue.id, capture, captureFields(result));
      }
      return result;
    }

    const result = await transaction.issueSchedule.upsert(upsert);
    if (capture) {
      await captureIssueScheduleMutationTx(transaction, issue.id, capture, captureFields(result));
    }
    return result;
  };
  const write = () =>
    options?.startDateIfMissing || capture
      ? prisma.$transaction(writeSchedule)
      : prisma.issueSchedule.upsert(upsert);
  let schedule;
  try {
    schedule = await write();
  } catch (error) {
    const target =
      error instanceof Prisma.PrismaClientKnownRequestError ? error.meta?.["target"] : undefined;
    if (error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002" &&
        Array.isArray(target) &&
        target.includes("issueId")) {
      schedule = await write();
    } else {
      throw error;
    }
  }

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

// ── getScheduleConfig / upsertScheduleConfig (KAN-147, ADR-0007) ────────────

/**
 * Default working-day calendar surfaced when a project has no stored config:
 * Mon–Fri, no holidays. Mirrors the engine default so the API reads the same
 * effective calendar the forecast uses.
 */
const DEFAULT_SCHEDULE_CONFIG = { workDays: [1, 2, 3, 4, 5], holidays: [] as string[] };

/**
 * Read a project's working-day calendar. Returns the Mon–Fri default when no
 * ProjectScheduleConfig row exists (absent config means default, ADR-0007).
 */
export async function getScheduleConfig(
  projectId: string,
): Promise<{ workDays: number[]; holidays: string[] }> {
  const config = await prisma.projectScheduleConfig.findUnique({
    where: { projectId },
    select: { workDays: true, holidays: true },
  });
  return config ?? { ...DEFAULT_SCHEDULE_CONFIG };
}

/**
 * Upsert a project's working-day calendar (KAN-147). Validation (non-empty
 * workDays subset of 0..6, ISO holidays) is enforced at the zod boundary.
 * Holidays are normalised/de-duplicated/sorted for a stable stored value.
 *
 * Emits schedule-config.updated (fire-and-forget, post-commit) which the
 * forecast listener consumes to rebuild the project forecast — the same
 * trigger mechanism used by upsertPlan/reviseEstimate.
 */
export async function upsertScheduleConfig(
  projectId: string,
  body: ScheduleConfigBody,
  memberId: string,
  via?: string | null,
) {
  const workDays = [...new Set(body.workDays)].sort((a, b) => a - b);
  const holidays = [...new Set(body.holidays)].sort();

  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true },
  });
  if (!project) {
    throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
  }
  const workspaceId = project.workspaceId;

  const config = await prisma.projectScheduleConfig.upsert({
    where: { projectId },
    create: { projectId, workDays, holidays },
    update: { workDays, holidays },
  });

  // Fire-and-forget post-commit event → forecast rebuild trigger.
  try {
    eventBus.emit({
      type: "schedule-config.updated",
      workspaceId,
      actorId: memberId,
      via: via ?? null,
      payload: { projectId },
    });
  } catch {
    // Never break the mutation
  }

  return config;
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
    select: { id: true, projectId: true, project: { select: { workspaceId: true } } },
  });

  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  // Guard: hours >= 0 (negative hours are invalid for estimates)
  const hoursDecimal = new Prisma.Decimal(body.hours);
  if (hoursDecimal.lessThan(0)) {
    throw new AppError(422, "INVALID_ESTIMATE", "hours must be >= 0");
  }

  const capture = await resolveIssueCaptureContext(issue.projectId, memberId);

  // Atomic transaction: append revision + upsert estimateHours + integration work
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

    if (capture) {
      await captureIssueScheduleMutationTx(tx, issue.id, capture, {
        estimateHours: Number(hoursDecimal),
      });
    }

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
