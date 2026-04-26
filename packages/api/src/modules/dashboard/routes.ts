import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireMember } from "../../middleware/require-role.js";

const WorkspaceIdParam = z.object({ id: z.string().uuid() });

/**
 * Dashboard / inbox aggregation routes.
 *
 * Returns the rolled-up counts and recent items used by the Inbox view:
 *   - Open issue count (any non-done state)
 *   - In-progress count (in_progress state)
 *   - Awaiting review (review state)
 *   - Active agents (work sessions whose member.isAgent is true)
 *   - Issues assigned to the current user
 *   - Mentions placeholder (returned as []) until @mention parsing exists
 */
export default async function dashboardRoutes(
  fastify: FastifyInstance,
): Promise<void> {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.get(
    "/:id/dashboard",
    {
      preHandler: [requireMember("id")],
      schema: { params: WorkspaceIdParam },
    },
    async (request, _reply) => {
      const workspaceId = request.params.id;

      // Resolve the requesting user's member id within the workspace
      const member = await prisma.member.findFirst({
        where: { workspaceId, userId: request.user.userId },
        select: { id: true },
      });

      // Project ids in this workspace (for scope filters)
      const projects = await prisma.project.findMany({
        where: { workspaceId, archived: false },
        select: { id: true },
      });
      const projectIds = projects.map((p) => p.id);

      // Counts in parallel
      const [
        open,
        inProgress,
        awaitingReview,
        activeAgents,
        assignedRaw,
        proposalsRaw,
        agentSessionsRaw,
      ] = await Promise.all([
          prisma.issue.count({
            where: {
              projectId: { in: projectIds },
              state: { not: "done" },
            },
          }),
          prisma.issue.count({
            where: {
              projectId: { in: projectIds },
              state: "in_progress",
            },
          }),
          prisma.issue.count({
            where: {
              projectId: { in: projectIds },
              state: "review",
            },
          }),
          prisma.workSession.count({
            where: {
              issue: { projectId: { in: projectIds } },
              member: { isAgent: true },
            },
          }),
          member
            ? prisma.issue.findMany({
                where: {
                  projectId: { in: projectIds },
                  assigneeId: member.id,
                  state: { not: "done" },
                },
                orderBy: { updatedAt: "desc" },
                take: 8,
                select: {
                  id: true,
                  key: true,
                  title: true,
                  type: true,
                  priority: true,
                  state: true,
                  labels: true,
                  updatedAt: true,
                  assignee: { select: { id: true, username: true } },
                },
              })
            : [],
          prisma.mcpProposal.findMany({
            where: { workspaceId, status: "pending" },
            orderBy: { proposedAt: "desc" },
            take: 6,
          }),
          prisma.workSession.findMany({
            where: {
              issue: { projectId: { in: projectIds } },
              member: { isAgent: true },
            },
            include: {
              issue: { select: { key: true } },
              member: { select: { id: true, username: true, isAgent: true } },
            },
            orderBy: { startedAt: "desc" },
            take: 8,
          }),
        ]);

      return {
        counts: {
          openIssues: open,
          inProgress,
          awaitingReview,
          activeAgents,
        },
        assigned: assignedRaw,
        mentions: [] as unknown[],
        proposals: proposalsRaw,
        agents: agentSessionsRaw.map((s) => ({
          memberId: s.memberId,
          username: s.member.username,
          isAgent: s.member.isAgent,
          issueKey: s.issue.key,
          source: s.source,
          startedAt: s.startedAt.toISOString(),
        })),
      };
    },
  );
}
