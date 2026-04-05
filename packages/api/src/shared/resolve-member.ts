import { prisma } from "../config/prisma.js";
import { AppError } from "./types.js";

/**
 * Resolve a Member ID from a userId and workspaceId.
 * Used by workspace-scoped operations (activity logs, comments, etc.)
 * that need a Member FK but only have the authenticated userId.
 *
 * @deprecated Use `requireMember`/`requireRole` middleware instead, which sets `request.member`.
 */
export async function resolveMemberId(
  userId: string,
  workspaceId: string,
): Promise<string> {
  const member = await prisma.member.findUnique({
    where: {
      userId_workspaceId: {
        userId,
        workspaceId,
      },
    },
    select: { id: true },
  });

  if (!member) {
    throw new AppError(
      403,
      "NOT_A_MEMBER",
      "You are not a member of this workspace",
    );
  }

  return member.id;
}

/**
 * Resolve a Member ID from a userId and an issue key.
 * Looks up the issue's project workspace, then finds the member.
 *
 * @deprecated Use `requireIssueMember`/`requireIssueRole` middleware instead, which sets `request.member`.
 */
export async function resolveMemberIdFromIssue(
  userId: string,
  issueKey: string,
): Promise<string> {
  const issue = await prisma.issue.findUnique({
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

  return resolveMemberId(userId, issue.project.workspaceId);
}

/**
 * Resolve a Member ID from a userId and a project key.
 * Looks up the project's workspace, then finds the member.
 *
 * @deprecated Use `requireProjectMember`/`requireProjectRole` middleware instead, which sets `request.member`.
 */
export async function resolveMemberIdFromProject(
  userId: string,
  projectKey: string,
): Promise<string> {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
    select: { workspaceId: true },
  });

  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  return resolveMemberId(userId, project.workspaceId);
}
