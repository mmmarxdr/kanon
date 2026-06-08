import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { createActivityLog } from "../activity/service.js";
import { normalizeVia } from "../../shared/via.js";
import { AppError } from "../../shared/types.js";

/** Sessions with lastHeartbeat older than this are considered expired. */
const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Minimum session duration to be recorded as a WorkLog (seconds). */
const MIN_WORKLOG_DURATION_S = 60;

/**
 * Start a work session on an issue.
 * Upserts on (userId, issueId) — if the user already has a session, it refreshes it.
 * Returns warnings if other users are actively working on the same issue.
 *
 * @param via - Normalized X-Kanon-Client value (request.via from viaPlugin).
 *   When provided, it is stored as the session source so that cleanupExpired
 *   can later set WorkLog.via correctly via normalizeVia(s.source).
 *   Falls back to `source` when via is absent.
 */
export async function startWork(
  issueKey: string,
  memberId: string,
  userId: string,
  source: string = "mcp",
  via?: string | null,
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    include: { project: { select: { workspaceId: true, key: true } } },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const now = new Date();
  // Prefer via as session source — it carries the normalized client identity
  // (e.g. 'claude-code') so that cleanupExpired can carry it to WorkLog.via.
  // Fall back to the body-provided source when via is absent.
  const sessionSource = via ?? source;

  // Upsert: create or refresh existing session
  const session = await prisma.workSession.upsert({
    where: {
      userId_issueId: { userId, issueId: issue.id },
    },
    create: {
      userId,
      issueId: issue.id,
      memberId,
      source: sessionSource,
      startedAt: now,
      lastHeartbeat: now,
    },
    update: {
      lastHeartbeat: now,
      source: sessionSource,
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
          issueTitle: issue.title,
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
 *
 * S2 / KAN-26: for sessions ≥ 60s, persists a WorkLog atomically in a
 * $transaction before deleting the session.  Sub-minute sessions are
 * discarded (no WorkLog written).
 *
 * @param via - Normalized X-Kanon-Client header value (from request.via).
 */
export async function stopWork(
  issueKey: string,
  userId: string,
  memberId: string,
  via: string | null = null,
) {
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
    return { ok: true, deleted: false, workLog: null };
  }

  const endedAt = new Date();
  const durationS = Math.floor(
    (endedAt.getTime() - existing.startedAt.getTime()) / 1000,
  );

  let workLog: { id: string; durationS: number } | null = null;

  if (durationS >= MIN_WORKLOG_DURATION_S) {
    // Atomic: create WorkLog + delete session in one transaction.
    // P2025 guard: cleanupExpired may have deleted the session between the
    // findUnique above and this transaction.  Treat it as "already stopped"
    // and return the same not-found shape rather than propagating a 500.
    try {
      const [createdWorkLog] = await prisma.$transaction([
        prisma.workLog.create({
          data: {
            startedAt: existing.startedAt,
            endedAt,
            durationS,
            reason: "stopped",
            via,
            issueId: issue.id,
            memberId,
          },
        }),
        prisma.workSession.delete({ where: { id: existing.id } }),
      ]);
      workLog = { id: createdWorkLog.id, durationS };
    } catch (err: unknown) {
      if (
        typeof err === "object" &&
        err !== null &&
        (err as { code?: string }).code === "P2025"
      ) {
        // Session was already deleted concurrently (race with cleanupExpired).
        // Return the not-found shape — no WorkLog created, no error surfaced.
        return { ok: true, deleted: false, workLog: null };
      }
      throw err;
    }
  } else {
    // Sub-minute session: discard, no WorkLog
    await prisma.workSession.delete({ where: { id: existing.id } });
  }

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
        workLogId: workLog?.id ?? null,
        durationS,
      },
    });
  } catch {
    // Never let event emission break the mutation
  }

  return { ok: true, deleted: true, workLog };
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
 *
 * S2 / KAN-26: replaces bulk deleteMany with a per-session loop.
 * Each session is processed in its own try/catch so one failure does not
 * abort the others (D4). Sessions ≥ 60s get a WorkLog written atomically
 * in a $transaction; sub-minute sessions are plain-deleted.
 *
 * Duration formula: lastHeartbeat − startedAt (D4: deliberate deviation
 * from proposal's "now − startedAt" which over-counts dead time).
 */
export async function cleanupExpired(
  logger?: { info: (obj: unknown, msg: string) => void; error?: (obj: unknown, msg: string) => void },
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

  let successCount = 0;

  for (const s of expired) {
    const endedAt = s.lastHeartbeat; // D4: use lastHeartbeat, not now
    const durationS = Math.floor(
      (endedAt.getTime() - s.startedAt.getTime()) / 1000,
    );
    const via = normalizeVia(s.source);

    try {
      if (durationS >= MIN_WORKLOG_DURATION_S) {
        await prisma.$transaction([
          prisma.workLog.create({
            data: {
              startedAt: s.startedAt,
              endedAt,
              durationS,
              reason: "expired",
              via,
              issueId: s.issueId,
              memberId: s.memberId,
            },
          }),
          prisma.workSession.delete({ where: { id: s.id } }),
        ]);
      } else {
        await prisma.workSession.delete({ where: { id: s.id } });
      }

      // Emit work_session.ended (existing behaviour, unchanged)
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

      successCount++;
    } catch (err) {
      // P2025 race (concurrent stopWork already deleted) or real failure —
      // log and continue to next session
      logger?.error?.(
        { err, sessionId: s.id, issueKey: s.issue.key },
        "Failed to cleanup expired work session",
      );
    }
  }

  if (logger) {
    logger.info(
      { count: successCount },
      "Cleaned up expired work sessions",
    );
  }

  return successCount;
}
