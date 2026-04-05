import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { CreateWorkspaceBody, UpdateWorkspaceBody } from "./schema.js";

/**
 * Derive a username from a user's email or displayName.
 * Takes the local part of the email, lowercases it, and strips non-alphanumeric chars.
 */
function deriveUsername(email: string, displayName?: string | null): string {
  if (displayName) {
    const slug = displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (slug.length > 0) return slug;
  }
  // Fall back to email local part
  const local = email.split("@")[0] ?? "user";
  return local.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "user";
}

/**
 * Create a new workspace and add the creator as owner atomically.
 */
export async function createWorkspace(body: CreateWorkspaceBody, userId: string) {
  // Check for duplicate slug
  const existing = await prisma.workspace.findUnique({
    where: { slug: body.slug },
  });
  if (existing) {
    throw new AppError(
      409,
      "DUPLICATE_SLUG",
      `Workspace with slug "${body.slug}" already exists`,
    );
  }

  // Look up user for username derivation
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true, displayName: true },
  });
  if (!user) {
    throw new AppError(404, "USER_NOT_FOUND", "User not found");
  }

  const username = deriveUsername(user.email, user.displayName);

  // Atomic transaction: create workspace + owner member
  return prisma.$transaction(async (tx) => {
    const workspace = await tx.workspace.create({
      data: {
        name: body.name,
        slug: body.slug,
      },
    });

    await tx.member.create({
      data: {
        username,
        role: "owner",
        userId,
        workspaceId: workspace.id,
      },
    });

    return workspace;
  });
}

/**
 * List all workspaces for the authenticated user.
 */
export async function listWorkspaces(userId: string) {
  return prisma.workspace.findMany({
    where: {
      members: {
        some: { userId },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Update a workspace by ID.
 */
export async function updateWorkspace(id: string, body: UpdateWorkspaceBody) {
  const workspace = await prisma.workspace.findUnique({ where: { id } });
  if (!workspace) {
    throw new AppError(404, "WORKSPACE_NOT_FOUND", "Workspace not found");
  }

  // Check slug uniqueness if changing
  if (body.slug && body.slug !== workspace.slug) {
    const existing = await prisma.workspace.findUnique({
      where: { slug: body.slug },
    });
    if (existing) {
      throw new AppError(
        409,
        "DUPLICATE_SLUG",
        `Workspace with slug "${body.slug}" already exists`,
      );
    }
  }

  return prisma.workspace.update({
    where: { id },
    data: body,
  });
}
