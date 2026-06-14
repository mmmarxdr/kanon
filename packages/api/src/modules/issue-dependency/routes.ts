import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { requireIssueRole, requireDependencyRole } from "../../middleware/require-role.js";
import { IssueKeyParam, DependencyIdParam, CreateDependencyBody } from "./schema.js";
import * as depService from "./service.js";

export default async function issueDependencyRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  /**
   * POST /api/issues/:key/dependencies
   * Body: { targetKey: "KAN-12", type: "blocks", lagDays: 0 }
   * Means: this issue blocks targetKey using the given dep type and lag offset.
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
      const dep = await depService.createDependency(
        request.params.key,
        request.body,
        request.member!.id,
        request.via,
      );
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
      return depService.listDependencies(issue.id);
    },
  );

  /**
   * DELETE /api/issue-dependencies/:id
   * Requires at least "member" role on the source issue's project (mirrors POST).
   */
  app.delete(
    "/issue-dependencies/:id",
    {
      preHandler: [requireDependencyRole("id", "member")],
      schema: { params: DependencyIdParam },
    },
    async (request, _reply) => {
      return depService.deleteDependency(
        request.params.id,
        request.member!.id,
        request.member!.workspaceId,
        request.via,
      );
    },
  );
}
