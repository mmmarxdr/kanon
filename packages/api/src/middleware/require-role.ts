import type { MemberRole } from "@prisma/client";
import type { preHandlerHookHandler } from "fastify";
import { prisma } from "../config/prisma.js";
import { AppError } from "../shared/types.js";
import type { MemberContext } from "../shared/types.js";

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
// ---------------------------------------------------------------------------

/**
 * Like requireRole, but resolves the workspace from a project key URL param
 * instead of a direct workspace ID param.
 *
 * Sets `request.member` with the resolved MemberContext.
 *
 * @param projectKeyParam - The name of the URL param holding the project key (e.g. 'key')
 * @param roles - Allowed MemberRole values. If empty, any membership is sufficient.
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

    const project = await prisma.project.findFirst({
      where: { key: projectKey },
      select: { workspaceId: true },
    });

    if (!project) {
      throw new AppError(404, "PROJECT_NOT_FOUND", `Project "${projectKey}" not found`);
    }

    const minimumRole = roles.length > 0
      ? roles.reduce((least, r) =>
          ROLE_HIERARCHY.indexOf(r) < ROLE_HIERARCHY.indexOf(least) ? r : least,
        )
      : undefined;

    request.member = await resolveAndCheckMember(user.userId, project.workspaceId, minimumRole);
  };
}

/**
 * Shorthand: require project workspace membership with no minimum role.
 */
export function requireProjectMember(projectKeyParam: string): preHandlerHookHandler {
  return requireProjectRole(projectKeyParam);
}

// ---------------------------------------------------------------------------
// Issue-scoped factories (routes like /api/issues/:key/...)
// ---------------------------------------------------------------------------

/**
 * Like requireRole, but resolves the workspace from an issue key URL param
 * by looking up the issue's project workspace.
 *
 * Sets `request.member` with the resolved MemberContext.
 *
 * @param issueKeyParam - The name of the URL param holding the issue key (e.g. 'key')
 * @param roles - Allowed MemberRole values. If empty, any membership is sufficient.
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

    const issue = await prisma.issue.findFirst({
      where: { key: issueKey },
      select: {
        project: {
          select: { workspaceId: true },
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

    request.member = await resolveAndCheckMember(user.userId, issue.project.workspaceId, minimumRole);
  };
}

/**
 * Shorthand: require issue workspace membership with no minimum role.
 */
export function requireIssueMember(issueKeyParam: string): preHandlerHookHandler {
  return requireIssueRole(issueKeyParam);
}
