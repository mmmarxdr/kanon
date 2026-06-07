import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { prisma } from "../../config/prisma.js";
import { requireMember } from "../../middleware/require-role.js";
import type { ActiveCycleKPIs } from "@kanon/bridge";
import {
  getCycle,
  computeAvgLeadDays,
  resolveActiveCycleForWorkspace,
} from "../cycle/service.js";

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
 *   - Mentions for the current member (REQ-API-DASHBOARD-003, REQ-MENTION-006)
 *   - activeCycle: ActiveCycleKPIs | null (REQ-API-DASHBOARD-002)
 *   - multipleActiveProjects: boolean (REQ-API-DASHBOARD-005)
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

      // Run all parallel queries together: existing 7 + activeCycleResult + mentionsRaw + notifications
      const [
        open,
        inProgress,
        awaitingReview,
        activeAgents,
        assignedRaw,
        proposalsRaw,
        agentSessionsRaw,
        activeCycleResult,
        mentionsRaw,
        notificationsRaw,
        unreadCount,
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
        // NEW — REQ-API-DASHBOARD-002: resolve active cycle for the workspace
        resolveActiveCycleForWorkspace(workspaceId),
        // NEW — REQ-API-DASHBOARD-003/004: mentions for current member only
        // scoped by workspaceId (multi-tenant isolation, REQ-MENTION-006)
        member
          ? prisma.mention.findMany({
              where: { workspaceId, mentionedMemberId: member.id },
              include: {
                issue: { select: { key: true, title: true } },
                mentionedByMember: { select: { username: true } },
              },
              orderBy: { createdAt: "desc" },
              take: 20,                                // cap payload (design §3.4)
            })
          : ([] as Array<never>),
        // S3 / KAN-27: latest 20 unread notifications (by [recipientId, read, createdAt] index)
        member
          ? prisma.notification.findMany({
              where: { recipientId: member.id, workspaceId, read: false },
              orderBy: { createdAt: "desc" },
              take: 20,
              select: {
                id: true,
                kind: true,
                issueId: true,
                actorId: true,
                mentionId: true,
                payload: true,
                read: true,
                via: true,
                createdAt: true,
              },
            })
          : ([] as Array<never>),
        // S3 / KAN-27: total unread count (from Notification only — single source of truth)
        member
          ? prisma.notification.count({
              where: { recipientId: member.id, workspaceId, read: false },
            })
          : 0,
      ]);

      // ── Compose ActiveCycleKPIs (only if an active cycle was found) ─────────

      let activeCycle: ActiveCycleKPIs | null = null;

      if (activeCycleResult) {
        const cycleDetail = await getCycle(activeCycleResult.cycle.id);
        const avgLeadDays = await computeAvgLeadDays(activeCycleResult.cycle.id);

        const donePct =
          cycleDetail.scope > 0
            ? Math.round((cycleDetail.completed / cycleDetail.scope) * 100)
            : 0;

        activeCycle = {
          id: activeCycleResult.cycle.id,
          name: activeCycleResult.cycle.name,
          projectName: activeCycleResult.projectName,
          startDate: activeCycleResult.cycle.startDate.toISOString(),
          endDate: activeCycleResult.cycle.endDate.toISOString(),
          completed: cycleDetail.completed,
          scope: cycleDetail.scope,
          donePct,
          // decisions-batch-4-velocity: velocity = completed count (NOT cycle.velocity stored field)
          // cycle.velocity is null while the cycle is active (only set on closeCycle).
          velocity: cycleDetail.completed,
          avgLeadDays,
          burnup: cycleDetail.burnup,
        };
      }

      // ── Map mention rows to MentionDashboardItem shape (REQ-MENTION-007) ────

      const mentions = (mentionsRaw as Array<{
        id: string;
        issueId: string;
        commentId: string | null;
        context: string;
        createdAt: Date;
        issue: { key: string; title: string };
        mentionedByMember: { username: string };
      }>).map((m) => ({
        id: m.id,
        issueKey: m.issue.key,
        issueTitle: m.issue.title,
        commentId: m.commentId,
        mentionedByUsername: m.mentionedByMember.username,
        context: m.context,
        createdAt: m.createdAt.toISOString(),
      }));

      // ── Map notification rows to NotificationDashboardItem shape (S3/KAN-27) ──

      const notifications = (notificationsRaw as Array<{
        id: string;
        kind: string;
        issueId: string | null;
        actorId: string | null;
        mentionId: string | null;
        payload: unknown;
        read: boolean;
        via: string | null;
        createdAt: Date;
      }>).map((n) => ({
        id: n.id,
        kind: n.kind,
        issueId: n.issueId,
        actorId: n.actorId,
        mentionId: n.mentionId,
        payload: n.payload as Record<string, unknown> | null,
        read: n.read,
        via: n.via,
        createdAt: n.createdAt.toISOString(),
      }));

      return {
        counts: {
          openIssues: open,
          inProgress,
          awaitingReview,
          activeAgents,
        },
        assigned: assignedRaw,
        mentions,
        proposals: proposalsRaw,
        agents: agentSessionsRaw.map((s) => ({
          memberId: s.memberId,
          username: s.member.username,
          isAgent: s.member.isAgent,
          issueKey: s.issue.key,
          source: s.source,
          startedAt: s.startedAt.toISOString(),
        })),
        activeCycle,
        multipleActiveProjects: activeCycleResult?.multipleActiveProjects ?? false,
        // S3 / KAN-27 additive fields
        notifications,
        unreadCount: unreadCount as number,
      };
    },
  );
}
