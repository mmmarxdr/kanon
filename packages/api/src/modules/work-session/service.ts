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
const HISTORICAL_TRANSITION_SOURCE_PREFIX = "historical-transition:";

class RetrySessionMutation extends Error {}

function isHistoricalTransitionSession(session: { source: string }): boolean {
  return session.source.startsWith(HISTORICAL_TRANSITION_SOURCE_PREFIX);
}

function historicalTransitionSource(source: string): string {
  return `${HISTORICAL_TRANSITION_SOURCE_PREFIX}${source}`;
}

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
  displaced?: FinalizedWindow[];
  openedInterruptions?: Array<{
    id: string;
    incidentIssueId: string;
    interruptedIssueId: string;
    memberId: string;
  }>;
};

function isRetryableSessionMutation(err: unknown): boolean {
  if (err instanceof RetrySessionMutation) return true;
  if (!err || typeof err !== "object") return false;
  return ["P2002", "P2034"].includes((err as { code?: string }).code ?? "");
}

function isRetryableTransactionConflict(err: unknown): boolean {
  if (err instanceof RetrySessionMutation) return true;
  return (
    !!err &&
    typeof err === "object" &&
    (err as { code?: string }).code === "P2034"
  );
}

async function openOrRefreshSessionWindow(input: {
  issueId: string;
  userId: string;
  now: Date;
  createIdentity?: { memberId: string; source: string };
  sourceOverride?: string;
  via?: string | null;
  incidentIssueId?: string;
  displaceSiblings?: boolean;
}): Promise<SessionWindowResult> {
  for (let attempt = 0; attempt < SESSION_MUTATION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          let fallbackIdentity = input.createIdentity;
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

          const existingIsHistorical =
            !!existing && isHistoricalTransitionSession(existing);

          // Historical transition evidence is an event-time marker, not a live
          // renewable lease. Only an explicit start may finalize that old
          // generation and open a distinct current generation.
          if (existingIsHistorical && !input.createIdentity) {
            return { session: null, finalized: null };
          }

          if (!issueIsActive && !existing) {
            return { session: null, finalized: null };
          }

          if (
            !issueIsActive &&
            existing &&
            input.now.getTime() < existing.lastHeartbeat.getTime()
          ) {
            return { session: null, finalized: null };
          }

          const captured = existing ? captureThroughLease(existing, input.now) : null;
          const mustFinalize =
            existing && (!issueIsActive || captured!.expired || existingIsHistorical);

          const finish = async (
            session: WorkSession | null,
            finalized: FinalizedWindow | null,
          ): Promise<SessionWindowResult> => {
            if (!session || !input.incidentIssueId || !input.displaceSiblings) {
              return { session, finalized };
            }

            const displacedRows = await tx.workSession.findMany({
              where: {
                userId: input.userId,
                memberId: session.memberId,
                issueId: { not: input.issueId },
                lastHeartbeat: {
                  gt: new Date(input.now.getTime() - SESSION_TTL_MS),
                },
                startedAt: { lte: input.now },
                NOT: {
                  source: { startsWith: HISTORICAL_TRANSITION_SOURCE_PREFIX },
                },
              },
              include: { issue: { select: { key: true, type: true } } },
            });
            const displaced: FinalizedWindow[] = [];
            const openedInterruptions: NonNullable<
              SessionWindowResult["openedInterruptions"]
            > = [];

            for (const row of displacedRows) {
              if (isHistoricalTransitionSession(row)) continue;

              // A later generation belongs to later work even if a stale or
              // mocked query result violates the predicate above.
              if (row.startedAt.getTime() > input.now.getTime()) continue;

              const capturedDisplacement = captureThroughLease(row, input.now);
              const claimed = await tx.workSession.deleteMany({
                where: { id: row.id, lastHeartbeat: row.lastHeartbeat },
              });
              if (claimed.count !== 1) throw new RetrySessionMutation();

              let workLog: { id: string; durationS: number } | null = null;
              if (capturedDisplacement.durationS >= MIN_WORKLOG_DURATION_S) {
                const created = await tx.workLog.create({
                  data: {
                    startedAt: row.startedAt,
                    endedAt: capturedDisplacement.endedAt,
                    durationS: capturedDisplacement.durationS,
                    reason: "stopped",
                    via: input.via ?? normalizeVia(row.source),
                    issueId: row.issueId,
                    memberId: row.memberId,
                  },
                });
                workLog = { id: created.id, durationS: capturedDisplacement.durationS };
              }

              let closedInterruptions: ClosedInterruption[] = [];
              if (row.issue.type === "incident") {
                closedInterruptions = await tx.interruption.findMany({
                  where: {
                    incidentIssueId: row.issueId,
                    memberId: row.memberId,
                    endedAt: null,
                    startedAt: { lte: input.now },
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
                    incidentIssueId: row.issueId,
                    memberId: row.memberId,
                    endedAt: null,
                    startedAt: { lte: input.now },
                  },
                  data: { endedAt: input.now },
                });
              }

              const interruption = await tx.interruption.create({
                data: {
                  incidentIssueId: input.incidentIssueId,
                  interruptedIssueId: row.issueId,
                  memberId: row.memberId,
                  via: "session_switch",
                  startedAt: input.now,
                },
              });
              displaced.push({
                session: row,
                workLog,
                endedAt: capturedDisplacement.endedAt,
                durationS: capturedDisplacement.durationS,
                reason: "stopped",
                closedInterruptions,
              });
              openedInterruptions.push({
                id: interruption.id,
                incidentIssueId: input.incidentIssueId,
                interruptedIssueId: row.issueId,
                memberId: row.memberId,
              });
            }

            return { session, finalized, displaced, openedInterruptions };
          };

          if (!mustFinalize) {
            if (!existing && !fallbackIdentity) {
              return { session: null, finalized: null };
            }

            const identity = fallbackIdentity!;
            const heartbeatAt =
              existing && existing.lastHeartbeat.getTime() > input.now.getTime()
                ? existing.lastHeartbeat
                : input.now;
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
                lastHeartbeat: heartbeatAt,
                ...(input.sourceOverride ? { source: input.sourceOverride } : {}),
              },
            });
            return finish(session, null);
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
            return finish(null, finalized);
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

          return finish(session, finalized);
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
        payload: {
          interruptionId: row.id,
          incidentIssueId: row.incidentIssueId,
          interruptedIssueId: row.interruptedIssueId,
          memberId: row.memberId,
        },
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
      NOT: {
        source: { startsWith: HISTORICAL_TRANSITION_SOURCE_PREFIX },
      },
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
    displaceSiblings: issue.type === "incident",
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

  for (const displaced of windowResult.displaced ?? []) {
    emitFinalizedWindow({
      issueKey:
        (displaced.session as WorkSession & { issue?: { key: string } }).issue?.key ??
        issueKey,
      issueId: displaced.session.issueId,
      workspaceId: issue.project.workspaceId,
      userId,
      finalized: displaced,
    });
  }
  for (const interruption of windowResult.openedInterruptions ?? []) {
    try {
      eventBus.emit({
        type: "interruption.opened",
        workspaceId: issue.project.workspaceId,
        actorId: interruption.memberId,
        payload: {
          interruptionId: interruption.id,
          incidentIssueId: interruption.incidentIssueId,
          interruptedIssueId: interruption.interruptedIssueId,
          memberId: interruption.memberId,
        },
      });
    } catch {
      // Never let event emission break a committed lifecycle mutation.
    }
  }

  const session = windowResult.session;
  if (!session) {
    return { session: null, warnings: [] as string[], autoAssigned };
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
 * Durably stage an event-time start that arrived after the issue had already
 * advanced to a non-active state. Its source discriminator makes the durable
 * marker non-renewable and invisible to live-worker guards while still letting
 * cleanup recover its exact start evidence after process restart. The ordered
 * close event later finalizes it at the exact observed boundary.
 */
export async function stageTransitionStart(
  issueKey: string,
  userId: string,
  memberId: string,
  startedAt: Date,
  source: string = "transition-listener",
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: {
      id: true,
      type: true,
      project: { select: { workspaceId: true } },
    },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  for (let attempt = 0; attempt < SESSION_MUTATION_RETRIES; attempt++) {
    try {
      const outcome = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "issues"
            WHERE "id" = ${issue.id}::uuid
            FOR UPDATE
          `;
          const existingSessions = await tx.workSession.findMany({
            where: { issueId: issue.id },
            orderBy: [{ startedAt: "asc" }, { id: "asc" }],
          });
          const liveSessions = existingSessions.filter(
            (session) => !isHistoricalTransitionSession(session),
          );
          const activeForeignOwner = liveSessions.find(
            (session) =>
              (session.userId !== userId || session.memberId !== memberId) &&
              !captureThroughLease(session, startedAt).expired,
          );
          if (activeForeignOwner) {
            return { session: null, finalized: null };
          }

          const targetSession = existingSessions.find(
            (session) => session.userId === userId,
          );
          if (targetSession && isHistoricalTransitionSession(targetSession)) {
            return {
              session: targetSession.memberId === memberId ? targetSession : null,
              finalized: null,
            };
          }

          if (
            targetSession &&
            targetSession.memberId === memberId &&
            !captureThroughLease(targetSession, startedAt).expired
          ) {
            return { session: targetSession, finalized: null };
          }

          // Prefer an expired row for the target user because its unique key
          // must be released before the historical marker can be inserted.
          // Otherwise select the oldest expired live evidence deterministically.
          const existing =
            liveSessions.find((session) => session.userId === userId) ??
            liveSessions.find(
              (session) => captureThroughLease(session, startedAt).expired,
            );
          if (existing) {
            const captured = captureThroughLease(existing, startedAt);

            // Atomically preserve the expired worker's defensible lease before
            // replacing its row with the distinct historical marker. Cleanup
            // uses the same snapshot claim, so only one path can finalize it.
            const claimed = await tx.workSession.deleteMany({
              where: { id: existing.id, lastHeartbeat: existing.lastHeartbeat },
            });
            if (claimed.count !== 1) throw new RetrySessionMutation();

            let workLog: { id: string; durationS: number } | null = null;
            if (captured.durationS >= MIN_WORKLOG_DURATION_S) {
              const created = await tx.workLog.create({
                data: {
                  startedAt: existing.startedAt,
                  endedAt: captured.endedAt,
                  durationS: captured.durationS,
                  reason: "expired",
                  via: normalizeVia(existing.source),
                  issueId: existing.issueId,
                  memberId: existing.memberId,
                },
              });
              workLog = { id: created.id, durationS: captured.durationS };
            }

            let closedInterruptions: ClosedInterruption[] = [];
            if (issue.type === "incident") {
              closedInterruptions = await tx.interruption.findMany({
                where: {
                  incidentIssueId: issue.id,
                  memberId: existing.memberId,
                  endedAt: null,
                  startedAt: { lte: captured.endedAt },
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
                  incidentIssueId: issue.id,
                  memberId: existing.memberId,
                  endedAt: null,
                  startedAt: { lte: captured.endedAt },
                },
                data: { endedAt: captured.endedAt },
              });
            }

            const session = await tx.workSession.create({
              data: {
                userId,
                issueId: issue.id,
                memberId,
                source: historicalTransitionSource(source),
                startedAt,
                lastHeartbeat: startedAt,
              },
            });

            return {
              session,
              finalized: {
                session: existing,
                workLog,
                endedAt: captured.endedAt,
                durationS: captured.durationS,
                reason: "expired" as const,
                closedInterruptions,
              },
            };
          }

          const session = await tx.workSession.create({
            data: {
              userId,
              issueId: issue.id,
              memberId,
              source: historicalTransitionSource(source),
              startedAt,
              lastHeartbeat: startedAt,
            },
          });
          return { session, finalized: null };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (outcome.finalized) {
        emitFinalizedWindow({
          issueKey,
          issueId: issue.id,
          workspaceId: issue.project.workspaceId,
          userId: outcome.finalized.session.userId,
          finalized: outcome.finalized,
        });
      }

      return { session: outcome.session };
    } catch (err) {
      // The whole staging operation is transactional and idempotent. Retry any
      // storage failure a bounded number of times so a one-off outage cannot
      // discard the only durable copy of a delayed transition signal.
      if (attempt + 1 < SESSION_MUTATION_RETRIES) {
        continue;
      }
      if (isRetryableSessionMutation(err)) {
        throw new AppError(
          409,
          "SESSION_CONFLICT",
          "Historical work-session evidence changed concurrently",
        );
      }
      throw err;
    }
  }

  throw new AppError(409, "SESSION_CONFLICT", "Historical work-session evidence changed concurrently");
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

  let stopped:
    | {
        existing: WorkSession;
        workLog: { id: string; durationS: number } | null;
        endedAt: Date;
        durationS: number;
        reason: "expired" | "stopped";
        closedInterruptions: ClosedInterruption[];
      }
    | null = null;

  for (let attempt = 0; attempt < SESSION_MUTATION_RETRIES; attempt++) {
    try {
      stopped = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "issues"
            WHERE "id" = ${issue.id}::uuid
            FOR UPDATE
          `;
          const existing = expectedSessionId
            ? await tx.workSession.findUnique({ where: { id: expectedSessionId } })
            : await tx.workSession.findUnique({
                where: {
                  userId_issueId: { userId, issueId: issue.id },
                },
              });
          if (!existing || existing.userId !== userId || existing.issueId !== issue.id) {
            return null;
          }

          // An ordered close older than the latest activity belongs to an older
          // lifecycle. It must not truncate or delete the refreshed generation.
          if (
            expectedSessionId &&
            observedAt.getTime() < existing.lastHeartbeat.getTime()
          ) {
            return null;
          }

          const { endedAt, durationS, expired } = captureThroughLease(existing, observedAt);
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
                via: via ?? normalizeVia(existing.source),
                issueId: issue.id,
                memberId: existing.memberId,
              },
            });
            workLog = { id: created.id, durationS };
          }

          let closedInterruptions: ClosedInterruption[] = [];
          if (issue.type === "incident") {
            closedInterruptions = await tx.interruption.findMany({
              where: {
                incidentIssueId: issue.id,
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
                incidentIssueId: issue.id,
                memberId: existing.memberId,
                endedAt: null,
                startedAt: { lte: endedAt },
              },
              data: { endedAt },
            });
          }

          return {
            existing,
            workLog,
            endedAt,
            durationS,
            reason,
            closedInterruptions,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
      break;
    } catch (err) {
      if (
        !!err &&
        typeof err === "object" &&
        (err as { code?: string }).code === "P2025"
      ) {
        stopped = null;
        break;
      }
      if (
        isRetryableTransactionConflict(err) &&
        attempt + 1 < SESSION_MUTATION_RETRIES
      ) {
        continue;
      }
      if (err instanceof RetrySessionMutation) {
        throw new AppError(409, "SESSION_CONFLICT", "Work session changed concurrently");
      }
      throw err;
    }
  }

  if (!stopped) {
    return { ok: true, deleted: false, workLog: null };
  }

  const { existing, workLog, endedAt, durationS, reason, closedInterruptions } = stopped;

  if (workLog) {
    try {
      eventBus.emit({
        type: "worklog.created",
        workspaceId: issue.project.workspaceId,
        actorId: existing.memberId,
        payload: {
          workLogId: workLog.id,
          issueId: issue.id,
          workspaceId: issue.project.workspaceId,
        },
      });
    } catch {
      // Never let event emission break the committed mutation.
    }
  }

  // Emit work_session.ended event
  try {
    eventBus.emit({
      type: "work_session.ended",
      workspaceId: issue.project.workspaceId,
      actorId: existing.memberId,
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

  for (const row of closedInterruptions) {
    try {
      eventBus.emit({
        type: "interruption.closed",
        workspaceId: issue.project.workspaceId,
        actorId: row.memberId,
        payload: {
          interruptionId: row.id,
          incidentIssueId: row.incidentIssueId,
          interruptedIssueId: row.interruptedIssueId,
          memberId: row.memberId,
        },
      });
    } catch {
      // Never let event emission break the committed mutation.
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
      NOT: {
        source: { startsWith: HISTORICAL_TRANSITION_SOURCE_PREFIX },
      },
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
      NOT: {
        source: { startsWith: HISTORICAL_TRANSITION_SOURCE_PREFIX },
      },
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
