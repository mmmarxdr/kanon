import type { MemberRole, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import * as memberService from "../member/service.js";
import { createProjectMembersInTx } from "../project/project-member-service.js";
import type {
  AddMembershipBody,
  AdminUserListQuery,
  BulkBody,
  MoveMembershipBody,
  PatchMembershipBody,
  ReplaceProjectsBody,
} from "./schema.js";

/** Instance admins orchestrate as workspace owner for cross-WS privilege. */
const INSTANCE_ACTING_ROLE: MemberRole = "owner";

async function assertProjectsInWorkspace(
  workspaceId: string,
  projects: Array<{ projectId: string }>,
) {
  const requestedIds = [...new Set(projects.map((p) => p.projectId))];
  if (requestedIds.length === 0) return;

  const live = await prisma.project.findMany({
    where: {
      id: { in: requestedIds },
      workspaceId,
      archived: false,
    },
    select: { id: true },
  });
  if (live.length !== requestedIds.length) {
    throw new AppError(
      422,
      "INVALID_PROJECT",
      "One or more projects are missing, archived, or outside this workspace",
    );
  }
}

/** Instance-admin directory helpers for assignment pickers (not a public catalog). */
export async function listAllWorkspaces() {
  const rows = await prisma.workspace.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
  return { workspaces: rows };
}

export async function listWorkspaceProjects(workspaceId: string) {
  const workspace = await prisma.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }

  const projects = await prisma.project.findMany({
    where: { workspaceId, archived: false },
    orderBy: { key: "asc" },
    select: { id: true, key: true, name: true },
  });
  return { projects };
}

export async function listUsers(query: AdminUserListQuery) {
  const where: Prisma.UserWhereInput = {
    ...(query.q
      ? { email: { contains: query.q, mode: "insensitive" as const } }
      : {}),
    ...(query.verified === true
      ? { emailVerifiedAt: { not: null } }
      : query.verified === false
        ? { emailVerifiedAt: null }
        : {}),
  };

  const [total, rows] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: [{ createdAt: "desc" }, { id: "asc" }],
      skip: query.offset,
      take: query.limit,
      select: {
        id: true,
        email: true,
        displayName: true,
        emailVerifiedAt: true,
        isInstanceAdmin: true,
        createdAt: true,
        members: {
          select: {
            workspace: { select: { id: true, name: true } },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    }),
  ]);

  return {
    users: rows.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      emailVerified: u.emailVerifiedAt !== null,
      isInstanceAdmin: u.isInstanceAdmin,
      createdAt: u.createdAt.toISOString(),
      workspaceCount: u.members.length,
      workspaces: u.members.map((m) => ({
        id: m.workspace.id,
        name: m.workspace.name,
      })),
    })),
    total,
    limit: query.limit,
    offset: query.offset,
  };
}

export async function getUserDetail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      displayName: true,
      avatarUrl: true,
      emailVerifiedAt: true,
      isInstanceAdmin: true,
      isSuperAdmin: true,
      createdAt: true,
      members: {
        orderBy: { createdAt: "asc" },
        select: {
          id: true,
          role: true,
          projectAccess: true,
          workspaceId: true,
          workspace: { select: { id: true, name: true, slug: true } },
        },
      },
    },
  });

  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const memberships = await Promise.all(
    user.members.map(async (m) => {
      if (m.projectAccess !== "assigned") {
        return {
          memberId: m.id,
          workspaceId: m.workspace.id,
          workspaceName: m.workspace.name,
          workspaceSlug: m.workspace.slug,
          role: m.role,
          projectAccess: m.projectAccess,
          projects: null,
        };
      }

      const projects = await prisma.projectMember.findMany({
        where: {
          userId,
          project: { workspaceId: m.workspaceId, archived: false },
        },
        select: {
          role: true,
          project: { select: { id: true, key: true, name: true } },
        },
        orderBy: { project: { key: "asc" } },
      });

      return {
        memberId: m.id,
        workspaceId: m.workspace.id,
        workspaceName: m.workspace.name,
        workspaceSlug: m.workspace.slug,
        role: m.role,
        projectAccess: m.projectAccess,
        projects: projects.map((p) => ({
          projectId: p.project.id,
          key: p.project.key,
          name: p.project.name,
          role: p.role,
        })),
      };
    }),
  );

  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    emailVerified: user.emailVerifiedAt !== null,
    emailVerifiedAt: user.emailVerifiedAt?.toISOString() ?? null,
    isInstanceAdmin: user.isInstanceAdmin,
    isSuperAdmin: user.isSuperAdmin,
    createdAt: user.createdAt.toISOString(),
    memberships,
  };
}

export async function verifyUserEmail(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, emailVerifiedAt: true },
  });
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  if (user.emailVerifiedAt) {
    return { id: userId, emailVerified: true, alreadyVerified: true };
  }

  await prisma.user.update({
    where: { id: userId },
    data: { emailVerifiedAt: new Date() },
  });
  return { id: userId, emailVerified: true, alreadyVerified: false };
}

async function assertMembershipOwnedByUser(memberId: string, userId: string) {
  const member = await prisma.member.findFirst({
    where: { id: memberId, userId },
    select: {
      id: true,
      workspaceId: true,
      role: true,
      projectAccess: true,
      user: { select: { email: true } },
    },
  });
  if (!member) {
    throw new AppError(404, "MEMBER_NOT_FOUND", "Membership not found for this user");
  }
  return member;
}

export async function addMembership(
  userId: string,
  body: AddMembershipBody,
  actorUserId: string,
) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const workspace = await prisma.workspace.findUnique({
    where: { id: body.workspaceId },
    select: { id: true },
  });
  if (!workspace) {
    throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }

  const initialProjects =
    body.projectAccess === "assigned" && body.projects && body.projects.length > 0
      ? body.projects
      : null;
  if (initialProjects) {
    await assertProjectsInWorkspace(body.workspaceId, initialProjects);
  }

  const member = await memberService.addMember(
    body.workspaceId,
    user.email,
    body.role,
    INSTANCE_ACTING_ROLE,
    actorUserId,
  );

  if (body.projectAccess !== "assigned") {
    await prisma.member.update({
      where: { id: member.id },
      data: { projectAccess: body.projectAccess },
    });
  }

  if (initialProjects) {
    try {
      await replaceMembershipProjects(userId, member.id, {
        projects: initialProjects,
      });
    } catch (err) {
      await memberService.removeMember(
        body.workspaceId,
        member.id,
        actorUserId,
        INSTANCE_ACTING_ROLE,
      );
      throw err;
    }
  }

  return getUserDetail(userId);
}

export async function moveMembership(
  userId: string,
  memberId: string,
  body: MoveMembershipBody,
  actorUserId: string,
) {
  const member = await assertMembershipOwnedByUser(memberId, userId);

  if (member.workspaceId === body.workspaceId) {
    throw new AppError(
      422,
      "SAME_WORKSPACE",
      "Target workspace must be different from the current membership",
    );
  }

  const existingTarget = await prisma.member.findUnique({
    where: {
      userId_workspaceId: { userId, workspaceId: body.workspaceId },
    },
    select: { id: true },
  });
  if (existingTarget) {
    throw new AppError(
      409,
      "ALREADY_MEMBER",
      "User is already a member of the target workspace",
    );
  }

  if (member.role === "owner") {
    const ownerCount = await prisma.member.count({
      where: { workspaceId: member.workspaceId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new AppError(
        422,
        "LAST_OWNER",
        "Cannot move the last owner out of a workspace",
      );
    }
  }

  const role = body.role ?? member.role;
  const projectAccess = body.projectAccess ?? member.projectAccess;

  await addMembership(
    userId,
    {
      workspaceId: body.workspaceId,
      role,
      projectAccess,
    },
    actorUserId,
  );

  try {
    await removeMembership(userId, memberId, actorUserId);
  } catch (err) {
    // Compensate: drop the target membership we just created so move is atomic-ish.
    const created = await prisma.member.findUnique({
      where: {
        userId_workspaceId: { userId, workspaceId: body.workspaceId },
      },
      select: { id: true },
    });
    if (created) {
      await memberService.removeMember(
        body.workspaceId,
        created.id,
        actorUserId,
        INSTANCE_ACTING_ROLE,
      );
    }
    throw err;
  }

  return getUserDetail(userId);
}

export async function patchMembership(
  userId: string,
  memberId: string,
  body: PatchMembershipBody,
  actorUserId: string,
) {
  const member = await assertMembershipOwnedByUser(memberId, userId);

  if (body.role !== undefined) {
    await memberService.changeMemberRole(
      member.workspaceId,
      memberId,
      body.role,
      INSTANCE_ACTING_ROLE,
      actorUserId,
    );
  }

  if (body.projectAccess !== undefined) {
    await prisma.member.update({
      where: { id: memberId },
      data: { projectAccess: body.projectAccess },
    });
  }

  return getUserDetail(userId);
}

export async function removeMembership(
  userId: string,
  memberId: string,
  actorUserId: string,
) {
  const member = await assertMembershipOwnedByUser(memberId, userId);
  await memberService.removeMember(
    member.workspaceId,
    memberId,
    actorUserId,
    INSTANCE_ACTING_ROLE,
  );
  return getUserDetail(userId);
}

export async function replaceMembershipProjects(
  userId: string,
  memberId: string,
  body: ReplaceProjectsBody,
) {
  const member = await assertMembershipOwnedByUser(memberId, userId);

  if (member.projectAccess !== "assigned") {
    throw new AppError(
      422,
      "INVALID_PROJECT_ACCESS",
      "Project list can only be replaced when projectAccess is assigned",
    );
  }

  await assertProjectsInWorkspace(member.workspaceId, body.projects);

  await prisma.$transaction(async (tx) => {
    await tx.projectMember.deleteMany({
      where: {
        userId,
        project: { workspaceId: member.workspaceId },
      },
    });
    await createProjectMembersInTx(
      tx,
      userId,
      body.projects.map((p) => ({
        projectId: p.projectId,
        role: p.role as MemberRole,
      })),
      member.workspaceId,
    );
  });

  return getUserDetail(userId);
}

export async function bulkAction(body: BulkBody, actorUserId: string) {
  const results: Array<{ userId: string; ok: boolean; error?: string }> = [];

  for (const userId of body.userIds) {
    try {
      if (body.action === "verify_email") {
        await verifyUserEmail(userId);
        results.push({ userId, ok: true });
        continue;
      }

      const member = await prisma.member.findUnique({
        where: {
          userId_workspaceId: {
            userId,
            workspaceId: body.workspaceId!,
          },
        },
        select: { id: true },
      });
      if (!member) {
        results.push({ userId, ok: false, error: "NOT_A_MEMBER" });
        continue;
      }
      await memberService.removeMember(
        body.workspaceId!,
        member.id,
        actorUserId,
        INSTANCE_ACTING_ROLE,
      );
      results.push({ userId, ok: true });
    } catch (err) {
      const code =
        err instanceof AppError ? err.code : "INTERNAL_ERROR";
      results.push({ userId, ok: false, error: code });
    }
  }

  return { results };
}
