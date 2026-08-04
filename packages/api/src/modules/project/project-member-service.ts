import type { MemberRole, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";

// Role hierarchy for permission checks (higher index = more privileged).
// Mirrors packages/api/src/modules/member/service.ts ROLE_HIERARCHY.
const ROLE_HIERARCHY: MemberRole[] = ["viewer", "member", "admin", "owner"];

export function roleLevel(role: MemberRole): number {
  return ROLE_HIERARCHY.indexOf(role);
}

/**
 * DTO shape for a single row in the effective members list.
 *
 * R-INV1: pmId is ONLY present on source:'project' rows.
 *         source:'workspace' rows MUST NOT carry a pmId.
 *         memberId is the workspace Member.id accepted by issue assigneeId.
 */
export interface EffectiveMemberRow {
  userId: string;
  memberId: string;
  email: string;
  displayName: string | null;
  role: MemberRole;
  source: "project" | "workspace";
  pmId?: string;       // ProjectMember.id — ONLY on source:'project'
  implicit?: true;     // ONLY on source:'workspace'
}

/**
 * List all effective members of a project.
 *
 * Returns:
 *   - Explicit PM rows (source:'project', pmId set)
 *   - Workspace owner/admin rows (source:'workspace', implicit:true, NO pmId)
 *
 * Merge key: userId — explicit PM row wins on collision.
 *
 * R-INV1: pmId is ONLY set on source:'project' rows. memberId is returned for
 *          every row so callers can assign issues without guessing IDs.
 */
export async function listEffectiveMembers(
  projectId: string,
  workspaceId: string,
): Promise<EffectiveMemberRow[]> {
  // Step 1: explicit PM rows
  const pmRows = await prisma.projectMember.findMany({
    where: { projectId },
    include: {
      user: { select: { email: true, displayName: true } },
    },
  });

  // Step 2: all workspace members provide assignable member IDs. Only
  // owner/admin rows become implicit project members below.
  const wsRows = await prisma.member.findMany({
    where: { workspaceId },
    include: {
      user: { select: { email: true, displayName: true } },
    },
  });

  // Step 3: merge keyed by userId — explicit wins
  const merged = new Map<string, EffectiveMemberRow>();
  const memberIds = new Map(wsRows.map((member) => [member.userId, member.id]));

  // Add ws implicit rows first (lower priority)
  for (const ws of wsRows) {
    if (ws.role !== "owner" && ws.role !== "admin") continue;
    merged.set(ws.userId, {
      userId: ws.userId,
      memberId: ws.id,
      email: ws.user.email,
      displayName: ws.user.displayName,
      role: ws.role,
      source: "workspace",
      implicit: true,
      // NO pmId on workspace rows (R-INV1)
    });
  }

  // Add explicit PM rows second (override ws rows for same userId)
  for (const pm of pmRows) {
    merged.set(pm.userId, {
      userId: pm.userId,
      memberId: memberIds.get(pm.userId)!,
      email: pm.user.email,
      displayName: pm.user.displayName,
      role: pm.role,
      source: "project",
      pmId: pm.id, // ProjectMember.id — ONLY on source:'project' (R-INV1)
      // NO implicit on project rows
    });
  }

  return Array.from(merged.values());
}

/**
 * Add a workspace member to a project.
 *
 * Guards (in order):
 *   1. Resolve User by email (404 USER_NOT_FOUND)
 *   2. Assert workspace Member exists for (userId, workspaceId) (422 NOT_WORKSPACE_MEMBER)
 *   3. Assert no existing PM row for (userId, projectId) (409 ALREADY_PROJECT_MEMBER)
 *   4. Owner-cap: role==='owner' && actingRole!=='owner' → 403 ROLE_CAP_EXCEEDED
 */
export async function addProjectMember(
  projectId: string,
  workspaceId: string,
  email: string,
  role: MemberRole,
  actingRole: MemberRole,
): Promise<EffectiveMemberRow> {
  // 1. Resolve user by email
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  // 2. Assert target is a workspace member
  const wsMember = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId } },
    select: { id: true },
  });
  if (!wsMember) {
    throw new AppError(422, "NOT_WORKSPACE_MEMBER", "Target user is not a member of this workspace");
  }

  // 3. Assert no existing PM row
  const existing = await prisma.projectMember.findUnique({
    where: { userId_projectId: { userId: user.id, projectId } },
  });
  if (existing) {
    throw new AppError(409, "ALREADY_PROJECT_MEMBER", "User is already a project member");
  }

  // 4. Owner-cap: only an effective project owner can set role:owner
  if (role === "owner" && actingRole !== "owner") {
    throw new AppError(403, "ROLE_CAP_EXCEEDED", "Only a project owner can assign the owner role");
  }

  // Create PM row
  const pm = await prisma.projectMember.create({
    data: { userId: user.id, projectId, role },
  });

  return {
    userId: user.id,
    memberId: wsMember.id,
    email: user.email,
    displayName: user.displayName,
    role: pm.role,
    source: "project",
    pmId: pm.id, // ProjectMember.id — R-INV1
  };
}

/**
 * Change a project member's role.
 *
 * Guards (in order):
 *   1. Find PM row scoped to (id:pmId, projectId) → 404 PM_NOT_FOUND
 *      R-INV1: scoping by projectId means a ws Member.id (not in projectMember) → 404
 *   2. Owner-cap: newRole==='owner' && actingRole!=='owner' → 403 ROLE_CAP_EXCEEDED
 *   3. LAST_OWNER: sole owner demotion → 422 LAST_OWNER
 *   4. Actor level >= target current role (403 FORBIDDEN)
 */
export async function changeProjectMemberRole(
  projectId: string,
  pmId: string,
  newRole: MemberRole,
  actingRole: MemberRole,
): Promise<EffectiveMemberRow> {
  // 1. Find PM row scoped to this project (R-INV1: ws Member.id won't match → 404)
  const pm = await prisma.projectMember.findFirst({
    where: { id: pmId, projectId },
    include: {
      user: { select: { email: true, displayName: true } },
      project: { select: { workspaceId: true } },
    },
  });
  if (!pm) {
    throw new AppError(404, "PM_NOT_FOUND", "Project member not found");
  }

  // 2. Owner-cap: only effective project owner can set role:owner
  if (newRole === "owner" && actingRole !== "owner") {
    throw new AppError(403, "ROLE_CAP_EXCEEDED", "Only a project owner can assign the owner role");
  }

  // 3. LAST_OWNER guard: cannot demote the last project owner
  if (pm.role === "owner" && newRole !== "owner") {
    const ownerCount = await prisma.projectMember.count({
      where: { projectId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new AppError(422, "LAST_OWNER", "Cannot demote the last project owner");
    }
  }

  // 4. Actor level must be >= target's current role
  if (roleLevel(actingRole) < roleLevel(pm.role)) {
    throw new AppError(403, "FORBIDDEN", "Insufficient permissions to change this member's role");
  }

  const updated = await prisma.projectMember.update({
    where: { id: pmId },
    data: { role: newRole },
  });
  const member = await prisma.member.findUniqueOrThrow({
    where: { userId_workspaceId: { userId: pm.userId, workspaceId: pm.project.workspaceId } },
  });

  return {
    userId: pm.userId,
    memberId: member.id,
    email: pm.user.email,
    displayName: pm.user.displayName,
    role: updated.role,
    source: "project",
    pmId: pm.id,
  };
}

/**
 * Remove a project member.
 *
 * Guards (in order):
 *   1. Find PM row scoped to (id:pmId, projectId) → 404 PM_NOT_FOUND
 *      R-INV1: ws Member.id won't match a projectMember row → 404
 *   2. LAST_OWNER: sole owner removal → 422 LAST_OWNER (no bypass — even self-removal blocked)
 *   3. Actor level >= target role (403 FORBIDDEN, bypass on self-removal of non-last-owner)
 */
export async function removeProjectMember(
  projectId: string,
  pmId: string,
  actingUserId: string,
  actingRole: MemberRole,
): Promise<void> {
  // 1. Find PM row scoped to this project (R-INV1: ws Member.id won't match → 404)
  const pm = await prisma.projectMember.findFirst({
    where: { id: pmId, projectId },
  });
  if (!pm) {
    throw new AppError(404, "PM_NOT_FOUND", "Project member not found");
  }

  const isSelf = pm.userId === actingUserId;

  // 2. LAST_OWNER guard: cannot remove the last project owner (no bypass — even self)
  if (pm.role === "owner") {
    const ownerCount = await prisma.projectMember.count({
      where: { projectId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new AppError(422, "LAST_OWNER", "Cannot remove the last project owner");
    }
  }

  // 3. Actor level gate (bypass on self-removal)
  if (!isSelf && roleLevel(actingRole) < roleLevel(pm.role)) {
    throw new AppError(403, "FORBIDDEN", "Insufficient permissions to remove this member");
  }

  await prisma.projectMember.delete({ where: { id: pmId } });
}

/**
 * Create ProjectMember rows for a set of invite assignments inside an existing transaction.
 *
 * Rules (R-INV-accept, R-INV-onboard, R-INV-idempotent, R-INV-inv):
 *   - Empty assignments → no-op (no DB calls).
 *   - Stale/deleted projects (no longer in workspace) → skipped silently.
 *   - skipDuplicates: re-applying an existing (userId, projectId) pair is not an error.
 *   - userId param is the invitee's userId — NEVER a Member.id.
 *   - No owner-cap: gating happens at invite CREATION time only.
 */
export async function createProjectMembersInTx(
  tx: Prisma.TransactionClient,
  userId: string,
  assignments: { projectId: string; role: MemberRole }[],
  workspaceId: string,
): Promise<void> {
  if (assignments.length === 0) return;

  const ids = assignments.map((a) => a.projectId);
  const live = await tx.project.findMany({
    where: { id: { in: ids }, workspaceId },
    select: { id: true },
  });

  const liveSet = new Set(live.map((p) => p.id));
  const data = assignments
    .filter((a) => liveSet.has(a.projectId))
    .map((a) => ({ userId, projectId: a.projectId, role: a.role }));

  if (data.length === 0) return;

  await tx.projectMember.createMany({ data, skipDuplicates: true });
}
