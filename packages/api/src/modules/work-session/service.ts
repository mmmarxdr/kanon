import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { createActivityLog } from "../activity/service.js";
import { AppError } from "../../shared/types.js";

/** Sessions with lastHeartbeat older than this are considered expired. */
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start a work session on an issue.
 * Upserts on (userId, issueId) — if the user already has a session, it refreshes it.
 * Returns warnings if other users are actively working on the same issue.
 */
export async function startWork(
  issueKey: string,
  memberId: string,
  userId: string,
  source: string = "mcp",
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    include: { project: { select: { workspaceId: true, key: true } } },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const now = new Date();

  // Upsert: create or refresh existing session
  const session = await prisma.workSession.upsert({
    where: {
      userId_issueId: { userId, issueId: issue.id },
    },
    create: {
      userId,
      issueId: issue.id,
      memberId,
      source,
      startedAt: now,
      lastHeartbeat: now,
    },
    update: {
      lastHeartbeat: now,
      source,
      startedAt: now,
    },
  });

  // Check for other active workers on this issue
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);
  const otherSessions = await prisma.workSession.findMany({
    where: {
      issueId: issue.id,
      userId: { not: userId },
      lastHeartbeat: { gt: cutoff },
    },
    include: {
      member: { select: { username: true, isAgent: true } },
    },
  });

  const warnings: string[] = [];
  if (otherSessions.length > 0) {
    const names = otherSessions.map((s) => s.member.username).join(", ");
    warnings.push(
      `Other active workers on ${issueKey}: ${names}`,
    );
  }

  // Auto-assign: if issue has no assignee, assign it to this member
  let autoAssigned = false;
  if (!issue.assigneeId) {
    await prisma.issue.update({
      where: { id: issue.id },
      data: { assignee: { connect: { id: memberId } } },
    });
    autoAssigned = true;

    await createActivityLog({
      issueId: issue.id,
      memberId,
      action: "assigned",
      details: { from: null, to: memberId, source: "auto" },
    });

    // Emit issue.assigned event
    try {
      eventBus.emit({
        type: "issue.assigned",
        workspaceId: issue.project.workspaceId,
        actorId: memberId,
        payload: {
          issueKey,
          issueId: issue.id,
          from: null,
          to: memberId,
          autoAssigned: true,
        },
      });
    } catch {
      // Never let event emission break the mutation
    }
  }

  // Emit work_session.started event
  try {
    eventBus.emit({
      type: "work_session.started",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      payload: {
        issueKey,
        issueId: issue.id,
        memberId,
        userId,
        source,
        autoAssigned,
      },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return { session, warnings, autoAssigned };
}

/**
 * Send a heartbeat for an active work session.
 * Returns the updated session or null if not found.
 */
export async function heartbeat(issueKey: string, userId: string) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const existing = await prisma.workSession.findUnique({
    where: {
      userId_issueId: { userId, issueId: issue.id },
    },
  });

  if (!existing) {
    return null;
  }

  return prisma.workSession.update({
    where: { id: existing.id },
    data: { lastHeartbeat: new Date() },
  });
}

/**
 * Stop a work session on an issue.
 */
export async function stopWork(issueKey: string, userId: string, memberId: string) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    include: { project: { select: { workspaceId: true } } },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const existing = await prisma.workSession.findUnique({
    where: {
      userId_issueId: { userId, issueId: issue.id },
    },
  });

  if (!existing) {
    return { ok: true, deleted: false };
  }

  await prisma.workSession.delete({ where: { id: existing.id } });

  // Emit work_session.ended event
  try {
    eventBus.emit({
      type: "work_session.ended",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      payload: {
        issueKey,
        issueId: issue.id,
        memberId,
        userId,
      },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return { ok: true, deleted: true };
}

/**
 * Get all active workers for an issue (sessions with heartbeat within TTL).
 */
export async function getActiveWorkers(issueId: string) {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);

  const sessions = await prisma.workSession.findMany({
    where: {
      issueId,
      lastHeartbeat: { gt: cutoff },
    },
    include: {
      member: { select: { username: true, isAgent: true } },
    },
    orderBy: { startedAt: "asc" },
  });

  return sessions.map((s) => ({
    userId: s.userId,
    memberId: s.memberId,
    username: s.member.username,
    isAgent: s.member.isAgent,
    startedAt: s.startedAt.toISOString(),
    source: s.source,
  }));
}

/**
 * Get active workers for multiple issues at once (batch query to avoid N+1).
 */
export async function getActiveWorkersForIssues(issueIds: string[]) {
  if (issueIds.length === 0) return new Map<string, ReturnType<typeof mapSession>[]>();

  const cutoff = new Date(Date.now() - SESSION_TTL_MS);

  const sessions = await prisma.workSession.findMany({
    where: {
      issueId: { in: issueIds },
      lastHeartbeat: { gt: cutoff },
    },
    include: {
      member: { select: { username: true, isAgent: true } },
    },
    orderBy: { startedAt: "asc" },
  });

  const grouped = new Map<string, ReturnType<typeof mapSession>[]>();
  for (const s of sessions) {
    const list = grouped.get(s.issueId) ?? [];
    list.push(mapSession(s));
    grouped.set(s.issueId, list);
  }

  return grouped;
}

function mapSession(s: {
  userId: string;
  memberId: string;
  member: { username: string; isAgent: boolean };
  startedAt: Date;
  source: string;
}) {
  return {
    userId: s.userId,
    memberId: s.memberId,
    username: s.member.username,
    isAgent: s.member.isAgent,
    startedAt: s.startedAt.toISOString(),
    source: s.source,
  };
}

/**
 * Clean up expired work sessions.
 * Deletes all sessions where lastHeartbeat < now() - TTL,
 * and emits work_session.ended for each.
 */
export async function cleanupExpired(
  logger?: { info: (obj: unknown, msg: string) => void },
) {
  const cutoff = new Date(Date.now() - SESSION_TTL_MS);

  const expired = await prisma.workSession.findMany({
    where: { lastHeartbeat: { lt: cutoff } },
    include: {
      issue: {
        select: {
          key: true,
          project: { select: { workspaceId: true } },
        },
      },
    },
  });

  if (expired.length === 0) return 0;

  // Delete all expired sessions
  await prisma.workSession.deleteMany({
    where: { id: { in: expired.map((s) => s.id) } },
  });

  // Emit events for each expired session
  for (const s of expired) {
    try {
      eventBus.emit({
        type: "work_session.ended",
        workspaceId: s.issue.project.workspaceId,
        actorId: s.memberId,
        payload: {
          issueKey: s.issue.key,
          issueId: s.issueId,
          memberId: s.memberId,
          userId: s.userId,
          reason: "expired",
        },
      });
    } catch {
      // Never let event emission break cleanup
    }
  }

  if (logger) {
    logger.info(
      { count: expired.length },
      "Cleaned up expired work sessions",
    );
  }

  return expired.length;
}
