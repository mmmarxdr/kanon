import type { MemberRole } from "@prisma/client";
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
 *         workspaceMember.id MUST NEVER appear in any response field.
 */
export interface EffectiveMemberRow {
  userId: string;
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
 */
export async function listEffectiveMembers(
  projectId: string,
  workspaceId: string,
): Promise<EffectiveMemberRow[]> {
  // TODO: implement in A-02
  throw new AppError(501, "NOT_IMPLEMENTED", "Not yet implemented");
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
  // TODO: implement in A-03
  throw new AppError(501, "NOT_IMPLEMENTED", "Not yet implemented");
}

/**
 * Change a project member's role.
 *
 * Guards (in order):
 *   1. Find PM row scoped to (id:pmId, projectId) → 404 PM_NOT_FOUND
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
  // TODO: implement in A-04
  throw new AppError(501, "NOT_IMPLEMENTED", "Not yet implemented");
}

/**
 * Remove a project member.
 *
 * Guards (in order):
 *   1. Find PM row scoped to (id:pmId, projectId) → 404 PM_NOT_FOUND
 *   2. LAST_OWNER: sole owner removal → 422 LAST_OWNER (bypass on self-removal)
 *   3. Actor level >= target role (403 FORBIDDEN, bypass on self-removal)
 */
export async function removeProjectMember(
  projectId: string,
  pmId: string,
  actingUserId: string,
  actingRole: MemberRole,
): Promise<void> {
  // TODO: implement in A-05
  throw new AppError(501, "NOT_IMPLEMENTED", "Not yet implemented");
}
