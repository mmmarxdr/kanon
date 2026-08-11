import { prisma } from "../../config/prisma.js";
import { Prisma, type WorkSession } from "@prisma/client";
import { eventBus } from "../../services/event-bus/index.js";
import { normalizeVia } from "../../shared/via.js";
import { AppError } from "../../shared/types.js";
import { ORDERED_STATES } from "../../shared/constants.js";

/** Sessions with lastHeartbeat older than this are considered expired. */
export const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Minimum representable positive session duration (whole seconds). */
const MIN_WORKLOG_DURATION_S = 1;
const SESSION_MUTATION_RETRIES = 3;

class RetrySessionMutation extends Error {}

function captureThroughLease(
  session: { startedAt: Date; lastHeartbeat: Date },
  observedAt: Date,
) {
  const leaseEndsAt = new Date(session.lastHeartbeat.getTime() + SESSION_TTL_MS);
  const expired = leaseEndsAt.getTime() <= observedAt.getTime();
  const endedAt = expired ? leaseEndsAt : observedAt;
  const durationS = Math.max(
    0,
    Math.floor((endedAt.getTime() - session.startedAt.getTime()) / 1000),
  );

  return { endedAt, durationS, expired };
}

type ClosedInterruption = {
  id: string;
  incidentIssueId: string;
  interruptedIssueId: string;
  memberId: string;
};

type FinalizedWindow = {
  session: WorkSession;
  workLog: { id: string; durationS: number } | null;
  endedAt: Date;
  durationS: number;
  reason: "expired" | "stopped";
  closedInterruptions: ClosedInterruption[];
};

type SessionWindowResult = {
  session: WorkSession | null;
  finalized: FinalizedWindow | null;
};

function isRetryableSessionMutation(err: unknown): boolean {
  if (err instanceof RetrySessionMutation) return true;
  if (!err || typeof err !== "object") return false;
  return ["P2002", "P2034"].includes((err as { code?: string }).code ?? "");
}

async function openOrRefreshSessionWindow(input: {
  issueId: string;
  userId: string;
  now: Date;
  createIdentity?: { memberId: string; source: string };
  sourceOverride?: string;
  via?: string | null;
  incidentIssueId?: string;
}): Promise<SessionWindowResult> {
  let fallbackIdentity = input.createIdentity;

  for (let attempt = 0; attempt < SESSION_MUTATION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          // Serialize the lifecycle decision with issue-state transitions. A
          // transition updates this same row, so either heartbeat owns the lock
          // first (and the later close observes its result) or heartbeat waits
          // and observes the closed state. A plain Serializable read is not
          // sufficient because the close listener runs after the state commit.
          const lockedIssues = await tx.$queryRaw<Array<{ state: string }>>`
            SELECT "state"::text AS "state"
            FROM "issues"
            WHERE "id" = ${input.issueId}::uuid
            FOR UPDATE
          `;
          const issueIsActive =
            lockedIssues[0]?.state === "analysis" ||
            lockedIssues[0]?.state === "in_progress";

          const existing = await tx.workSession.findUnique({
            where: {
              userId_issueId: { userId: input.userId, issueId: input.issueId },
            },
          });

          if (existing) {
            fallbackIdentity ??= {
              memberId: existing.memberId,
              source: existing.source,
            };
          }

          if (!issueIsActive && !existing) {
            return { session: null, finalized: null };
          }

          const captured = existing ? captureThroughLease(existing, input.now) : null;
          const mustFinalize = existing && (!issueIsActive || captured!.expired);

          if (!mustFinalize) {
            if (!existing && !fallbackIdentity) {
              return { session: null, finalized: null };
            }

            const identity = fallbackIdentity!;
            const session = await tx.workSession.upsert({
              where: {
                userId_issueId: { userId: input.userId, issueId: input.issueId },
              },
              create: {
                userId: input.userId,
                issueId: input.issueId,
                memberId: identity.memberId,
                source: input.sourceOverride ?? identity.source,
                startedAt: input.now,
                lastHeartbeat: input.now,
              },
              update: {
                lastHeartbeat: input.now,
                ...(input.sourceOverride ? { source: input.sourceOverride } : {}),
              },
            });
            return { session, finalized: null };
          }

          const { endedAt, durationS, expired } = captured!;
          const reason = expired ? "expired" : "stopped";
          const claimed = await tx.workSession.deleteMany({
            where: { id: existing.id, lastHeartbeat: existing.lastHeartbeat },
          });
          if (claimed.count !== 1) throw new RetrySessionMutation();

          let workLog: { id: string; durationS: number } | null = null;
          if (durationS >= MIN_WORKLOG_DURATION_S) {
            const created = await tx.workLog.create({
              data: {
                startedAt: existing.startedAt,
                endedAt,
                durationS,
                reason,
                via: input.via ?? normalizeVia(existing.source),
                issueId: existing.issueId,
                memberId: existing.memberId,
              },
            });
            workLog = { id: created.id, durationS };
          }

          let closedInterruptions: ClosedInterruption[] = [];
          if (input.incidentIssueId) {
            closedInterruptions = await tx.interruption.findMany({
              where: {
                incidentIssueId: input.incidentIssueId,
                memberId: existing.memberId,
                endedAt: null,
                startedAt: { lte: endedAt },
              },
              select: {
                id: true,
                incidentIssueId: true,
                interruptedIssueId: true,
                memberId: true,
              },
            });
            await tx.interruption.updateMany({
              where: {
                incidentIssueId: input.incidentIssueId,
                memberId: existing.memberId,
                endedAt: null,
                startedAt: { lte: endedAt },
              },
              data: { endedAt },
            });
          }

          const finalized: FinalizedWindow = {
            session: existing,
            workLog,
            endedAt,
            durationS,
            reason,
            closedInterruptions,
          };

          if (!issueIsActive) {
            return { session: null, finalized };
          }

          const identity = input.createIdentity ?? fallbackIdentity!;
          const session = await tx.workSession.create({
            data: {
              userId: input.userId,
              issueId: input.issueId,
              memberId: identity.memberId,
              source: input.sourceOverride ?? identity.source,
              startedAt: input.now,
              lastHeartbeat: input.now,
            },
          });

          return {
            session,
            finalized,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (isRetryableSessionMutation(err) && attempt + 1 < SESSION_MUTATION_RETRIES) {
        continue;
      }
      if (err instanceof RetrySessionMutation) {
        throw new AppError(409, "SESSION_CONFLICT", "Work session changed concurrently");
      }
      throw err;
    }
  }

  throw new AppError(409, "SESSION_CONFLICT", "Work session changed concurrently");
}

function emitFinalizedWindow(input: {
  issueKey: string;
  issueId: string;
  workspaceId: string;
  userId: string;
  finalized: FinalizedWindow;
}) {
  const { finalized } = input;
  if (finalized.workLog) {
    try {
      eventBus.emit({
        type: "worklog.created",
        workspaceId: input.workspaceId,
        actorId: finalized.session.memberId,
        payload: {
          workLogId: finalized.workLog.id,
          issueId: input.issueId,
          workspaceId: input.workspaceId,
        },
      });
    } catch {
      // Never let event emission break a committed lifecycle mutation.
    }
  }

  try {
    eventBus.emit({
      type: "work_session.ended",
      workspaceId: input.workspaceId,
      actorId: finalized.session.memberId,
      payload: {
        issueKey: input.issueKey,
        issueId: input.issueId,
        memberId: finalized.session.memberId,
        userId: input.userId,
        workLogId: finalized.workLog?.id ?? null,
        durationS: finalized.durationS,
        reason: finalized.reason,
      },
    });
  } catch {
    // Never let event emission break a committed lifecycle mutation.
  }

  for (const row of finalized.closedInterruptions) {
    try {
      eventBus.emit({
        type: "interruption.closed",
        workspaceId: input.workspaceId,
        actorId: row.memberId,
        payload: row,
      });
    } catch {
      // Never let event emission break a committed lifecycle mutation.
    }
  }
}

/**
 * Start a work session on an issue.
 * Upserts on (userId, issueId) — if the user already has a session, it refreshes it.
 *
 * KAN-160 (ADR-0011): single active worker per ticket. If another member holds an
 * open (non-expired) session on the issue, this throws 409 ISSUE_BUSY — unless
 * opts.onConflict==="skip" (the transition listener), in which case it no-ops and
 * returns { session: null, warnings: [], autoAssigned: false }. The legacy
 * `warnings` field is retained in the return shape but is now always empty.
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
  opts?: {
    autoAssign?: boolean;
    onConflict?: "throw" | "skip";
    transitionObservedAt?: Date;
  },
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

  // KAN-160 (ADR-0011): single active worker per ticket. If ANOTHER member holds
  // an open (non-expired) session on this issue, refuse — the forecast engine sums
  // person-hours with no parallelism model, so two concurrent workers would inflate
  // loggedH. This runs BEFORE any mutation so a refusal leaves no side effects.
  //
  // Scope is by userId (the human), NOT memberId: "another worker" means a different
  // person, so the caller's own session never matches and re-starting just refreshes.
  // Using memberId would be wrong — one human with two workspace memberships could
  // then double-start. issueId is globally unique so cross-workspace can't collide.
  //
  // ponytail: check-then-act — "open" is TTL-based (lastHeartbeat), so it can't be a
  // DB unique constraint; a sub-millisecond two-user race could slip past. Accepted
  // (ADR-0011); revisit with an Issue.currentWorker FK if real contention shows up.
  const conflictCutoff = new Date(Date.now() - SESSION_TTL_MS);
  const otherWorker = await prisma.workSession.findFirst({
    where: {
      issueId: issue.id,
      userId: { not: userId },
      lastHeartbeat: { gt: conflictCutoff },
    },
    select: { member: { select: { username: true } } },
  });
  if (otherWorker) {
    // Transition-driven opens (PM dragging a card) must never crash on contention —
    // they silently decline to open a second session.
    if (opts?.onConflict === "skip") {
      return { session: null, warnings: [] as string[], autoAssigned: false };
    }
    // WorkSession.member is a required relation (onDelete: Cascade) — a session
    // can't outlive its member, so member.username is always present here.
    throw new AppError(
      409,
      "ISSUE_BUSY",
      `${otherWorker.member.username} is already working on ${issueKey}. They must stop (or their session must expire) before you can start — this is a hand-off.`,
    );
  }

  // Preserve start_work's established assign-before-transition ordering. The
  // authoritative session decision still happens only after the state move.
  let autoAssigned = false;
  if (!issue.assigneeId && opts?.autoAssign !== false) {
    const { updateIssue } = await import("../issue/service.js");
    await updateIssue(issueKey, { assigneeId: memberId }, memberId, via ?? null);
    autoAssigned = true;
  }

  // KAN-143 Fix B: explicit start_work first advances any pre-active state to
  // in_progress. The session transaction then locks and re-checks the issue row,
  // so it cannot open a window if this transition failed or a later close won.
  if (ORDERED_STATES.indexOf(issue.state as typeof ORDERED_STATES[number]) < ORDERED_STATES.indexOf("in_progress")) {
    try {
      const { transitionIssue } = await import("../issue/service.js");
      await transitionIssue(issueKey, "in_progress", memberId, via ?? null, "start_work");
    } catch (err) {
      logger?.error?.({ err, issueKey }, "auto-transition on startWork failed");
    }
  }

  // Ordered transition events carry the authoritative start signal time. This
  // option is internal-only; HTTP/MCP callers continue to use server time.
  const now = opts?.transitionObservedAt ?? new Date();
  // Prefer via as session source — it carries the normalized client identity
  // (e.g. 'claude-code') so that cleanupExpired can carry it to WorkLog.via.
  // Fall back to the body-provided source when via is absent.
  const sessionSource = via ?? source;

  const windowResult = await openOrRefreshSessionWindow({
    issueId: issue.id,
    userId,
    now,
    createIdentity: { memberId, source: sessionSource },
    sourceOverride: sessionSource,
    via,
    incidentIssueId: issue.type === "incident" ? issue.id : undefined,
  });

  if (windowResult.finalized) {
    emitFinalizedWindow({
      issueKey,
      issueId: issue.id,
      workspaceId: issue.project.workspaceId,
      userId,
      finalized: windowResult.finalized,
    });
  }

  const session = windowResult.session;
  if (!session) {
    return { session: null, warnings: [] as string[], autoAssigned };
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
      const { endedAt, durationS } = captureThroughLease(s, new Date());

      // KAN-163: stop the displaced session (WorkLog + session delete) AND open
      // its Interruption edge in ONE transaction. Previously stopWork + create
      // ran as two unguarded awaits — a create failure left the session stopped
      // with no edge (forecast silently drops the displaced time).
      // Atomicity is PER displaced session (the AC): a failure on one session
      // rolls THAT session back but does not undo siblings already processed
      // earlier in the loop — each is an independent stop, so partial progress
      // across multiple displaced sessions is acceptable.
      let txResult: { workLogId: string | null; interruptionId: string };
      try {
        txResult = await prisma.$transaction(async (tx) => {
          let workLogId: string | null = null;
          if (durationS >= MIN_WORKLOG_DURATION_S) {
            const wl = await tx.workLog.create({
              data: {
                startedAt: s.startedAt,
                endedAt,
                durationS,
                reason: "stopped",
                // Mirror stopWork: fall back to session source when via is absent.
                via: via ?? normalizeVia(s.source),
                issueId: s.issueId,
                memberId: s.memberId,
              },
            });
            workLogId = wl.id;
          }
          await tx.workSession.delete({ where: { id: s.id } });
          const interruption = await tx.interruption.create({
            data: {
              incidentIssueId: issue.id,
              interruptedIssueId: s.issueId,
              memberId: s.memberId,
              via: "session_switch",
            },
          });
          return { workLogId, interruptionId: interruption.id };
        });
      } catch (err: unknown) {
        // P2025: the displaced session was deleted between the findMany above and
        // this delete — a race with cleanupExpired or a concurrent incident start.
        // Mirror stopWork's guard: treat it as already-stopped and move on rather
        // than failing the whole incident switch.
        if (
          typeof err === "object" &&
          err !== null &&
          (err as { code?: string }).code === "P2025"
        ) {
          continue;
        }
        throw err;
      }
      const { workLogId, interruptionId } = txResult;

      // Post-commit, fire-and-forget events (mirror stopWork + KAN-103 PR3).
      if (workLogId) {
        try {
          eventBus.emit({
            type: "worklog.created",
            workspaceId: issue.project.workspaceId,
            actorId: s.memberId,
            payload: { workLogId, issueId: s.issueId, workspaceId: issue.project.workspaceId },
          });
        } catch {
          // Never let event emission break the mutation
        }
      }
      try {
        eventBus.emit({
          type: "work_session.ended",
          workspaceId: issue.project.workspaceId,
          actorId: s.memberId,
          payload: {
            issueKey: s.issue.key,
            issueId: s.issueId,
            memberId: s.memberId,
            userId,
            workLogId: workLogId ?? null,
            durationS,
            reason: "stopped",
          },
        });
      } catch {
        // Never let event emission break the mutation
      }
      // KAN-103 PR3: emit interruption.opened so forecast rebuilds for the interrupted issue.
      try {
        eventBus.emit({
          type: "interruption.opened",
          workspaceId: issue.project.workspaceId,
          actorId: s.memberId,
          payload: {
            interruptionId,
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

  // KAN-160: the single-worker guard above already refused if another member was
  // active, so by here the caller is the only worker — warnings is always empty.
  // Kept in the response for backward compatibility with the MCP client shape.
  const warnings: string[] = [];

  const { upsertPlan } = await import("../schedule/service.js");
  await upsertPlan(issueKey, { startDate: now.toISOString() }, memberId, via ?? null, {
    startDateIfMissing: true,
  });

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
    select: {
      id: true,
      type: true,
      state: true,
      project: { select: { workspaceId: true } },
    },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const result = await openOrRefreshSessionWindow({
    issueId: issue.id,
    userId,
    now: new Date(),
    incidentIssueId: issue.type === "incident" ? issue.id : undefined,
  });

  if (result.finalized) {
    emitFinalizedWindow({
      issueKey,
      issueId: issue.id,
      workspaceId: issue.project.workspaceId,
      userId,
      finalized: result.finalized,
    });
    if (result.session) {
      try {
        eventBus.emit({
          type: "work_session.started",
          workspaceId: issue.project.workspaceId,
          actorId: result.session.memberId,
          payload: {
            issueKey,
            issueId: issue.id,
            memberId: result.session.memberId,
            userId,
            source: result.session.source,
            autoAssigned: false,
          },
        });
      } catch {
        // Never let event emission break a committed lifecycle mutation.
      }
    }
  }

  return result.session;
}

/**
 * Persist an interval proven by an ordered pair of transition events.
 *
 * This is intentionally separate from startWork: it records historical event
 * time without creating a live WorkSession or weakening the current-state gate
 * used by heartbeats and manual starts.
 */
export async function captureTransitionInterval(
  issueKey: string,
  userId: string,
  memberId: string,
  startedAt: Date,
  observedAt: Date,
  source: string = "transition-listener",
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true, project: { select: { workspaceId: true } } },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const { endedAt, durationS, expired } = captureThroughLease(
    { startedAt, lastHeartbeat: startedAt },
    observedAt,
  );
  if (durationS < MIN_WORKLOG_DURATION_S) {
    return { workLog: null };
  }

  const reason = expired ? "expired" : "stopped";
  const created = await prisma.workLog.create({
    data: {
      startedAt,
      endedAt,
      durationS,
      reason,
      via: normalizeVia(source),
      issueId: issue.id,
      memberId,
    },
  });
  const workLog = { id: created.id, durationS };

  try {
    eventBus.emit({
      type: "worklog.created",
      workspaceId: issue.project.workspaceId,
      actorId: memberId,
      payload: {
        workLogId: created.id,
        issueId: issue.id,
        workspaceId: issue.project.workspaceId,
      },
    });
  } catch {
    // Never let event emission break a committed historical interval.
  }

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
        workLogId: created.id,
        durationS,
        reason,
      },
    });
  } catch {
    // Never let event emission break a committed historical interval.
  }

  return { workLog };
}

/**
 * Stop a work session on an issue.
 *
 * Every positive whole-second duration is persisted atomically with session
 * deletion. The observed stop is capped by the activity lease.
 *
 * @param via - Normalized X-Kanon-Client header value (from request.via).
 * @param observedAt - Timestamp of the observed close signal. Async listeners
 *   pass the domain-event timestamp so processing delay cannot inflate capture.
 * @param expectedSessionId - Optional generation guard used by async lifecycle
 *   consumers so an older close cannot delete a replacement window.
 */
export async function stopWork(
  issueKey: string,
  userId: string,
  memberId: string,
  via: string | null = null,
  observedAt: Date = new Date(),
  expectedSessionId?: string,
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    include: { project: { select: { workspaceId: true } } },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const existing = expectedSessionId
    ? await prisma.workSession.findUnique({ where: { id: expectedSessionId } })
    : await prisma.workSession.findUnique({
        where: {
          userId_issueId: { userId, issueId: issue.id },
        },
      });

  if (!existing || existing.userId !== userId || existing.issueId !== issue.id) {
    return { ok: true, deleted: false, workLog: null };
  }

  const { endedAt, durationS, expired } = captureThroughLease(existing, observedAt);
  const reason = expired ? "expired" : "stopped";

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
            reason,
            // KAN-143 Fix A: fall back to session source when request via is absent.
            // Mirrors cleanupExpired which uses normalizeVia(s.source).
            via: via ?? normalizeVia(existing.source),
            issueId: issue.id,
            memberId: existing.memberId,
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
          actorId: existing.memberId,
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
    // Less than one whole second is not representable by WorkLog.durationS.
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
        memberId: existing.memberId,
        userId,
        workLogId: workLog?.id ?? null,
        durationS,
        // work-session-resilience (Slice A): explicit user-driven stop must
        // be distinguishable from cleanupExpired (which emits reason: "expired").
        // Downstream listeners (forecast, telemetry) key off this field.
        reason,
      },
    });
  } catch {
    // Never let event emission break the mutation
  }

  // KAN-103: close — stopping an incident session ends its open Interruption edge(s).
  if (issue.type === "incident") {
    const openIncidentInterruptions = await prisma.interruption.findMany({
      where: { incidentIssueId: issue.id, memberId: existing.memberId, endedAt: null },
      select: { id: true, incidentIssueId: true, interruptedIssueId: true, memberId: true },
    });
    await prisma.interruption.updateMany({
      where: { incidentIssueId: issue.id, memberId: existing.memberId, endedAt: null },
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

/** Close every currently active session before an issue completion gate is evaluated. */
export async function stopActiveWorkSessions(issueKey: string) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const sessions = await prisma.workSession.findMany({
    where: { issueId: issue.id },
    select: { id: true, userId: true, memberId: true },
  });
  const stopped = [];
  for (const session of sessions) {
    stopped.push(
      await stopWork(
        issueKey,
        session.userId,
        session.memberId,
        null,
        new Date(),
        session.id,
      ),
    );
  }
  return stopped;
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
 * abort the others (D4). Every positive whole-second lease gets a WorkLog
 * written atomically in a $transaction.
 */
export async function cleanupExpired(
  logger?: { info: (obj: unknown, msg: string) => void; error?: (obj: unknown, msg: string) => void },
) {
  const observedAt = new Date();
  const cutoff = new Date(observedAt.getTime() - SESSION_TTL_MS);

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
    const { endedAt, durationS } = captureThroughLease(s, observedAt);
    const via = normalizeVia(s.source);

    try {
      // Claim the exact stale snapshot before writing any side effects. A heartbeat
      // that renewed the row after findMany changes lastHeartbeat, so the claim is
      // a no-op and cleanup must leave that active generation untouched.
      const outcome = await prisma.$transaction(
        async (tx) => {
          const claimed = await tx.workSession.deleteMany({
            where: { id: s.id, lastHeartbeat: s.lastHeartbeat },
          });
          if (claimed.count !== 1) {
            return {
              claimed: false as const,
              workLog: null,
              closedInterruptions: [] as ClosedInterruption[],
            };
          }

          let workLog: { id: string } | null = null;
          if (durationS >= MIN_WORKLOG_DURATION_S) {
            const created = await tx.workLog.create({
              data: {
                startedAt: s.startedAt,
                endedAt,
                durationS,
                reason: "expired",
                via,
                issueId: s.issueId,
                memberId: s.memberId,
              },
            });
            workLog = { id: created.id };
          }

          let closedInterruptions: ClosedInterruption[] = [];
          if (s.issue.type === "incident") {
            closedInterruptions = await tx.interruption.findMany({
              where: {
                incidentIssueId: s.issueId,
                memberId: s.memberId,
                endedAt: null,
                startedAt: { lte: endedAt },
              },
              select: {
                id: true,
                incidentIssueId: true,
                interruptedIssueId: true,
                memberId: true,
              },
            });
            await tx.interruption.updateMany({
              where: {
                incidentIssueId: s.issueId,
                memberId: s.memberId,
                endedAt: null,
                startedAt: { lte: endedAt },
              },
              data: { endedAt },
            });
          }

          return { claimed: true as const, workLog, closedInterruptions };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!outcome.claimed) continue;

      if (outcome.workLog) {
        // KAN-102: Emit worklog.created so the forecast engine can react.
        // Fire-and-forget — never throws into the caller.
        try {
          eventBus.emit({
            type: "worklog.created",
            workspaceId: s.issue.project.workspaceId,
            actorId: s.memberId,
            payload: {
              workLogId: outcome.workLog.id,
              issueId: s.issueId,
              workspaceId: s.issue.project.workspaceId,
            },
          });
        } catch {
          // Never let event emission break cleanup
        }
      }

      for (const row of outcome.closedInterruptions) {
        try {
          eventBus.emit({
            type: "interruption.closed",
            workspaceId: s.issue.project.workspaceId,
            actorId: row.memberId,
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
