import type { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { createIssue } from "../issue/service.js";
import type {
  CreateRoadmapItemBody,
  UpdateRoadmapItemBody,
  RoadmapFilterQuery,
  PromoteBody,
  AddDependencyBody,
} from "./schema.js";

/**
 * Prisma include for dependency relations on RoadmapItem.
 */
const dependencyInclude = {
  dependencySource: {
    select: {
      id: true,
      type: true,
      targetId: true,
      target: { select: { id: true, title: true, status: true } },
    },
  },
  dependencyTarget: {
    select: {
      id: true,
      type: true,
      sourceId: true,
      source: { select: { id: true, title: true, status: true } },
    },
  },
} as const;

/**
 * Map Prisma dependency relations to a cleaner response shape.
 */
function mapDependencies<
  T extends {
    dependencySource: Array<{ id: string; type: string; targetId: string; target: { id: string; title: string; status: string } }>;
    dependencyTarget: Array<{ id: string; type: string; sourceId: string; source: { id: string; title: string; status: string } }>;
  },
>(item: T) {
  const { dependencySource, dependencyTarget, ...rest } = item;
  return {
    ...rest,
    blocks: dependencySource,
    dependsOn: dependencyTarget,
  };
}

/**
 * List roadmap items for a project with optional filters.
 */
export async function listRoadmapItems(
  projectKey: string,
  filters: RoadmapFilterQuery,
) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  const where: Prisma.RoadmapItemWhereInput = {
    projectId: project.id,
  };

  if (filters.horizon) where.horizon = filters.horizon;
  if (filters.status) where.status = filters.status;
  if (filters.label) where.labels = { has: filters.label };

  const items = await prisma.roadmapItem.findMany({
    where,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "desc" }],
    include: dependencyInclude,
  });
  return items.map(mapDependencies);
}

/**
 * Get a single roadmap item by ID.
 */
export async function getRoadmapItem(projectKey: string, itemId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  const item = await prisma.roadmapItem.findFirst({
    where: { id: itemId, projectId: project.id },
    include: {
      issues: {
        select: { id: true, key: true, title: true, state: true },
      },
      ...dependencyInclude,
    },
  });
  if (!item) {
    throw new AppError(
      404,
      "ROADMAP_ITEM_NOT_FOUND",
      `Roadmap item "${itemId}" not found`,
    );
  }
  return mapDependencies(item);
}

/**
 * Create a new roadmap item.
 */
export async function createRoadmapItem(
  projectKey: string,
  body: CreateRoadmapItemBody,
) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  return prisma.roadmapItem.create({
    data: {
      title: body.title,
      description: body.description,
      horizon: body.horizon,
      status: body.status,
      effort: body.effort,
      impact: body.impact,
      labels: body.labels,
      sortOrder: body.sortOrder,
      targetDate: body.targetDate,
      projectId: project.id,
    },
  });
}

/**
 * Update a roadmap item by ID.
 */
export async function updateRoadmapItem(
  projectKey: string,
  itemId: string,
  body: UpdateRoadmapItemBody,
  memberId?: string,
) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  const item = await prisma.roadmapItem.findFirst({
    where: { id: itemId, projectId: project.id },
  });
  if (!item) {
    throw new AppError(
      404,
      "ROADMAP_ITEM_NOT_FOUND",
      `Roadmap item "${itemId}" not found`,
    );
  }

  const data: Prisma.RoadmapItemUpdateInput = {};
  if (body.title !== undefined) data.title = body.title;
  if (body.description !== undefined) data.description = body.description;
  if (body.horizon !== undefined) data.horizon = body.horizon;
  if (body.status !== undefined) data.status = body.status;
  if (body.effort !== undefined) data.effort = body.effort;
  if (body.impact !== undefined) data.impact = body.impact;
  if (body.labels !== undefined) data.labels = body.labels;
  if (body.sortOrder !== undefined) data.sortOrder = body.sortOrder;
  if (body.targetDate !== undefined) data.targetDate = body.targetDate;

  const updated = await prisma.roadmapItem.update({
    where: { id: itemId },
    data,
  });

  // Auto-promote: when horizon changes to "now" and no issues are linked yet
  if (
    body.horizon === "now" &&
    item.horizon !== "now" &&
    memberId
  ) {
    const linkedCount = await prisma.issue.count({
      where: { roadmapItemId: itemId },
    });

    if (linkedCount === 0) {
      await promoteToIssue(projectKey, itemId, {}, memberId);
      await prisma.roadmapItem.update({
        where: { id: itemId },
        data: { status: "in_progress" },
      });
    }
  }

  return updated;
}

/**
 * Delete a roadmap item by ID.
 * Linked issues have their roadmapItemId set to null (onDelete: SetNull in schema).
 */
export async function deleteRoadmapItem(projectKey: string, itemId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  const item = await prisma.roadmapItem.findFirst({
    where: { id: itemId, projectId: project.id },
  });
  if (!item) {
    throw new AppError(
      404,
      "ROADMAP_ITEM_NOT_FOUND",
      `Roadmap item "${itemId}" not found`,
    );
  }

  await prisma.roadmapItem.delete({
    where: { id: itemId },
  });
}

/**
 * Promote a roadmap item to an issue.
 * Creates an issue using existing issue creation logic, links it back via roadmapItemId,
 * and sets promoted=true on the roadmap item.
 */
export async function promoteToIssue(
  projectKey: string,
  itemId: string,
  body: PromoteBody,
  memberId: string,
) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  const item = await prisma.roadmapItem.findFirst({
    where: { id: itemId, projectId: project.id },
  });
  if (!item) {
    throw new AppError(
      404,
      "ROADMAP_ITEM_NOT_FOUND",
      `Roadmap item "${itemId}" not found`,
    );
  }

  // Create the issue using existing issue service
  const issue = await createIssue(
    projectKey,
    {
      title: body.title ?? item.title,
      description: item.description ?? undefined,
      type: body.type ?? "task",
      priority: body.priority ?? "medium",
      labels: body.labels ?? item.labels,
      groupKey: body.groupKey,
    },
    memberId,
  );

  // Link the issue back to the roadmap item and mark as promoted
  await prisma.$transaction([
    prisma.issue.update({
      where: { id: issue.id },
      data: { roadmapItemId: itemId },
    }),
    prisma.roadmapItem.update({
      where: { id: itemId },
      data: { promoted: true },
    }),
  ]);

  // Return the created issue with updated roadmapItemId
  return prisma.issue.findUnique({
    where: { id: issue.id },
    include: {
      assignee: {
        select: { id: true, username: true, email: true },
      },
    },
  });
}

// ─── Dependencies ───────────────────────────────────────────────────────────

/**
 * Detect if adding a dependency from sourceId → targetId would create a cycle.
 * Uses DFS: starting from targetId, follows existing "blocks" edges (dependencyTarget).
 * If sourceId is reachable from targetId, adding source→target creates a cycle.
 */
async function detectCycle(
  sourceId: string,
  targetId: string,
): Promise<boolean> {
  if (sourceId === targetId) return true;

  const visited = new Set<string>();
  const stack = [targetId];

  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === sourceId) return true;
    if (visited.has(current)) continue;
    visited.add(current);

    const deps = await prisma.roadmapDependency.findMany({
      where: { sourceId: current },
      select: { targetId: true },
    });
    for (const dep of deps) {
      stack.push(dep.targetId);
    }
  }
  return false;
}

/**
 * Add a dependency: sourceId (the item) blocks targetId.
 */
export async function addDependency(
  projectKey: string,
  sourceId: string,
  body: AddDependencyBody,
) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  // Validate both items exist in the same project
  const [source, target] = await Promise.all([
    prisma.roadmapItem.findFirst({
      where: { id: sourceId, projectId: project.id },
    }),
    prisma.roadmapItem.findFirst({
      where: { id: body.targetId, projectId: project.id },
    }),
  ]);

  if (!source) {
    throw new AppError(
      404,
      "ROADMAP_ITEM_NOT_FOUND",
      `Source roadmap item "${sourceId}" not found`,
    );
  }
  if (!target) {
    throw new AppError(
      404,
      "ROADMAP_ITEM_NOT_FOUND",
      `Target roadmap item "${body.targetId}" not found`,
    );
  }

  // Self-reference check
  if (sourceId === body.targetId) {
    throw new AppError(
      400,
      "SELF_DEPENDENCY",
      "An item cannot depend on itself",
    );
  }

  // Cycle detection
  const wouldCycle = await detectCycle(sourceId, body.targetId);
  if (wouldCycle) {
    throw new AppError(
      400,
      "DEPENDENCY_CYCLE",
      "Adding this dependency would create a cycle",
    );
  }

  // Check uniqueness (Prisma will also enforce via @@unique, but nicer error)
  const existing = await prisma.roadmapDependency.findUnique({
    where: { sourceId_targetId: { sourceId, targetId: body.targetId } },
  });
  if (existing) {
    throw new AppError(
      409,
      "DEPENDENCY_EXISTS",
      "This dependency already exists",
    );
  }

  return prisma.roadmapDependency.create({
    data: {
      sourceId,
      targetId: body.targetId,
      type: body.type,
    },
    include: {
      target: { select: { id: true, title: true, status: true } },
      source: { select: { id: true, title: true, status: true } },
    },
  });
}

/**
 * Remove a dependency by ID.
 */
export async function removeDependency(
  projectKey: string,
  itemId: string,
  depId: string,
) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  const dep = await prisma.roadmapDependency.findUnique({
    where: { id: depId },
  });
  if (!dep) {
    throw new AppError(
      404,
      "DEPENDENCY_NOT_FOUND",
      `Dependency "${depId}" not found`,
    );
  }

  // Verify the dependency belongs to this item (either as source or target)
  if (dep.sourceId !== itemId && dep.targetId !== itemId) {
    throw new AppError(
      404,
      "DEPENDENCY_NOT_FOUND",
      `Dependency "${depId}" does not belong to item "${itemId}"`,
    );
  }

  await prisma.roadmapDependency.delete({
    where: { id: depId },
  });
}

/**
 * Get all dependencies for a roadmap item (both blocks and blockedBy).
 */
export async function getDependencies(projectKey: string, itemId: string) {
  const project = await prisma.project.findFirst({
    where: { key: projectKey },
  });
  if (!project) {
    throw new AppError(
      404,
      "PROJECT_NOT_FOUND",
      `Project "${projectKey}" not found`,
    );
  }

  const item = await prisma.roadmapItem.findFirst({
    where: { id: itemId, projectId: project.id },
  });
  if (!item) {
    throw new AppError(
      404,
      "ROADMAP_ITEM_NOT_FOUND",
      `Roadmap item "${itemId}" not found`,
    );
  }

  const [blocks, blockedBy] = await Promise.all([
    prisma.roadmapDependency.findMany({
      where: { sourceId: itemId },
      include: {
        target: { select: { id: true, title: true, status: true } },
      },
    }),
    prisma.roadmapDependency.findMany({
      where: { targetId: itemId },
      include: {
        source: { select: { id: true, title: true, status: true } },
      },
    }),
  ]);

  return { blocks, blockedBy };
}
