import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { CreateProjectBody, UpdateProjectBody } from "./schema.js";

/**
 * Create a project within a workspace.
 */
export async function createProject(
  workspaceId: string,
  body: CreateProjectBody,
) {
  // Check unique key within workspace
  const existing = await prisma.project.findUnique({
    where: {
      workspaceId_key: {
        workspaceId,
        key: body.key,
      },
    },
  });
  if (existing) {
    throw new AppError(
      409,
      "DUPLICATE_KEY",
      `Project with key "${body.key}" already exists in this workspace`,
    );
  }

  return prisma.project.create({
    data: {
      key: body.key,
      name: body.name,
      description: body.description,
      workspaceId,
    },
  });
}

/**
 * List projects in a workspace.
 */
export async function listProjects(workspaceId: string) {
  return prisma.project.findMany({
    where: { workspaceId, archived: false },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Get a project by key.
 */
export async function getProject(key: string) {
  const project = await prisma.project.findFirst({
    where: { key },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${key}" not found`,
    );
  }
  return project;
}

/**
 * Update a project by key.
 */
export async function updateProject(key: string, body: UpdateProjectBody) {
  const project = await prisma.project.findFirst({
    where: { key },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${key}" not found`,
    );
  }

  return prisma.project.update({
    where: { id: project.id },
    data: body,
  });
}

/**
 * Soft delete (archive) a project by key.
 */
export async function archiveProject(key: string) {
  const project = await prisma.project.findFirst({
    where: { key },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${key}" not found`,
    );
  }

  return prisma.project.update({
    where: { id: project.id },
    data: { archived: true },
  });
}
