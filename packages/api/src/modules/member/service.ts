import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { UpdateProfileBody } from "./schema.js";

/**
 * Get a member's profile by ID.
 */
export async function getProfile(memberId: string) {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      role: true,
      workspaceId: true,
    },
  });

  if (!member) {
    throw new AppError(404, "USER_NOT_FOUND", "Member not found");
  }

  return member;
}

/**
 * Update a member's profile (displayName, avatarUrl).
 */
export async function updateProfile(memberId: string, data: UpdateProfileBody) {
  const member = await prisma.member.findUnique({
    where: { id: memberId },
    select: { id: true },
  });

  if (!member) {
    throw new AppError(404, "USER_NOT_FOUND", "Member not found");
  }

  const updated = await prisma.member.update({
    where: { id: memberId },
    data: {
      ...(data.displayName !== undefined ? { displayName: data.displayName } : {}),
      ...(data.avatarUrl !== undefined ? { avatarUrl: data.avatarUrl } : {}),
    },
    select: {
      id: true,
      email: true,
      username: true,
      displayName: true,
      avatarUrl: true,
      role: true,
      workspaceId: true,
    },
  });

  return updated;
}
