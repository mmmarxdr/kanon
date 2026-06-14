import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { AppError } from "../../shared/types.js";
import type { CreateDependencyBody } from "./schema.js";

// ── reachable ──────────────────────────────────────────────────────────────

/**
 * Walk the dependency graph from `startId` and return true if `endId` is reachable.
 * Used to prevent cycles when adding `source -> target`.
 *
 * NOTE: intentionally queries ALL dependency types (no type filter).
 * A cycle is a cycle regardless of dependency type.
 * Flagged for KAN-102 N+1 optimization.
 */
export async function reachable(startId: string, endId: string): Promise<boolean> {
  const seen = new Set<string>();
  const stack = [startId];
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === endId) return true;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const deps = await prisma.issueDependency.findMany({
      where: { sourceId: cur },
      select: { targetId: true },
    });
    for (const d of deps) stack.push(d.targetId);
  }
  return false;
}

// ── createDependency ───────────────────────────────────────────────────────

/**
 * Create a typed dependency edge from source → target.
 *
 * Guards (in order):
 *   - source not found → 404 ISSUE_NOT_FOUND
 *   - target not found → 404 TARGET_NOT_FOUND
 *   - source === target → 400 SELF_DEPENDENCY
 *   - lagDays < 0 → 422 INVALID_LAG (defense-in-depth; Zod .min(0) is first line)
 *   - target already reaches source → 400 DEPENDENCY_CYCLE
 *   - duplicate (source,target,type) → Prisma P2002 → 409 DEPENDENCY_EXISTS
 *
 * Emits: dependency.changed { action: "created" } (fire-and-forget, post-commit)
 */
export async function createDependency(
  sourceKey: string,
  body: CreateDependencyBody,
  actorId: string,
  via?: string | null,
) {
  const source = await prisma.issue.findUnique({
    where: { key: sourceKey },
    select: { id: true, project: { select: { workspaceId: true } } },
  });
  if (!source) throw new AppError(404, "ISSUE_NOT_FOUND", "Issue not found");

  const target = await prisma.issue.findUnique({
    where: { key: body.targetKey },
    select: { id: true },
  });
  if (!target)
    throw new AppError(
      404,
      "TARGET_NOT_FOUND",
      `Target issue ${body.targetKey} not found`,
    );

  if (source.id === target.id)
    throw new AppError(400, "SELF_DEPENDENCY", "An issue cannot depend on itself");

  // Defense-in-depth: also checked by Zod .min(0), and by DB CHECK constraint
  if (body.lagDays < 0)
    throw new AppError(422, "INVALID_LAG", "lagDays must be >= 0");

  // Cycle check: if `target` already reaches `source`, the new edge would close a cycle
  if (await reachable(target.id, source.id))
    throw new AppError(
      400,
      "DEPENDENCY_CYCLE",
      "Adding this dependency would create a cycle",
    );

  let dep: Awaited<ReturnType<typeof prisma.issueDependency.create>>;
  try {
    dep = await prisma.issueDependency.create({
      data: {
        sourceId: source.id,
        targetId: target.id,
        type: body.type,
        lagDays: body.lagDays,
      },
      include: {
        source: { select: { id: true, key: true, title: true, state: true } },
        target: { select: { id: true, key: true, title: true, state: true } },
      },
    });
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      throw new AppError(409, "DEPENDENCY_EXISTS", "This dependency already exists");
    }
    throw err;
  }

  // Fire-and-forget post-commit event
  try {
    eventBus.emit({
      type: "dependency.changed",
      workspaceId: source.project.workspaceId,
      actorId,
      via: via ?? null,
      payload: {
        dependencyId: dep.id,
        sourceIssueId: source.id,
        targetIssueId: target.id,
        depType: body.type,
        lagDays: body.lagDays,
        action: "created" as const,
      },
    });
  } catch {
    // Never break the mutation
  }

  return dep;
}

// ── listDependencies ───────────────────────────────────────────────────────

/**
 * List all dependencies for an issue in both directions.
 * Returns { blocks: [...], blockedBy: [...] }.
 */
export async function listDependencies(issueId: string) {
  const [blocks, blockedBy] = await Promise.all([
    prisma.issueDependency.findMany({
      where: { sourceId: issueId },
      include: {
        target: { select: { id: true, key: true, title: true, state: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.issueDependency.findMany({
      where: { targetId: issueId },
      include: {
        source: { select: { id: true, key: true, title: true, state: true } },
      },
      orderBy: { createdAt: "asc" },
    }),
  ]);

  return { blocks, blockedBy };
}

// ── deleteDependency ───────────────────────────────────────────────────────

/**
 * Delete a dependency by id.
 *
 * Guards:
 *   - dependency not found → 404 DEPENDENCY_NOT_FOUND
 *
 * Emits: dependency.changed { action: "deleted" } (fire-and-forget, post-commit)
 */
export async function deleteDependency(
  id: string,
  actorId: string,
  workspaceId: string,
  via?: string | null,
) {
  const dep = await prisma.issueDependency.findUnique({
    where: { id },
  });
  if (!dep)
    throw new AppError(404, "DEPENDENCY_NOT_FOUND", "Dependency not found");

  await prisma.issueDependency.delete({ where: { id: dep.id } });

  // Fire-and-forget post-commit event
  try {
    eventBus.emit({
      type: "dependency.changed",
      workspaceId,
      actorId,
      via: via ?? null,
      payload: {
        dependencyId: dep.id,
        sourceIssueId: dep.sourceId,
        targetIssueId: dep.targetId,
        depType: dep.type,
        lagDays: dep.lagDays,
        action: "deleted" as const,
      },
    });
  } catch {
    // Never break the mutation
  }

  return { ok: true };
}
