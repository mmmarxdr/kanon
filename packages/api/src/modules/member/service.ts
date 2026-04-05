import type { MemberRole } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { UpdateProfileBody } from "./schema.js";

// Role hierarchy for permission checks (higher index = more privileged)
const ROLE_HIERARCHY: MemberRole[] = ["viewer", "member", "admin", "owner"];

function roleLevel(role: MemberRole): number {
  return ROLE_HIERARCHY.indexOf(role);
}

/**
 * Shape a member + user join result into the ProfileResponse format.
 */
function toProfileResponse(member: {
  id: string;
  username: string;
  role: string;
  workspaceId: string;
  user: { email: string; displayName: string | null; avatarUrl: string | null };
}) {
  return {
    id: member.id,
    email: member.user.email,
    username: member.username,
    displayName: member.user.displayName,
    avatarUrl: member.user.avatarUrl,
    role: member.role,
    workspaceId: member.workspaceId,
  };
}

/**
 * Get a member's profile by userId (looks up the first membership).
 * In a multi-workspace world this would need a workspaceId param,
 * but for now returns the first membership found.
 */
export async function getProfile(userId: string) {
  const member = await prisma.member.findFirst({
    where: { userId },
    select: {
      id: true,
      username: true,
      role: true,
      workspaceId: true,
      user: {
        select: { email: true, displayName: true, avatarUrl: true },
      },
    },
  });

  if (!member) {
    throw new AppError(404, "USER_NOT_FOUND", "Member not found");
  }

  return toProfileResponse(member);
}

/**
 * Update a user's profile (displayName, avatarUrl).
 * These fields now live on the User model, not Member.
 */
export async function updateProfile(userId: string, data: UpdateProfileBody) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true },
  });

  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  // Update User-level fields
  await prisma.user.update({
    where: { id: userId },
    data: {
      ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
      ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
    },
  });

  // Return the member profile shape (join with updated user)
  const member = await prisma.member.findFirst({
    where: { userId },
    select: {
      id: true,
      username: true,
      role: true,
      workspaceId: true,
      user: {
        select: { email: true, displayName: true, avatarUrl: true },
      },
    },
  });

  if (!member) {
    throw new AppError(404, "USER_NOT_FOUND", "Member not found");
  }

  return toProfileResponse(member);
}

// ── Workspace Member Management ──────────────────────────────────────────────

/**
 * List all members of a workspace with user info.
 */
export async function listMembers(workspaceId: string) {
  return prisma.member.findMany({
    where: { workspaceId },
    select: {
      id: true,
      username: true,
      role: true,
      createdAt: true,
      user: {
        select: { email: true, displayName: true, avatarUrl: true },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Add a user as a member of a workspace.
 * - Finds user by email (404 if not found)
 * - Rejects duplicate memberships (409)
 * - Validates that admins cannot add owners
 */
export async function addMember(
  workspaceId: string,
  email: string,
  role: MemberRole,
  actingRole: MemberRole,
) {
  // Admin cannot assign owner role
  if (role === "owner" && actingRole !== "owner") {
    throw new AppError(403, "FORBIDDEN", "Only owners can assign the owner role");
  }

  // Find user by email
  const user = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, displayName: true },
  });
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  // Check for duplicate membership
  const existing = await prisma.member.findUnique({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId,
      },
    },
  });
  if (existing) {
    throw new AppError(409, "ALREADY_MEMBER", "Already a member");
  }

  // Derive username from user info
  const local = user.email.split("@")[0] ?? "user";
  let username = local.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";

  // Ensure username is unique within workspace (append suffix if needed)
  const existingUsername = await prisma.member.findUnique({
    where: {
      workspaceId_username: {
        workspaceId,
        username,
      },
    },
  });
  if (existingUsername) {
    username = `${username}-${Date.now().toString(36)}`;
  }

  return prisma.member.create({
    data: {
      username,
      role,
      userId: user.id,
      workspaceId,
    },
    include: {
      user: {
        select: { email: true, displayName: true, avatarUrl: true },
      },
    },
  });
}

/**
 * Change a member's role.
 * - Admin cannot promote to owner
 * - Cannot demote the last owner
 */
export async function changeMemberRole(
  workspaceId: string,
  memberId: string,
  newRole: MemberRole,
  actingRole: MemberRole,
) {
  const member = await prisma.member.findFirst({
    where: { id: memberId, workspaceId },
  });
  if (!member) {
    throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found");
  }

  // Admin cannot promote to owner
  if (newRole === "owner" && actingRole !== "owner") {
    throw new AppError(403, "FORBIDDEN", "Only owners can promote to owner");
  }

  // Cannot demote the last owner
  if (member.role === "owner" && newRole !== "owner") {
    const ownerCount = await prisma.member.count({
      where: { workspaceId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new AppError(422, "LAST_OWNER", "Cannot demote last owner");
    }
  }

  // Acting member must have higher or equal role than target's current role
  if (roleLevel(actingRole) < roleLevel(member.role)) {
    throw new AppError(403, "FORBIDDEN", "Insufficient permissions to change this member's role");
  }

  return prisma.member.update({
    where: { id: memberId },
    data: { role: newRole },
    include: {
      user: {
        select: { email: true, displayName: true, avatarUrl: true },
      },
    },
  });
}

/**
 * Remove a member from a workspace.
 * - Admin cannot remove an owner
 * - Cannot remove the last owner
 */
export async function removeMember(
  workspaceId: string,
  memberId: string,
  actingUserId: string,
  actingRole: MemberRole,
) {
  const member = await prisma.member.findFirst({
    where: { id: memberId, workspaceId },
  });
  if (!member) {
    throw new AppError(404, "MEMBER_NOT_FOUND", "Member not found");
  }

  // Admin cannot remove an owner
  if (member.role === "owner" && actingRole !== "owner") {
    throw new AppError(403, "FORBIDDEN", "Only owners can remove owners");
  }

  // Cannot remove the last owner
  if (member.role === "owner") {
    const ownerCount = await prisma.member.count({
      where: { workspaceId, role: "owner" },
    });
    if (ownerCount <= 1) {
      throw new AppError(422, "LAST_OWNER", "Cannot remove last owner");
    }
  }

  // Acting member must have higher or equal role than target
  if (roleLevel(actingRole) < roleLevel(member.role) && member.userId !== actingUserId) {
    throw new AppError(403, "FORBIDDEN", "Insufficient permissions to remove this member");
  }

  await prisma.member.delete({
    where: { id: memberId },
  });
}
