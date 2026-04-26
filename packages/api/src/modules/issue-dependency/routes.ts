import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { requireIssueRole } from "../../middleware/require-role.js";

const IssueKeyParam = z.object({ key: z.string() });
const DependencyIdParam = z.object({ id: z.string().uuid() });
const CreateDependencyBody = z.object({
  /** Issue key that this issue should block (the target). */
  targetKey: z.string(),
  type: z.enum(["blocks"]).default("blocks"),
});

/**
 * Walk the dependency graph from `startId` and return true if `endId` is reachable.
 * Used to prevent cycles when adding `source -> target`.
 */
async function reachable(startId: string, endId: string): Promise<boolean> {
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

export default async function issueDependencyRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/issues/:key/dependencies
   * Body: { targetKey: "KAN-12", type: "blocks" }
   * Means: this issue blocks targetKey.
   */
  app.post(
    "/issues/:key/dependencies",
    {
      preHandler: [requireIssueRole("key", "member")],
      schema: {
        params: IssueKeyParam,
        body: CreateDependencyBody,
      },
    },
    async (request, reply) => {
      const source = await prisma.issue.findUnique({
        where: { key: request.params.key },
        select: { id: true, projectId: true },
      });
      if (!source) throw new AppError(404, "ISSUE_NOT_FOUND", "Issue not found");

      const target = await prisma.issue.findUnique({
        where: { key: request.body.targetKey },
        select: { id: true, projectId: true },
      });
      if (!target)
        throw new AppError(
          404,
          "TARGET_NOT_FOUND",
          `Target issue ${request.body.targetKey} not found`,
        );

      if (source.id === target.id)
        throw new AppError(
          400,
          "SELF_DEPENDENCY",
          "An issue cannot depend on itself",
        );

      // Cycle check: if `target` already reaches `source`, the new edge would close a cycle.
      if (await reachable(target.id, source.id))
        throw new AppError(
          400,
          "DEPENDENCY_CYCLE",
          "Adding this dependency would create a cycle",
        );

      const dep = await prisma.issueDependency.create({
        data: {
          sourceId: source.id,
          targetId: target.id,
          type: request.body.type,
        },
        include: {
          source: { select: { id: true, key: true, title: true, state: true } },
          target: { select: { id: true, key: true, title: true, state: true } },
        },
      });

      return reply.status(201).send(dep);
    },
  );

  /**
   * GET /api/issues/:key/dependencies
   * Returns both directions: { blocks: [...], blockedBy: [...] }
   */
  app.get(
    "/issues/:key/dependencies",
    {
      preHandler: [requireIssueRole("key", "viewer")],
      schema: { params: IssueKeyParam },
    },
    async (request, _reply) => {
      const issue = await prisma.issue.findUnique({
        where: { key: request.params.key },
        select: { id: true },
      });
      if (!issue) throw new AppError(404, "ISSUE_NOT_FOUND", "Issue not found");

      const [blocks, blockedBy] = await Promise.all([
        prisma.issueDependency.findMany({
          where: { sourceId: issue.id },
          include: {
            target: { select: { id: true, key: true, title: true, state: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        prisma.issueDependency.findMany({
          where: { targetId: issue.id },
          include: {
            source: { select: { id: true, key: true, title: true, state: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
      ]);

      return { blocks, blockedBy };
    },
  );

  /**
   * DELETE /api/issue-dependencies/:id
   */
  app.delete(
    "/issue-dependencies/:id",
    {
      schema: { params: DependencyIdParam },
    },
    async (request, _reply) => {
      const dep = await prisma.issueDependency.findUnique({
        where: { id: request.params.id },
        include: { source: { select: { projectId: true } } },
      });
      if (!dep)
        throw new AppError(404, "DEPENDENCY_NOT_FOUND", "Dependency not found");

      await prisma.issueDependency.delete({ where: { id: dep.id } });
      return { ok: true };
    },
  );
}
