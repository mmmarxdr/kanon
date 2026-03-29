import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { UpdateProfileBody } from "./schema.js";

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
