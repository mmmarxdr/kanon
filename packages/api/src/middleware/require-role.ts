import type { MemberRole } from "@prisma/client";
import type { preHandlerHookHandler } from "fastify";
import { prisma } from "../config/prisma.js";
import { AppError } from "../shared/types.js";
import type { MemberContext } from "../shared/types.js";
import { INSTANCE_SETTINGS_ID } from "../shared/constants.js";

/**
 * Role hierarchy — higher index = more privileged.
 * Order: viewer < member < pm < admin < owner (KAN-99 PR1).
 * Exported for use in tests (WARNING-4 fix).
 */
export const ROLE_HIERARCHY: readonly MemberRole[] = ["viewer", "member", "pm", "admin", "owner"] as const;

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
        id: true,
        project: {
          select: { id: true, workspaceId: true },
        },
      },
    });

    if (!issue) {
      throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
    }

    // Mirror the requireProjectRole pattern: store gate-resolved ID so downstream
    // route handlers can use request.issueId directly (no second DB lookup).
    request.issueId = issue.id;

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

// ---------------------------------------------------------------------------
// Milestone-scoped factories (routes like /api/milestones/:id/...)
// Milestone id is a UUID PK — no workspace-scope fix needed (A4).
// Resolves project via milestone → project → workspace, then enforces role.
// Write gate requires "pm" minimum; read gate requires project membership.
// ---------------------------------------------------------------------------

/**
 * Like requireDependencyRole in shape, but resolves workspace + project from a
 * Milestone ID URL param and then enforces the effective-role gate (KAN-16).
 *
 * Resolution chain: milestone id → milestones row → project {id, workspaceId}
 * → enforceProjectAccess.
 *
 * 404 is returned when the milestone does not exist, consistent with other
 * ID-scoped resolution patterns.
 *
 * Sets `request.member` (workspace Member.id — INVARIANT R-INV1) and
 * `request.projectRole`.
 *
 * @param milestoneIdParam - The name of the URL param holding the milestone UUID (e.g. 'id')
 * @param roles - Allowed MemberRole values. If empty, any project membership is sufficient.
 */
export function requireMilestoneRole(milestoneIdParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const milestoneId = (request.params as Record<string, string>)[milestoneIdParam];
    if (!milestoneId) {
      throw new AppError(400, "MILESTONE_ID_REQUIRED", "Milestone ID is required");
    }

    const milestone = await prisma.milestone.findUnique({
      where: { id: milestoneId },
      select: {
        project: { select: { id: true, workspaceId: true } },
      },
    });

    if (!milestone) {
      throw new AppError(404, "MILESTONE_NOT_FOUND", "Milestone not found");
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    // Mirror requireDependencyRole: set request.projectId before enforceProjectAccess
    request.projectId = milestone.project.id;

    const { member, projectRole } = await enforceProjectAccess(
      user.userId,
      milestone.project.id,
      milestone.project.workspaceId,
      minimumRole,
      user.allowedProjectIds,
    );

    request.member = member;
    request.projectRole = projectRole;
  };
}

// ---------------------------------------------------------------------------
// TimeEntry-scoped factories (routes like /api/time-entries/:id/...)
// TimeEntry id is a UUID PK. Resolves project via timeEntry → issue? → project.
// For issue-less entries the entry is gated on the entry owner's workspace project.
// ---------------------------------------------------------------------------

/**
 * Like requireDependencyRole in shape, but resolves workspace + project from a
 * TimeEntry ID URL param and then enforces the effective-role gate (KAN-16).
 *
 * Resolution chain (KAN-100):
 *   timeEntry.id → time_entries row → (issueId → issue → project → workspace)
 *   OR (memberId → member → workspace) as fallback when issueId is null.
 *
 * For approve/reject gates, pass minRole "pm" — the ROLE_HIERARCHY ensures
 * owner/admin/pm pass; member/viewer get 403.
 *
 * Sets `request.member` (workspace Member.id — INVARIANT R-INV1) and
 * `request.projectRole`.
 *
 * @param entryIdParam - The name of the URL param holding the TimeEntry UUID (e.g. 'id')
 * @param roles - Allowed MemberRole values. If empty, any project membership is sufficient.
 */
export function requireEntryRole(entryIdParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const entryId = (request.params as Record<string, string>)[entryIdParam];
    if (!entryId) {
      throw new AppError(400, "ENTRY_ID_REQUIRED", "Time entry ID is required");
    }

    const entry = await prisma.timeEntry.findUnique({
      where: { id: entryId },
      select: {
        memberId: true,
        issue: {
          select: { project: { select: { id: true, workspaceId: true } } },
        },
        member: {
          select: { workspaceId: true },
        },
      },
    });

    if (!entry) {
      throw new AppError(404, "TIME_ENTRY_NOT_FOUND", `Time entry "${entryId}" not found`);
    }

    // Resolve project + workspace from issue if present; fall back to the
    // member's workspace (issue-less entries are workspace-gated only).
    const projectContext = entry.issue?.project ?? null;
    if (!projectContext) {
      // Issue-less time entry: fall back to workspace membership check.
      //
      // When the time entry has no issueId there is no project to gate against,
      // so the KAN-19 allowedProjectIds project-scoping check (inside
      // enforceProjectAccess) cannot apply — there is no projectId to compare.
      // This is a deliberate, accepted limitation for issue-less entries:
      // authz falls back to workspace membership + role check only.
      // If stricter per-project scoping is ever needed for issue-less entries,
      // a follow-up ticket should add an explicit projectId field to TimeEntry
      // so the project can be derived without going through an issue. (KAN-19)
      const minimumRole = roles.length > 0
        ? roles.reduce((least, r) =>
            ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
          )
        : undefined;
      request.member = await resolveAndCheckMember(
        user.userId,
        entry.member.workspaceId,
        minimumRole,
      );
      return;
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    request.projectId = projectContext.id;

    const { member, projectRole } = await enforceProjectAccess(
      user.userId,
      projectContext.id,
      projectContext.workspaceId,
      minimumRole,
      user.allowedProjectIds,
    );

    request.member = member;
    request.projectRole = projectRole;
  };
}

// ---------------------------------------------------------------------------
// WorkLog-scoped factories (routes like /api/worklogs/:id/...)
// WorkLog id is a UUID PK. Resolves project via workLog → issue → project.
// ---------------------------------------------------------------------------

/**
 * Like requireEntryRole in shape, but resolves workspace + project from a
 * WorkLog ID URL param and then enforces the effective-role gate (KAN-16).
 *
 * Resolution chain: workLog.id → work_logs row → issue → project → workspace.
 *
 * Sets `request.member` (workspace Member.id — INVARIANT R-INV1) and
 * `request.projectRole`.
 *
 * @param workLogIdParam - The name of the URL param holding the WorkLog UUID (e.g. 'id')
 * @param roles - Allowed MemberRole values. If empty, any project membership is sufficient.
 */
export function requireWorkLogRole(workLogIdParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const workLogId = (request.params as Record<string, string>)[workLogIdParam];
    if (!workLogId) {
      throw new AppError(400, "WORKLOG_ID_REQUIRED", "WorkLog ID is required");
    }

    const workLog = await prisma.workLog.findUnique({
      where: { id: workLogId },
      select: {
        issue: {
          select: { project: { select: { id: true, workspaceId: true } } },
        },
      },
    });

    if (!workLog) {
      throw new AppError(404, "WORKLOG_NOT_FOUND", `WorkLog "${workLogId}" not found`);
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    request.projectId = workLog.issue.project.id;

    const { member, projectRole } = await enforceProjectAccess(
      user.userId,
      workLog.issue.project.id,
      workLog.issue.project.workspaceId,
      minimumRole,
      user.allowedProjectIds,
    );

    request.member = member;
    request.projectRole = projectRole;
  };
}

// ---------------------------------------------------------------------------
// Comment-scoped factories (routes like /api/comments/:id)
// Comment id is a UUID PK. Resolves project via comment → issue → project.
// Uses inline KAN-19 scope guard + workspace-member resolution (NOT enforceProjectAccess)
// to preserve any-workspace-member access (AC) without requiring a ProjectMember row.
// ---------------------------------------------------------------------------

/**
 * Like requireProposalRole in shape, but resolves workspace + project from a comment ID
 * URL param.
 *
 * Authorization model (KAN-25):
 * - KAN-19 FIRST-GUARD: if the token's allowedProjectIds is non-empty and does NOT
 *   include the comment's projectId → 403. Fires before any membership lookup.
 * - Workspace membership is the primary access gate (no ProjectMember row required).
 *   This preserves the existing AC — any workspace member may read/edit comments.
 *
 * Resolution chain: comment id → comment.issue.project {id, workspaceId}
 * → KAN-19 inline guard → resolveAndCheckMember(workspaceId).
 *
 * 404 is returned when the comment does not exist.
 *
 * Sets `request.member` (workspace Member.id — INVARIANT R-INV1).
 *
 * @param commentIdParam - The name of the URL param holding the comment UUID (e.g. 'id')
 * @param roles - Allowed MemberRole values. If empty, any workspace membership is sufficient.
 */
export function requireCommentRole(commentIdParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const commentId = (request.params as Record<string, string>)[commentIdParam];
    if (!commentId) {
      throw new AppError(400, "COMMENT_ID_REQUIRED", "Comment ID is required");
    }

    const comment = await prisma.comment.findUnique({
      where: { id: commentId },
      select: { issue: { select: { project: { select: { id: true, workspaceId: true } } } } },
    });

    if (!comment) {
      throw new AppError(404, "COMMENT_NOT_FOUND", `Comment "${commentId}" not found`);
    }

    const { id: projectId, workspaceId } = comment.issue.project;

    // KAN-25 / KAN-19 FIRST-GUARD: fires before workspace member lookup.
    if (user.allowedProjectIds && user.allowedProjectIds.length > 0 && !user.allowedProjectIds.includes(projectId)) {
      throw new AppError(403, "FORBIDDEN", "Token scope does not allow access to this project");
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    request.member = await resolveAndCheckMember(user.userId, workspaceId, minimumRole);
  };
}

/**
 * Shorthand: require comment workspace membership with no minimum role.
 */
export function requireCommentMember(commentIdParam: string): preHandlerHookHandler {
  return requireCommentRole(commentIdParam);
}

// ---------------------------------------------------------------------------
// Document-scoped factories (routes like /api/documents/:id)
// Document id is a UUID PK. Resolves project via document → issue → project.
// Uses inline KAN-19 scope guard + workspace-member resolution (NOT enforceProjectAccess)
// to preserve any-workspace-member access (AC) without requiring a ProjectMember row.
// ---------------------------------------------------------------------------

/**
 * Like requireCommentRole in shape, but resolves workspace + project from a document ID
 * URL param.
 *
 * Authorization model (KAN-25):
 * - KAN-19 FIRST-GUARD: if the token's allowedProjectIds is non-empty and does NOT
 *   include the document's projectId → 403. Fires before any membership lookup.
 * - Workspace membership is the primary access gate (no ProjectMember row required).
 *   This preserves the existing AC — any workspace member may read/edit documents.
 *
 * Resolution chain: document id → issueDocument.issue.project {id, workspaceId}
 * → KAN-19 inline guard → resolveAndCheckMember(workspaceId).
 *
 * 404 is returned when the document does not exist.
 *
 * Sets `request.member` (workspace Member.id — INVARIANT R-INV1).
 *
 * @param docIdParam - The name of the URL param holding the document UUID (e.g. 'id')
 * @param roles - Allowed MemberRole values. If empty, any workspace membership is sufficient.
 */
export function requireDocumentRole(docIdParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const documentId = (request.params as Record<string, string>)[docIdParam];
    if (!documentId) {
      throw new AppError(400, "DOCUMENT_ID_REQUIRED", "Document ID is required");
    }

    const document = await prisma.issueDocument.findUnique({
      where: { id: documentId },
      select: { issue: { select: { project: { select: { id: true, workspaceId: true } } } } },
    });

    if (!document) {
      throw new AppError(404, "DOCUMENT_NOT_FOUND", `Document "${documentId}" not found`);
    }

    const { id: projectId, workspaceId } = document.issue.project;

    // KAN-25 / KAN-19 FIRST-GUARD: fires before workspace member lookup.
    if (user.allowedProjectIds && user.allowedProjectIds.length > 0 && !user.allowedProjectIds.includes(projectId)) {
      throw new AppError(403, "FORBIDDEN", "Token scope does not allow access to this project");
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    request.member = await resolveAndCheckMember(user.userId, workspaceId, minimumRole);
  };
}

/**
 * Shorthand: require document workspace membership with no minimum role.
 */
export function requireDocumentMember(docIdParam: string): preHandlerHookHandler {
  return requireDocumentRole(docIdParam);
}

// ---------------------------------------------------------------------------
// Proposal-scoped guard (KAN-64 + KAN-25)
// ---------------------------------------------------------------------------

/**
 * Factory that returns a Fastify preHandler checking the authenticated user's role
 * within the workspace that owns a proposal resolved from a URL parameter.
 *
 * Authorization model (KAN-64 + KAN-25):
 * - Workspace membership is the primary gate (proposals are workspace-scoped resources).
 * - KAN-19 scope guard: if the proposal carries a non-null projectId AND the token's
 *   allowedProjectIds is non-empty AND does NOT include that projectId → 403 FORBIDDEN.
 *   This guard fires BEFORE the workspace membership lookup (KAN-19 first-guard precedent).
 * - Workspace-level proposals (projectId = null) are NOT subject to the project scope
 *   guard — there is no project to scope against. A token scoped to any project may
 *   act on workspace-level proposals as long as workspace membership is satisfied.
 *
 * Sets `request.member` (workspace Member.id — INVARIANT R-INV1).
 *
 * @param proposalIdParam - The name of the URL param holding the proposal UUID (e.g. 'id')
 * @param roles - Allowed MemberRole values. If empty, any workspace membership is sufficient.
 */
export function requireProposalRole(proposalIdParam: string, ...roles: MemberRole[]): preHandlerHookHandler {
  return async (request, _reply) => {
    const user = request.user;

    if (!user) {
      throw new AppError(401, "UNAUTHORIZED", "Authentication required");
    }

    const proposalId = (request.params as Record<string, string>)[proposalIdParam];
    if (!proposalId) {
      throw new AppError(400, "PROPOSAL_ID_REQUIRED", "Proposal ID is required");
    }

    const proposal = await prisma.mcpProposal.findUnique({
      where: { id: proposalId },
      select: { workspaceId: true, projectId: true },
    });

    if (!proposal) {
      throw new AppError(404, "PROPOSAL_NOT_FOUND", "Proposal not found");
    }

    // KAN-25 / KAN-19 FIRST-GUARD: apply project scope check before workspace member lookup.
    // Only applies when the proposal is project-scoped (projectId != null).
    // Workspace-level proposals (projectId = null) are workspace-gated only — no project to scope against.
    if (
      proposal.projectId != null &&
      user.allowedProjectIds &&
      user.allowedProjectIds.length > 0 &&
      !user.allowedProjectIds.includes(proposal.projectId)
    ) {
      throw new AppError(403, "FORBIDDEN", "Token scope does not allow access to this project");
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    request.member = await resolveAndCheckMember(user.userId, proposal.workspaceId, minimumRole);
  };
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
