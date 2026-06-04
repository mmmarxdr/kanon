import type { MemberRole } from "@prisma/client";
import type { preHandlerHookHandler } from "fastify";
import { prisma } from "../config/prisma.js";
import { AppError } from "../shared/types.js";
import type { MemberContext } from "../shared/types.js";
import { INSTANCE_SETTINGS_ID } from "../shared/constants.js";

/**
 * Role hierarchy — higher index = more privileged.
 */
const ROLE_HIERARCHY: readonly MemberRole[] = ["viewer", "member", "admin", "owner"] as const;

/**
 * Check if `actualRole` is at least as privileged as `minimumRole`.
 */
function meetsMinimumRole(actualRole: MemberRole, minimumRole: MemberRole): boolean {
  return ROLE_HIERARCHY.indexOf(actualRole) >= ROLE_HIERARCHY.indexOf(minimumRole);
}

/**
 * Shared helper: query the Member table for a user in a workspace,
 * optionally enforce a minimum role, and return a MemberContext.
 *
 * Throws 403 if the user is not a member or lacks the required role.
 */
async function resolveAndCheckMember(
  userId: string,
  workspaceId: string,
  minimumRole?: MemberRole,
): Promise<MemberContext> {
  const member = await prisma.member.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId,
      },
    },
    select: { id: true, role: true },
  });

  if (!member) {
    throw new AppError(403, "FORBIDDEN", "You are not a member of this workspace");
  }

  if (minimumRole && !meetsMinimumRole(member.role, minimumRole)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      `This action requires at least the "${minimumRole}" role`,
    );
  }

  return {
    id: member.id,
    role: member.role,
    workspaceId,
    userId,
  };
}

/**
 * Effective-role gate helper for project-scoped routes (KAN-16 + KAN-19).
 *
 * Design (ADR A2 + A3):
 * - owner/admin → bypass (no ProjectMember lookup), returns workspace role as effectiveRole
 * - member/viewer → requires a ProjectMember row; absent → 403
 * - effectiveRole is checked against minRole via the role hierarchy
 * - INVARIANT: result.member.id === workspace Member.id (never ProjectMember.id)
 * - Per-project role is returned as `projectRole`; set on request by callers
 *
 * KAN-19 — credential-scope FIRST-GUARD (fires before any DB lookup and before bypass):
 * If allowedProjectIds has length > 0 and does NOT include projectId → 403.
 * Empty/absent allowedProjectIds = unscoped → no restriction (backward-compat).
 *
 * @param userId             - Authenticated user's userId
 * @param projectId          - Resolved project UUID
 * @param workspaceId        - Resolved workspace UUID
 * @param minRole            - Minimum required role (optional; if absent, any access is sufficient)
 * @param allowedProjectIds  - Token-scope claim from request.user (KAN-19); absent/[] = unscoped
 */
export async function enforceProjectAccess(
  userId: string,
  projectId: string,
  workspaceId: string,
  minRole?: MemberRole,
  allowedProjectIds?: string[],
): Promise<{ member: MemberContext; projectRole: MemberRole }> {
  // KAN-19 FIRST-GUARD: credential-scope check — MUST precede bypass AND Member lookup.
  // Discriminator: .length > 0 ([] = unscoped; legacy tokens default to []).
  if (allowedProjectIds && allowedProjectIds.length > 0 && !allowedProjectIds.includes(projectId)) {
    throw new AppError(403, "FORBIDDEN", "Token scope does not allow access to this project");
  }

  // Step 1: resolve workspace member (establishes member.id = workspace Member.id)
  const wsMember = await prisma.member.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId },
    },
    select: { id: true, role: true },
  });

  if (!wsMember) {
    throw new AppError(403, "FORBIDDEN", "You are not a member of this workspace");
  }

  const memberContext: MemberContext = {
    id: wsMember.id,      // INVARIANT: always workspace Member.id
    role: wsMember.role,
    workspaceId,
    userId,
  };

  // Step 2: owner/admin bypass — no ProjectMember lookup required
  if (wsMember.role === "owner" || wsMember.role === "admin") {
    const effectiveRole = wsMember.role;
    if (minRole && !meetsMinimumRole(effectiveRole, minRole)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `This action requires at least the "${minRole}" role`,
      );
    }
    return { member: memberContext, projectRole: effectiveRole };
  }

  // Step 3: member/viewer — require explicit ProjectMember row
  const pm = await prisma.projectMember.findUnique({
    where: {
      userId_projectId: { userId, projectId },
    },
    select: { id: true, role: true },
  });

  if (!pm) {
    throw new AppError(
      403,
      "FORBIDDEN",
      "You are not assigned to this project",
    );
  }

  const effectiveRole = pm.role;
  if (minRole && !meetsMinimumRole(effectiveRole, minRole)) {
    throw new AppError(
      403,
      "FORBIDDEN",
      `This action requires at least the "${minRole}" role`,
    );
  }

  return { member: memberContext, projectRole: effectiveRole };
}

// ---------------------------------------------------------------------------
// Workspace-scoped factories (routes like /api/workspaces/:wid/...)
// ---------------------------------------------------------------------------

/**
 * Factory that returns a Fastify preHandler checking the authenticated user's role
 * within a workspace resolved from a URL parameter.
 *
 * Sets `request.member` with the resolved MemberContext.
 *
 * Usage:
 *   { preHandler: [requireRole('wid', 'admin')] }
 *
 * @param workspaceIdParam - The name of the URL param holding the workspaceId (e.g. 'wid', 'id')
 * @param roles - Allowed MemberRole values. If empty, any membership is sufficient.
 */
export function requireRole(workspaceIdParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const workspaceId = (request.params as Record<string, string>)[workspaceIdParam];
    if (!workspaceId) {
      throw new AppError(400, "WORKSPACE_REQUIRED", "Workspace ID is required");
    }

    // Determine the minimum role from the allowed list (pick the least privileged)
    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    request.member = await resolveAndCheckMember(user.userId, workspaceId, minimumRole);
  };
}

/**
 * Shorthand: require workspace membership with no minimum role.
 * Equivalent to `requireRole(param)` with no role filter.
 */
export function requireMember(workspaceIdParam: string): preHandlerHookHandler {
  return requireRole(workspaceIdParam);
}

// ---------------------------------------------------------------------------
// Project-scoped factories (routes like /api/projects/:key/...)
// Uses the effective-role gate (enforceProjectAccess) for KAN-16 enforcement.
// ---------------------------------------------------------------------------

/**
 * Like requireRole, but resolves the workspace from a project key URL param
 * and then enforces the effective-role gate (KAN-16).
 *
 * Project key is resolved scoped to workspaces the requesting user belongs to
 * (R-KAN16-bug: prevents cross-workspace key collision security issue).
 * Tie-break when user is in two workspaces with same key: oldest workspace (createdAt ASC).
 *
 * Sets `request.member` (workspace Member.id — INVARIANT) and `request.projectRole`.
 *
 * @param projectKeyParam - The name of the URL param holding the project key (e.g. 'key')
 * @param roles - Allowed MemberRole values. If empty, any project membership is sufficient.
 */
export function requireProjectRole(projectKeyParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const projectKey = (request.params as Record<string, string>)[projectKeyParam];
    if (!projectKey) {
      throw new AppError(400, "PROJECT_KEY_REQUIRED", "Project key is required");
    }

    // R-KAN16-bug: scope project lookup to workspaces the user belongs to.
    // Deterministic tie-break: oldest workspace (orderBy workspace.createdAt ASC).
    const project = await prisma.project.findFirst({
      where: {
        key: projectKey,
        workspace: {
          members: {
            some: { userId: user.userId },
          },
        },
      },
      orderBy: {
        workspace: { createdAt: "asc" },
      },
      select: { id: true, workspaceId: true },
    });

    if (!project) {
      throw new AppError(404, "PROJECT_NOT_FOUND", `Project "${projectKey}" not found`);
    }

    // KAN-16 security fix: set gate-resolved id BEFORE enforceProjectAccess so
    // it is populated on EVERY path (bypass and non-bypass). Downstream handlers
    // pass request.projectId to services instead of re-resolving by key, closing
    // the gate↔handler divergence that allows cross-tenant mutations.
    request.projectId = project.id;

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    const { member, projectRole } = await enforceProjectAccess(
      user.userId,
      project.id,
      project.workspaceId,
      minimumRole,
      user.allowedProjectIds,
    );

    request.member = member;
    request.projectRole = projectRole;
  };
}

/**
 * Shorthand: require project membership with no minimum role.
 */
export function requireProjectMember(projectKeyParam: string): preHandlerHookHandler {
  return requireProjectRole(projectKeyParam);
}

// ---------------------------------------------------------------------------
// Issue-scoped factories (routes like /api/issues/:key/...)
// Issue key is globally unique — no workspace-scope fix needed for issue lookup (A4).
// Uses enforceProjectAccess after resolving projectId from the issue.
// ---------------------------------------------------------------------------

/**
 * Like requireRole, but resolves the workspace + project from an issue key URL param
 * and then enforces the effective-role gate (KAN-16).
 *
 * Sets `request.member` and `request.projectRole`.
 *
 * @param issueKeyParam - The name of the URL param holding the issue key (e.g. 'key')
 * @param roles - Allowed MemberRole values. If empty, any project membership is sufficient.
 */
export function requireIssueRole(issueKeyParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const issueKey = (request.params as Record<string, string>)[issueKeyParam];
    if (!issueKey) {
      throw new AppError(400, "ISSUE_KEY_REQUIRED", "Issue key is required");
    }

    // Issue key is globally unique — no workspace-scope needed here (ADR A4)
    const issue = await prisma.issue.findFirst({
      where: { key: issueKey },
      select: {
        project: {
          select: { id: true, workspaceId: true },
        },
      },
    });

    if (!issue) {
      throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    const { member, projectRole } = await enforceProjectAccess(
      user.userId,
      issue.project.id,
      issue.project.workspaceId,
      minimumRole,
      user.allowedProjectIds,
    );

    request.member = member;
    request.projectRole = projectRole;
  };
}

/**
 * Shorthand: require issue project membership with no minimum role.
 */
export function requireIssueMember(issueKeyParam: string): preHandlerHookHandler {
  return requireIssueRole(issueKeyParam);
}

// ---------------------------------------------------------------------------
// Cycle-scoped factories (routes like /api/cycles/:id/...)
// Cycle id is a PK — no workspace-scope fix needed (A4).
// Uses enforceProjectAccess after resolving projectId from the cycle.
// ---------------------------------------------------------------------------

/**
 * Like requireRole, but resolves the workspace + project from a cycle ID URL param
 * and then enforces the effective-role gate (KAN-16).
 *
 * Sets `request.member` and `request.projectRole`.
 *
 * @param cycleIdParam - The name of the URL param holding the cycle ID (e.g. 'id')
 * @param roles - Allowed MemberRole values. If empty, any project membership is sufficient.
 */
export function requireCycleRole(cycleIdParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const cycleId = (request.params as Record<string, string>)[cycleIdParam];
    if (!cycleId) {
      throw new AppError(400, "CYCLE_ID_REQUIRED", "Cycle ID is required");
    }

    const cycle = await prisma.cycle.findUnique({
      where: { id: cycleId },
      select: { project: { select: { id: true, workspaceId: true } } },
    });

    if (!cycle) {
      throw new AppError(404, "CYCLE_NOT_FOUND", `Cycle "${cycleId}" not found`);
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    const { member, projectRole } = await enforceProjectAccess(
      user.userId,
      cycle.project.id,
      cycle.project.workspaceId,
      minimumRole,
      user.allowedProjectIds,
    );

    request.member = member;
    request.projectRole = projectRole;
  };
}

/**
 * Shorthand: require cycle project membership with no minimum role.
 */
export function requireCycleMember(cycleIdParam: string): preHandlerHookHandler {
  return requireCycleRole(cycleIdParam);
}

// ---------------------------------------------------------------------------
// Dependency-scoped factories (routes like /api/issue-dependencies/:id)
// Dependency id is a UUID PK — no workspace-scope fix needed (A4).
// Gates on the SOURCE issue's project (matching how POST gates on the source
// issue key — only members of the source project may add/remove the edge).
// ---------------------------------------------------------------------------

/**
 * Like requireCycleRole, but resolves the workspace + project from a
 * dependency ID URL param and then enforces the effective-role gate (KAN-16).
 *
 * Resolution chain: dependency id → issueDependency row → source issue's
 * project → enforceProjectAccess.  Gates on the SOURCE side because POST
 * (create) gates on the issue key of the source issue; DELETE must mirror that.
 *
 * 404 is returned when the dependency does not exist, consistent with other
 * workspace-scoped resolution patterns (do not leak existence).
 *
 * Sets `request.member` (workspace Member.id — INVARIANT R-INV1) and
 * `request.projectRole`.
 *
 * @param depIdParam - The name of the URL param holding the dependency UUID (e.g. 'id')
 * @param roles - Allowed MemberRole values. If empty, any project membership is sufficient.
 */
export function requireDependencyRole(depIdParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const depId = (request.params as Record<string, string>)[depIdParam];
    if (!depId) {
      throw new AppError(400, "DEPENDENCY_ID_REQUIRED", "Dependency ID is required");
    }

    const dep = await prisma.issueDependency.findUnique({
      where: { id: depId },
      select: {
        source: {
          select: {
            project: { select: { id: true, workspaceId: true } },
          },
        },
      },
    });

    if (!dep) {
      throw new AppError(404, "DEPENDENCY_NOT_FOUND", "Dependency not found");
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    // KAN-19: set request.projectId before enforceProjectAccess so it is
    // populated on every path (bypass and non-bypass), consistent with other
    // project-scoped factories.
    request.projectId = dep.source.project.id;

    const { member, projectRole } = await enforceProjectAccess(
      user.userId,
      dep.source.project.id,
      dep.source.project.workspaceId,
      minimumRole,
      user.allowedProjectIds,
    );

    request.member = member;
    request.projectRole = projectRole;
  };
}

/**
 * Shorthand: require dependency project membership with no minimum role.
 */
export function requireDependencyMember(depIdParam: string): preHandlerHookHandler {
  return requireDependencyRole(depIdParam);
}

// ---------------------------------------------------------------------------
// Instance-scoped guard (KAN-49)
// ---------------------------------------------------------------------------

/**
 * Fastify preHandler that checks the authenticated user is the instance super-admin.
 *
 * Compares `request.user.userId` against `InstanceSettings.ownerUserId`.
 * Takes no workspace parameter — orthogonal to workspace roles.
 *
 * Throws 401 if unauthenticated; 403 if not the owner.
 */
export function requireSuperAdmin(): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const settings = await prisma.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { ownerUserId: true },
    });

    if (!settings?.ownerUserId || settings.ownerUserId !== user.userId) {
      throw new AppError(403, "FORBIDDEN", "Super-admin access required");
    }
  };
}

/**
 * Fastify preHandler that checks the authenticated user holds the instance-admin role.
 *
 * Reads `User.isInstanceAdmin` from the DB (the JWT carries only userId + email,
 * not the instance-admin flag). Orthogonal to super-admin and workspace roles.
 *
 * Throws 401 if unauthenticated; 403 if the flag is false or the user is not found.
 */
export function requireInstanceAdmin(): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;
    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const dbUser = await prisma.user.findUnique({
      where: { id: user.userId },
      select: { isInstanceAdmin: true },
    });

    if (!dbUser?.isInstanceAdmin) {
      throw new AppError(403, "FORBIDDEN", "Instance-admin access required");
    }
  };
}
