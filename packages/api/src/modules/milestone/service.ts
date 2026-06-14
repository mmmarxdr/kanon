import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { CreateMilestoneBody, UpdateMilestoneBody } from "./schema.js";

// ── ownerId workspace membership check ────────────────────────────────────

/**
 * Validate that the given ownerId is a Member of the specified workspace.
 * Single query: looks up the Member row by id AND workspaceId simultaneously.
 * Rejects with AppError 422 INVALID_OWNER if not found.
 *
 * @param ownerId     - The Member.id to validate
 * @param workspaceId - The workspace the member must belong to
 */
async function assertOwnerInWorkspace(ownerId: string, workspaceId: string): Promise<void> {
  const member = await prisma.member.findUnique({
    where: { id: ownerId },
    select: { id: true, workspaceId: true },
  });
  if (!member || member.workspaceId !== workspaceId) {
    throw new AppError(422, "INVALID_OWNER", "ownerId must be a member of this workspace");
  }
}

// ── createMilestone ────────────────────────────────────────────────────────

/**
 * Create a new milestone for a project.
 *
 * ownerId defaults to the acting member (actorMemberId) when not provided.
 * When ownerId IS provided, it must be a Member in the same workspace as the
 * project — otherwise 422 INVALID_OWNER is thrown before any DB write.
 * Defense-in-depth: P2003 FK violation on write → also mapped to 422 INVALID_OWNER.
 *
 * status defaults to "upcoming" (Prisma schema default).
 *
 * @param projectId     - The project's UUID (resolved by requireProjectRole gate)
 * @param body          - Validated CreateMilestoneBody
 * @param actorMemberId - Workspace Member.id of the requesting actor
 * @param workspaceId   - Workspace UUID of the project (from request.member.workspaceId)
 */
export async function createMilestone(
  projectId: string,
  body: CreateMilestoneBody,
  actorMemberId: string,
  workspaceId: string,
) {
  // CRITICAL 1: validate ownerId belongs to this workspace before writing
  if (body.ownerId !== undefined) {
    await assertOwnerInWorkspace(body.ownerId, workspaceId);
  }

  try {
    return await prisma.milestone.create({
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
  } catch (err) {
    // CRITICAL 2: defense-in-depth — P2003 FK on ownerId → clean 422
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new AppError(422, "INVALID_OWNER", "ownerId does not reference a valid workspace member");
    }
    throw err;
  }
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
 * Guards (in order):
 *   - milestone not found → 404 MILESTONE_NOT_FOUND
 *   - ownerId provided and not a member of workspace → 422 INVALID_OWNER
 *   - status/metOn coherence on the RESULTING state:
 *       Rule: metOn may be non-null ONLY when the resulting status === "met".
 *       (a) metOn set (non-null) while resulting status != "met" → 422 INVALID_MILESTONE_STATE
 *       (b) resulting status === "met" but resulting metOn is null → 422 INVALID_MILESTONE_STATE
 *       metOn is MANUAL — no auto-stamp, no auto-clear. Caller must be explicit.
 *   - P2003 FK on ownerId → 422 INVALID_OWNER (defense-in-depth)
 *
 * @param id          - Milestone UUID
 * @param body        - Validated UpdateMilestoneBody (partial)
 * @param workspaceId - Workspace UUID (from request.member.workspaceId, set by requireMilestoneRole)
 */
export async function updateMilestone(id: string, body: UpdateMilestoneBody, workspaceId: string) {
  const existing = await prisma.milestone.findUnique({ where: { id } });
  if (!existing) throw new AppError(404, "MILESTONE_NOT_FOUND", "Milestone not found");

  // CRITICAL 1: validate ownerId belongs to this workspace before writing
  if (body.ownerId !== undefined) {
    await assertOwnerInWorkspace(body.ownerId, workspaceId);
  }

  // WARNING 4: coherence guard on the RESULTING (merged) state.
  //
  // Rule: metOn may be non-null ONLY when the resulting status === "met".
  // - metOn set to non-null while resulting status != "met" → incoherent
  // - resulting status === "met" but resulting metOn is null/undefined → incoherent
  //   (caller must provide metOn when marking met — no auto-stamp in v1)
  //
  // "Resulting" values = patch field if present, otherwise the current DB value.
  const resultingStatus = body.status !== undefined ? body.status : existing.status;
  // body.metOn === undefined means "not in patch" (keep current). null means "clear it".
  const resultingMetOn = body.metOn !== undefined
    ? (body.metOn === null ? null : new Date(body.metOn))
    : existing.metOn;

  if (resultingMetOn !== null && resultingStatus !== "met") {
    throw new AppError(
      422,
      "INVALID_MILESTONE_STATE",
      "metOn may only be set when the milestone status is 'met'",
    );
  }
  if (resultingStatus === "met" && resultingMetOn === null) {
    throw new AppError(
      422,
      "INVALID_MILESTONE_STATE",
      "A metOn date is required when setting status to 'met'",
    );
  }

  try {
    return await prisma.milestone.update({
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
  } catch (err) {
    // CRITICAL 2: defense-in-depth — P2003 FK on ownerId → clean 422
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2003") {
      throw new AppError(422, "INVALID_OWNER", "ownerId does not reference a valid workspace member");
    }
    throw err;
  }
}

// ── attachDeliverable ──────────────────────────────────────────────────────

/**
 * Attach an issue to a milestone as a deliverable.
 *
 * Guards (in order):
 *   - milestone not found → 404 MILESTONE_NOT_FOUND (only when projectId not pre-resolved)
 *   - issue not found → 404 ISSUE_NOT_FOUND
 *   - issue not in milestone's project → 422 DELIVERABLE_PROJECT_MISMATCH
 *   - duplicate (milestoneId, issueId) → Prisma P2002 → 409 DUPLICATE_DELIVERABLE
 *
 * SUGGESTION: actorMemberId is unused by the current write — prefixed with _ to mark
 * it as intentionally dead (reserved for future audit log use).
 *
 * SUGGESTION: projectId can be passed from request.projectId (set by requireMilestoneRole)
 * to skip the redundant milestone re-fetch for the cross-project guard.
 *
 * @param milestoneId    - Milestone UUID
 * @param issueKey       - Issue key string (e.g. "KAN-12")
 * @param _actorMemberId - Workspace Member.id of the requesting actor (reserved for future audit)
 * @param projectId      - Pre-resolved project UUID from the gate (request.projectId); if provided,
 *                         skips the milestone re-fetch for the cross-project guard.
 */
export async function attachDeliverable(
  milestoneId: string,
  issueKey: string,
  _actorMemberId: string,
  projectId?: string,
) {
  // Use gate-resolved projectId when available to avoid a redundant milestone re-fetch.
  let resolvedProjectId = projectId;

  if (!resolvedProjectId) {
    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: { id: true, projectId: true },
    });
    if (!milestone)
      throw new AppError(404, "MILESTONE_NOT_FOUND", "Milestone not found");
    resolvedProjectId = milestone.projectId;
  }

  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true, projectId: true },
  });
  if (!issue)
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);

  // Cross-project guard: the issue must belong to the same project as the milestone
  if (issue.projectId !== resolvedProjectId)
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
 * CRITICAL 3 fix: replaced TOCTOU find-then-delete with a DIRECT delete on the
 * composite unique key. Catches P2025 (record not found) → 404 DELIVERABLE_NOT_FOUND.
 * This eliminates the redundant milestone re-fetch and the race window.
 *
 * Guards:
 *   - deliverable row not found → Prisma P2025 → 404 DELIVERABLE_NOT_FOUND
 *
 * @param milestoneId - Milestone UUID
 * @param issueId     - Issue UUID (from URL param)
 */
export async function detachDeliverable(milestoneId: string, issueId: string) {
  try {
    await prisma.milestoneDeliverable.delete({
      where: { milestoneId_issueId: { milestoneId, issueId } },
    });
    return { ok: true };
  } catch (err) {
    // P2025: "record to delete does not exist" → clean 404 (mirrors delete-cycle.ts pattern)
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2025") {
      throw new AppError(404, "DELIVERABLE_NOT_FOUND", "Deliverable not found on this milestone");
    }
    throw err;
  }
}
