import type { MemberRole } from "@prisma/client";
import type { preHandlerHookHandler } from "fastify";
import { prisma } from "../config/prisma.js";
import { AppError } from "../shared/types.js";

/**
 * Factory that returns a Fastify preHandler checking the authenticated user's role
 * within a specific workspace. The workspace is resolved from a URL parameter.
 *
 * Usage:
 *   { preHandler: [requireRole('id', 'owner', 'admin')] }
 *
 * @param workspaceIdParam - The name of the URL param holding the workspaceId (e.g. 'id')
 * @param roles - Allowed MemberRole values
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

    const member = await prisma.member.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.userId,
          workspaceId,
        },
      },
      select: { role: true },
    });

    if (!member) {
      throw new AppError(403, "FORBIDDEN", "You are not a member of this workspace");
    }

    if (!roles.includes(member.role)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `This action requires one of the following roles: ${roles.join(", ")}`,
      );
    }
  };
}

/**
 * Like requireRole, but resolves the workspace from a project key URL param
 * instead of a direct workspace ID param. Useful for routes like /projects/:key
 * where the workspace is not in the URL.
 *
 * @param projectKeyParam - The name of the URL param holding the project key (e.g. 'key')
 * @param roles - Allowed MemberRole values
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

    const member = await prisma.member.findUnique({
      where: {
        userId_workspaceId: {
          userId: user.userId,
          workspaceId: project.workspaceId,
        },
      },
      select: { role: true },
    });

    if (!member) {
      throw new AppError(403, "FORBIDDEN", "You are not a member of this workspace");
    }

    if (!roles.includes(member.role)) {
      throw new AppError(
        403,
        "FORBIDDEN",
        `This action requires one of the following roles: ${roles.join(", ")}`,
      );
    }
  };
}
