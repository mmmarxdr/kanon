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

  // Create project and insert owner ProjectMember row in one transaction (KAN-16 A5).
  // The creator gets role=owner so they can access their own project immediately,
  // even if their workspace role is only "member".
  const project = await prisma.$transaction(async (tx) => {
    const created = await tx.project.create({
      data: {
        key: body.key,
        name: body.name,
        description: body.description,
        workspaceId,
      },
    });

    // Resolve the workspace Member row for this user (actorId is member.id)
    // We need userId to insert into ProjectMember; look it up from Member table.
    if (actorId) {
      const wsMember = await tx.member.findUnique({
        where: { id: actorId },
        select: { userId: true },
      });
      if (wsMember) {
        await tx.projectMember.create({
          data: {
            userId: wsMember.userId,
            projectId: created.id,
            role: "owner",
          },
        });
      }
    }

    return created;
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

export type ListProjectsVisibility = {
  role: "owner" | "admin" | "pm" | "member" | "viewer";
  /** KAN-222 membership access mode */
  projectAccess: "workspace" | "assigned";
  userId: string;
  /** KAN-79: scoped tokens only see these ids; null/omit = unscoped */
  allowedProjectIds?: string[] | null;
};

/**
 * List projects in a workspace visible to the caller.
 *
 * Visibility (KAN-222) matches enforceProjectAccess:
 * - owner/admin → all active projects
 * - projectAccess=workspace → all active projects
 * - projectAccess=assigned → only ProjectMember rows
 * Then intersect with token allowedProjectIds when non-empty (KAN-79).
 */
export async function listProjects(
  workspaceId: string,
  visibility: ListProjectsVisibility,
) {
  const isFullWorkspace =
    visibility.role === "owner" ||
    visibility.role === "admin" ||
    visibility.projectAccess === "workspace";

  const allowedProjectIds = visibility.allowedProjectIds;

  return prisma.project.findMany({
    where: {
      workspaceId,
      archived: false,
      ...(isFullWorkspace
        ? allowedProjectIds
          ? { id: { in: allowedProjectIds } }
          : {}
        : {
            projectMembers: { some: { userId: visibility.userId } },
            ...(allowedProjectIds ? { id: { in: allowedProjectIds } } : {}),
          }),
    },
    orderBy: { createdAt: "asc" },
  });
}

/**
 * Get a project by gate-resolved id (KAN-16 security fix).
 * Callers downstream of requireProjectRole/requireProjectMember pass
 * request.projectId so the handler uses the SAME project the gate authorized.
 */
export async function getProject(projectId: string) {
  const project = await prisma.project.findUnique({
    where: { id: projectId },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project not found`,
    );
  }
  return project;
}

/**
 * Update a project by gate-resolved id (KAN-16 security fix).
 */
export async function updateProject(
  projectId: string,
  body: UpdateProjectBody,
  actorId?: string,
  workspaceId?: string,
  allowedProjectIds?: string[] | null,
) {
  const project = await prisma.project.findFirst({
    where: {
      id: projectId,
      ...(workspaceId ? { workspaceId } : {}),
      ...(allowedProjectIds ? { AND: { id: { in: allowedProjectIds } } } : {}),
    },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project not found`,
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
 * Soft delete (archive) a project by gate-resolved id (KAN-16 security fix).
 */
export async function archiveProject(
  projectId: string,
  actorId?: string,
  workspaceId?: string,
  allowedProjectIds?: string[] | null,
) {
  const archived = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw`SELECT "id" FROM "projects" WHERE "id" = ${projectId}::uuid FOR UPDATE`;
    const project = await transaction.project.findFirst({
      where: {
        id: projectId,
        ...(workspaceId ? { workspaceId } : {}),
        ...(allowedProjectIds ? { AND: { id: { in: allowedProjectIds } } } : {}),
      },
    });
    if (!project) {
      throw new AppError(404, "PROJECT_NOT_FOUND", "Project not found");
    }
    const binding = await transaction.integrationProjectBinding.findFirst({
      where: { projectId, releasedAt: null },
      select: { id: true },
    });
    if (binding) {
      throw new AppError(
        409,
        "PROJECT_INTEGRATION_BOUND",
        "Disconnect the project integration before archiving this project",
      );
    }
    return transaction.project.update({
      where: { id: project.id },
      data: { archived: true },
    });
  });

  // Emit domain event (fire-and-forget)
  try {
    eventBus.emit({
      type: "project.archived",
      workspaceId: archived.workspaceId,
      actorId: actorId ?? "system",
      payload: { projectId: archived.id, projectKey: archived.key },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return archived;
}
