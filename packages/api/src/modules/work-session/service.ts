import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { createActivityLog } from "../activity/service.js";
import { normalizeVia } from "../../shared/via.js";
import { AppError } from "../../shared/types.js";
import { autoSubscribe } from "../issue-subscription/service.js";
import { ORDERED_STATES } from "../../shared/constants.js";

/** Sessions with lastHeartbeat older than this are considered expired. */
export const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

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
  logger?: { info?: (obj: unknown, msg: string) => void; error?: (obj: unknown, msg: string) => void },
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    // KAN-143 Fix B: state is a default scalar field on Issue — no extra select needed.
    // It is used below to auto-transition backlog/todo → in_progress.
    include: { project: { select: { workspaceId: true, key: true } } },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  // KAN-103: incident switch — starting work on an incident displaces the user's
  // other active session(s). Stop each (normal WorkLog) and open an Interruption
  // edge per displaced issue (via "session_switch"); endedAt is stamped on
  // resume (startWork on the interrupted issue) or close (stopWork on the incident).
  if (issue.type === "incident") {
    const switchCutoff = new Date(Date.now() - SESSION_TTL_MS);
    const displaced = await prisma.workSession.findMany({
      // Scope to the caller's CURRENT membership: a user with memberships in
      // several workspaces must only displace sessions in this one (review).
      where: { userId, memberId, issueId: { not: issue.id }, lastHeartbeat: { gt: switchCutoff } },
      include: { issue: { select: { key: true } } },
    });
    for (const s of displaced) {
      await stopWork(s.issue.key, userId, s.memberId, via ?? null);
      const interruption = await prisma.interruption.create({
        data: {
          incidentIssueId: issue.id,
          interruptedIssueId: s.issueId,
          memberId: s.memberId,
          via: "session_switch",
        },
      });
      // KAN-103 PR3: emit interruption.opened so forecast rebuilds for the interrupted issue.
      try {
        eventBus.emit({
          type: "interruption.opened",
          workspaceId: issue.project.workspaceId,
          actorId: s.memberId,
          payload: {
            interruptionId: interruption.id,
            incidentIssueId: issue.id,
            interruptedIssueId: s.issueId,
            memberId: s.memberId,
          },
        });
      } catch {
        // Fire-and-forget: never let event emission break the mutation
      }
    }
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

  // KAN-103: resume — (re)starting work on a previously-interrupted issue closes
  // its still-open Interruption edge(s).
  const openInterruptions = await prisma.interruption.findMany({
    where: { interruptedIssueId: issue.id, memberId, endedAt: null },
    select: { id: true, incidentIssueId: true, interruptedIssueId: true, memberId: true },
  });
  await prisma.interruption.updateMany({
    where: { interruptedIssueId: issue.id, memberId, endedAt: null },
    data: { endedAt: now },
  });
  // KAN-103 PR3: emit interruption.closed per closed row so forecast rebuilds.
  for (const row of openInterruptions) {
    try {
      eventBus.emit({
        type: "interruption.closed",
        workspaceId: issue.project.workspaceId,
        actorId: memberId,
        payload: {
          interruptionId: row.id,
          incidentIssueId: row.incidentIssueId,
          interruptedIssueId: row.interruptedIssueId,
          memberId: row.memberId,
        },
      });
    } catch {
      // Fire-and-forget: never let event emission break the mutation
    }
  }

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

    // Auto-subscribe auto-assigned member (best-effort, D9)
    void autoSubscribe(issue.id, memberId, "assignee");

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

  // KAN-143 Fix B: auto-advance issue state → in_progress when the issue is in any
  // pre-in_progress state (backlog, analysis, todo). Uses ORDERED_STATES index comparison
  // so this remains correct as the pipeline evolves — any state whose index is before
  // "in_progress" triggers the transition; in_progress/review/done are left untouched.
  //
  // FIX 4: reusing transitionIssue is intentional — it fires the full transition cascade
  // (ActivityLog, issue.transitioned event, checkAndAdvanceParent, syncRoadmapItemStatus),
  // so opening a session reflects on the board exactly like a manual state move.
  //
  // Dynamic import avoids a circular module dependency (issue/service imports work-session/service).
  // Best-effort: a transition failure (e.g. workflow guard) must never break session opening.
  if (ORDERED_STATES.indexOf(issue.state as typeof ORDERED_STATES[number]) < ORDERED_STATES.indexOf("in_progress")) {
    try {
      const { transitionIssue } = await import("../issue/service.js");
      // KAN-156 / KAN-143 circular guard: pass cause="start_work" so the
      // work-session transition listener can detect and skip this auto-advance,
      // preventing the feedback loop: start_work → in_progress → listener → start_work.
      await transitionIssue(issueKey, "in_progress", memberId, via ?? null, "start_work");
    } catch (err) {
      // Best-effort: session is already created; log for observability but do not throw.
      logger?.error?.({ err, issueKey }, "auto-transition on startWork failed");
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
            // KAN-143 Fix A: fall back to session source when request via is absent.
            // Mirrors cleanupExpired which uses normalizeVia(s.source).
            via: via ?? normalizeVia(existing.source),
            issueId: issue.id,
            memberId,
          },
        }),
        prisma.workSession.delete({ where: { id: existing.id } }),
      ]);
      workLog = { id: createdWorkLog.id, durationS };

      // KAN-102: Emit worklog.created so the forecast engine can react.
      // Fire-and-forget — never throws into the caller.
      try {
        eventBus.emit({
          type: "worklog.created",
          workspaceId: issue.project.workspaceId,
          actorId: memberId,
          payload: {
            workLogId: createdWorkLog.id,
            issueId: issue.id,
            workspaceId: issue.project.workspaceId,
          },
        });
      } catch {
        // Never let event emission break the mutation
      }
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
        // work-session-resilience (Slice A): explicit user-driven stop must
        // be distinguishable from cleanupExpired (which emits reason: "expired").
        // Downstream listeners (forecast, telemetry) key off this field.
        reason: "stopped",
      },
    });
  } catch {
    // Never let event emission break the mutation
  }

  // KAN-103: close — stopping an incident session ends its open Interruption edge(s).
  if (issue.type === "incident") {
    const openIncidentInterruptions = await prisma.interruption.findMany({
      where: { incidentIssueId: issue.id, memberId, endedAt: null },
      select: { id: true, incidentIssueId: true, interruptedIssueId: true, memberId: true },
    });
    await prisma.interruption.updateMany({
      where: { incidentIssueId: issue.id, memberId, endedAt: null },
      data: { endedAt },
    });
    // KAN-103 PR3: emit interruption.closed per closed row so forecast rebuilds.
    for (const row of openIncidentInterruptions) {
      try {
        eventBus.emit({
          type: "interruption.closed",
          workspaceId: issue.project.workspaceId,
          actorId: memberId,
          payload: {
            interruptionId: row.id,
            incidentIssueId: row.incidentIssueId,
            interruptedIssueId: row.interruptedIssueId,
            memberId: row.memberId,
          },
        });
      } catch {
        // Fire-and-forget: never let event emission break the mutation
      }
    }
  }

  return { ok: true, deleted: true, workLog };
}

/**
 * KAN-103: manually record an Interruption — an incident displacing work on
 * another issue, without requiring an active work session. via defaults to "manual".
 */
export async function recordInterruption(
  incidentIssueKey: string,
  interruptedIssueKey: string,
  memberId: string,
  via: string = "manual",
) {
  const [incident, interrupted] = await Promise.all([
    prisma.issue.findUnique({
      where: { key: incidentIssueKey },
      select: { id: true, type: true, project: { select: { workspaceId: true } } },
    }),
    prisma.issue.findUnique({
      where: { key: interruptedIssueKey },
      select: { id: true, project: { select: { workspaceId: true } } },
    }),
  ]);
  if (!incident) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${incidentIssueKey}" not found`);
  }
  if (incident.type !== "incident") {
    throw new AppError(400, "NOT_AN_INCIDENT", `Issue "${incidentIssueKey}" is not an incident`);
  }
  // Authorize the interrupted issue in the same scope as the incident: it must be
  // in the same workspace. Out-of-scope keys are reported as not-found so the
  // endpoint can't probe issue existence across workspaces (review).
  if (!interrupted || interrupted.project.workspaceId !== incident.project.workspaceId) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${interruptedIssueKey}" not found`);
  }
  const interruption = await prisma.interruption.create({
    data: {
      incidentIssueId: incident.id,
      interruptedIssueId: interrupted.id,
      memberId,
      via,
    },
  });
  // KAN-103 PR3: emit interruption.opened so forecast rebuilds for the interrupted issue.
  try {
    eventBus.emit({
      type: "interruption.opened",
      workspaceId: incident.project.workspaceId,
      actorId: memberId,
      payload: {
        interruptionId: interruption.id,
        incidentIssueId: incident.id,
        interruptedIssueId: interrupted.id,
        memberId,
      },
    });
  } catch {
    // Fire-and-forget: never let event emission break the mutation
  }
  return interruption;
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
          type: true,
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
      // KAN-103 PR3: close open Interruption edges BEFORE the session delete so
      // a mid-cleanup crash cannot strand interruptions open forever.
      // Closing first is safe: if the session delete later fails, the interruption
      // is already correctly closed with endedAt = lastHeartbeat (independent of worklog).
      if (s.issue.type === "incident") {
        const openInterruptions = await prisma.interruption.findMany({
          where: { incidentIssueId: s.issueId, memberId: s.memberId, endedAt: null },
          select: { id: true, incidentIssueId: true, interruptedIssueId: true, memberId: true },
        });
        await prisma.interruption.updateMany({
          where: { incidentIssueId: s.issueId, memberId: s.memberId, endedAt: null },
          data: { endedAt },
        });
        for (const row of openInterruptions) {
          try {
            eventBus.emit({
              type: "interruption.closed",
              workspaceId: s.issue.project.workspaceId,
              actorId: s.memberId,
              payload: {
                interruptionId: row.id,
                incidentIssueId: row.incidentIssueId,
                interruptedIssueId: row.interruptedIssueId,
                memberId: row.memberId,
              },
            });
          } catch {
            // Fire-and-forget: never let event emission break cleanup
          }
        }
      }

      if (durationS >= MIN_WORKLOG_DURATION_S) {
        const [createdWorkLog] = await prisma.$transaction([
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

        // KAN-102: Emit worklog.created so the forecast engine can react.
        // Fire-and-forget — never throws into the caller.
        try {
          eventBus.emit({
            type: "worklog.created",
            workspaceId: s.issue.project.workspaceId,
            actorId: s.memberId,
            payload: {
              workLogId: createdWorkLog.id,
              issueId: s.issueId,
              workspaceId: s.issue.project.workspaceId,
            },
          });
        } catch {
          // Never let event emission break cleanup
        }
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
