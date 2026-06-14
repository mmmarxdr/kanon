import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { CreateMilestoneBody, UpdateMilestoneBody } from "./schema.js";

// ── createMilestone ────────────────────────────────────────────────────────

/**
 * Create a new milestone for a project.
 *
 * ownerId defaults to the acting member (actorMemberId) when not provided.
 * status defaults to "upcoming" (Prisma schema default).
 *
 * @param projectId     - The project's UUID (resolved by requireProjectRole gate)
 * @param body          - Validated CreateMilestoneBody
 * @param actorMemberId - Workspace Member.id of the requesting actor
 */
export async function createMilestone(
  projectId: string,
  body: CreateMilestoneBody,
  actorMemberId: string,
) {
  return prisma.milestone.create({
    data: {
      name: body.name,
      target: new Date(body.target),
      status: "upcoming",
      ownerId: body.ownerId ?? actorMemberId,
      projectId,
    },
    include: {
      deliverables: {
        include: {
          issue: { select: { id: true, key: true, title: true } },
        },
      },
      owner: { select: { id: true, username: true } },
    },
  });
}

// ── listMilestones ─────────────────────────────────────────────────────────

/**
 * List all milestones for a project, including their deliverables.
 *
 * @param projectId - The project's UUID
 */
export async function listMilestones(projectId: string) {
  return prisma.milestone.findMany({
    where: { projectId },
    include: {
      deliverables: {
        include: {
          issue: { select: { id: true, key: true, title: true } },
        },
        orderBy: { createdAt: "asc" },
      },
      owner: { select: { id: true, username: true } },
    },
    orderBy: { target: "asc" },
  });
}

// ── updateMilestone ────────────────────────────────────────────────────────

/**
 * Update an existing milestone.
 *
 * Guards:
 *   - milestone not found → 404 MILESTONE_NOT_FOUND
 *
 * metOn is settable manually (v1 — no auto-stamp on status→met).
 *
 * @param id   - Milestone UUID
 * @param body - Validated UpdateMilestoneBody (partial)
 */
export async function updateMilestone(id: string, body: UpdateMilestoneBody) {
  const existing = await prisma.milestone.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "MILESTONE_NOT_FOUND", "Milestone not found");

  return prisma.milestone.update({
    where: { id },
    data: {
      ...(body.name !== undefined && { name: body.name }),
      ...(body.target !== undefined && { target: new Date(body.target) }),
      ...(body.status !== undefined && { status: body.status }),
      // metOn: explicitly settable (manual v1); nullable (null clears it)
      ...(body.metOn !== undefined && { metOn: body.metOn === null ? null : new Date(body.metOn) }),
      ...(body.ownerId !== undefined && { ownerId: body.ownerId }),
    },
    include: {
      deliverables: {
        include: {
          issue: { select: { id: true, key: true, title: true } },
        },
      },
      owner: { select: { id: true, username: true } },
    },
  });
}

// ── attachDeliverable ──────────────────────────────────────────────────────

/**
 * Attach an issue to a milestone as a deliverable.
 *
 * Guards (in order):
 *   - milestone not found → 404 MILESTONE_NOT_FOUND
 *   - issue not found → 404 ISSUE_NOT_FOUND
 *   - issue not in milestone's project → 422 DELIVERABLE_PROJECT_MISMATCH
 *   - duplicate (milestoneId, issueId) → Prisma P2002 → 409 DUPLICATE_DELIVERABLE
 *
 * @param milestoneId   - Milestone UUID
 * @param issueKey      - Issue key string (e.g. "KAN-12")
 * @param actorMemberId - Workspace Member.id of the requesting actor (for future audit)
 */
export async function attachDeliverable(
  milestoneId: string,
  issueKey: string,
  actorMemberId: string,
) {
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: { id: true, projectId: true },
  });
  if (!milestone)
    throw new AppError(404, "MILESTONE_NOT_FOUND", "Milestone not found");

  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true, projectId: true },
  });
  if (!issue)
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);

  // Cross-project guard: the issue must belong to the same project as the milestone
  if (issue.projectId !== milestone.projectId)
    throw new AppError(
      422,
      "DELIVERABLE_PROJECT_MISMATCH",
      "The issue must belong to the milestone's project",
    );

  try {
    return await prisma.milestoneDeliverable.create({
      data: {
        milestoneId,
        issueId: issue.id,
      },
      include: {
        issue: { select: { id: true, key: true, title: true } },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "DUPLICATE_DELIVERABLE", "This issue is already a deliverable of this milestone");
    }
    throw err;
  }
}

// ── detachDeliverable ──────────────────────────────────────────────────────

/**
 * Detach an issue from a milestone (remove the deliverable row).
 *
 * Guards:
 *   - deliverable row not found → 404 DELIVERABLE_NOT_FOUND
 *
 * @param milestoneId - Milestone UUID
 * @param issueId     - Issue UUID (from URL param)
 */
export async function detachDeliverable(milestoneId: string, issueId: string) {
  // Find the deliverable row by (milestoneId, issueId)
  const milestone = await prisma.milestone.findUnique({
    where: { id: milestoneId },
    select: { id: true },
  });
  if (!milestone)
    throw new AppError(404, "MILESTONE_NOT_FOUND", "Milestone not found");

  const deliverable = await prisma.milestoneDeliverable.findUnique({
    where: { milestoneId_issueId: { milestoneId, issueId } },
    select: { id: true },
  });
  if (!deliverable)
    throw new AppError(404, "DELIVERABLE_NOT_FOUND", "Deliverable not found on this milestone");

  await prisma.milestoneDeliverable.delete({ where: { id: deliverable.id } });
  return { ok: true };
}
