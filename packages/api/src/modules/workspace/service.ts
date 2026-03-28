import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { CreateWorkspaceBody, UpdateWorkspaceBody } from "./schema.js";

/**
 * Create a new workspace.
 */
export async function createWorkspace(body: CreateWorkspaceBody) {
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

  return prisma.workspace.create({
    data: {
      name: body.name,
      slug: body.slug,
    },
  });
}

/**
 * List all workspaces for the authenticated member.
 */
export async function listWorkspaces(memberId: string) {
  return prisma.workspace.findMany({
    where: {
      members: {
        some: { id: memberId },
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
