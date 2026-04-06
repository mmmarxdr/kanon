import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import type { CreateProjectBody, UpdateProjectBody } from "./schema.js";
import { eventBus } from "../../services/event-bus/index.js";

/**
 * Create a project within a workspace.
 */
export async function createProject(
  workspaceId: string,
  body: CreateProjectBody,
  actorId?: string,
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

  const project = await prisma.project.create({
    data: {
      key: body.key,
      name: body.name,
      description: body.description,
      workspaceId,
    },
  });

  // Emit domain event (fire-and-forget)
  try {
    eventBus.emit({
      type: "project.created",
      workspaceId,
      actorId: actorId ?? "system",
      payload: { projectId: project.id, projectKey: project.key, name: project.name },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return project;
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
export async function updateProject(key: string, body: UpdateProjectBody, actorId?: string) {
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

  const updated = await prisma.project.update({
    where: { id: project.id },
    data: body,
  });

  // Emit domain event (fire-and-forget)
  try {
    eventBus.emit({
      type: "project.updated",
      workspaceId: project.workspaceId,
      actorId: actorId ?? "system",
      payload: { projectId: project.id, projectKey: project.key, fields: Object.keys(body) },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return updated;
}

/**
 * Soft delete (archive) a project by key.
 */
export async function archiveProject(key: string, actorId?: string) {
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

  const archived = await prisma.project.update({
    where: { id: project.id },
    data: { archived: true },
  });

  // Emit domain event (fire-and-forget)
  try {
    eventBus.emit({
      type: "project.archived",
      workspaceId: project.workspaceId,
      actorId: actorId ?? "system",
      payload: { projectId: project.id, projectKey: project.key },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return archived;
}
