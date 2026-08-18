import { prisma } from "../../config/prisma.js";
import { Prisma, type IssueState, type WorkSession } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { eventBus } from "../../services/event-bus/index.js";
import { normalizeVia } from "../../shared/via.js";
import { AppError } from "../../shared/types.js";
import { ORDERED_STATES } from "../../shared/constants.js";
import {
  captureIssueMutationTx,
  lockIssueCaptureBindingTx,
  resolveIssueCaptureContext,
} from "../integrations/issue-tx.js";
import type { StartWorkIssueMutationEffects } from "../issue/service.js";

/** Sessions with lastHeartbeat older than this are considered expired. */
export const SESSION_TTL_MS = 5 * 60 * 1000; // 5 minutes

/** Minimum representable positive session duration (whole seconds). */
const MIN_WORKLOG_DURATION_S = 1;
const SESSION_MUTATION_RETRIES = 3;
const HISTORICAL_TRANSITION_SOURCE_PREFIX = "historical-transition:";
const LIFECYCLE_EFFECT_CLAIM_TTL_MS = 30_000;
export const TRANSITION_EFFECT_RECOVERY_INTERVAL_MS = 30_000;

class RetrySessionMutation extends Error {}

function isHistoricalTransitionSession(session: { source: string }): boolean {
  return session.source.startsWith(HISTORICAL_TRANSITION_SOURCE_PREFIX);
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
  transitionLifecycleId: string | null;
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

async function findForeignOwnerAtBoundary(
  tx: Prisma.TransactionClient,
  issueId: string,
  userId: string,
  boundary: Date,
  intervalEnd?: Date,
): Promise<{ username: string } | null> {
  const startsBefore = intervalEnd
    ? Prisma.sql`< ${intervalEnd}`
    : Prisma.sql`<= ${boundary}`;
  const owners = await tx.$queryRaw<Array<{ username: string }>>`
    SELECT candidate."username"
    FROM (
      SELECT member."username"
      FROM "work_sessions" session
      JOIN "members" member ON member."id" = session."member_id"
      WHERE session."issue_id" = ${issueId}::uuid
        AND session."user_id" <> ${userId}::uuid
        AND session."started_at" ${startsBefore}
        AND session."last_heartbeat" + (${SESSION_TTL_MS} * INTERVAL '1 millisecond') > ${boundary}
        AND session."source" NOT LIKE ${`${HISTORICAL_TRANSITION_SOURCE_PREFIX}%`}

      UNION ALL

      SELECT member."username"
      FROM "work_logs" work_log
      JOIN "members" member ON member."id" = work_log."member_id"
      WHERE work_log."issue_id" = ${issueId}::uuid
        AND member."user_id" <> ${userId}::uuid
        AND work_log."started_at" ${startsBefore}
        AND work_log."ended_at" > ${boundary}
    ) candidate
    LIMIT 1
  `;

  return owners[0]?.username ? owners[0] : null;
}

async function openOrRefreshSessionWindow(input: {
  issueId: string;
  userId: string;
  now: Date;
  authoritativeStartedAt?: Date;
  createIdentity?: { memberId: string; source: string };
  sourceOverride?: string;
  via?: string | null;
  incidentIssueId?: string;
  displaceSiblings?: boolean;
  issueKey?: string;
  onConflict?: "throw" | "skip";
  ownershipIntervalEnd?: Date;
  requiredOpenLifecycleIdentity?: string;
  lockedIssueState?: IssueState;
  ownershipAlreadyChecked?: boolean;
  transactionClient?: Prisma.TransactionClient;
  heartbeatAdoption?: boolean;
}): Promise<SessionWindowResult> {
  let heartbeatObservedGeneration = false;
  const mutate = async (
    tx: Prisma.TransactionClient,
  ): Promise<SessionWindowResult> => {
          let fallbackIdentity = input.createIdentity;
          // Serialize the lifecycle decision with issue-state transitions. A
          // transition updates this same row, so either heartbeat owns the lock
          // first (and the later close observes its result) or heartbeat waits
          // and observes the closed state. A plain Serializable read is not
          // sufficient because the close listener runs after the state commit.
          const lockedIssues = input.lockedIssueState
            ? [{ state: input.lockedIssueState }]
            : await tx.$queryRaw<Array<{ state: string }>>`
                SELECT "state"::text AS "state"
                FROM "issues"
                WHERE "id" = ${input.issueId}::uuid
                FOR UPDATE
              `;
          const issueIsActive =
            lockedIssues[0]?.state === "analysis" ||
            lockedIssues[0]?.state === "in_progress";

          let transitionLifecycleId: string | undefined;
          if (input.requiredOpenLifecycleIdentity) {
            const lifecycle = await tx.workTransitionLifecycle.findUnique({
              where: { startIdentity: input.requiredOpenLifecycleIdentity },
              select: { id: true, closeIdentity: true, workLogId: true },
            });
            // The start signal is persisted before startWork. If its durable
            // row has already paired with a close (possibly in another
            // process), opening a WorkSession would resurrect a completed
            // generation.
            if (!lifecycle || lifecycle.closeIdentity || lifecycle.workLogId) {
              return { session: null, finalized: null };
            }
            transitionLifecycleId = lifecycle.id;
          }

          if (
            issueIsActive &&
            input.heartbeatAdoption &&
            input.createIdentity
          ) {
            const openInterruption = await tx.interruption.findFirst({
              where: {
                interruptedIssueId: input.issueId,
                memberId: input.createIdentity.memberId,
                endedAt: null,
              },
              select: { id: true },
            });
            if (openInterruption) {
              throw new AppError(
                409,
                "CAPTURE_PAUSED",
                `Capture for ${input.issueKey ?? "this issue"} is paused by an open interruption`,
              );
            }
          }

          if (input.createIdentity && !input.ownershipAlreadyChecked) {
            // Once the issue row is locked, this timestamp closes the effective
            // unbounded interval: earlier owners are visible, while later starts
            // must wait and will observe this session before they can commit.
            const ownershipIntervalEnd = input.ownershipIntervalEnd
              ? new Date()
              : undefined;
            const foreignOwner = await findForeignOwnerAtBoundary(
              tx,
              input.issueId,
              input.userId,
              input.now,
              ownershipIntervalEnd,
            );
            if (foreignOwner) {
              if (input.onConflict === "skip") {
                return { session: null, finalized: null };
              }
              throw new AppError(
                409,
                "ISSUE_BUSY",
                `${foreignOwner.username} is already working on ${input.issueKey ?? "this issue"}. They must stop (or their session must expire) before you can start — this is a hand-off.`,
              );
            }
          }

          const existing = await tx.workSession.findUnique({
            where: {
              userId_issueId: { userId: input.userId, issueId: input.issueId },
            },
          });

          if (input.heartbeatAdoption) {
            if (existing) {
              heartbeatObservedGeneration = true;
            } else if (heartbeatObservedGeneration) {
              // A retry that loses the observed generation to an explicit stop
              // must not reinterpret that disappearance as missing-session adoption.
              fallbackIdentity = undefined;
            }
          }

          if (existing) {
            fallbackIdentity ??= {
              memberId: existing.memberId,
              source: existing.source,
            };
          }

          // A delayed transition start has no durable generation identity of its
          // own. If another same-user generation already began later, refreshing
          // or backdating it would bridge an unknown close/rework boundary.
          if (
            existing &&
            input.authoritativeStartedAt &&
            existing.startedAt.getTime() >
              input.authoritativeStartedAt.getTime()
          ) {
            return { session: null, finalized: null };
          }

          const existingIsHistorical =
            !!existing && isHistoricalTransitionSession(existing);

          // Historical transition evidence is an event-time marker, not a live
          // renewable lease. Only an explicit start may finalize that old
          // generation and open a distinct current generation.
          if (
            existingIsHistorical &&
            (!input.createIdentity || input.heartbeatAdoption)
          ) {
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
              const displacedTransitionLifecycleId = row.transitionLifecycleId;
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
                if (displacedTransitionLifecycleId) {
                  const linked = await tx.workTransitionLifecycle.updateMany({
                    where: {
                      id: displacedTransitionLifecycleId,
                      workLogId: null,
                    },
                    data: { workLogId: created.id },
                  });
                  if (linked.count !== 1) throw new RetrySessionMutation();
                }
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
                transitionLifecycleId: displacedTransitionLifecycleId,
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
            const startedAt =
              existing &&
              input.authoritativeStartedAt &&
              existing.startedAt.getTime() > input.authoritativeStartedAt.getTime()
                ? input.authoritativeStartedAt
                : undefined;
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
                ...(transitionLifecycleId ? { transitionLifecycleId } : {}),
              },
              update: {
                ...(startedAt ? { startedAt } : {}),
                lastHeartbeat: heartbeatAt,
                ...(input.sourceOverride ? { source: input.sourceOverride } : {}),
                ...(transitionLifecycleId ? { transitionLifecycleId } : {}),
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
          const finalizedTransitionLifecycleId = existing.transitionLifecycleId;
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
            if (finalizedTransitionLifecycleId) {
              const linked = await tx.workTransitionLifecycle.updateMany({
                where: { id: finalizedTransitionLifecycleId, workLogId: null },
                data: { workLogId: created.id },
              });
              if (linked.count !== 1) throw new RetrySessionMutation();
            }
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
            transitionLifecycleId: finalizedTransitionLifecycleId,
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
              ...(transitionLifecycleId ? { transitionLifecycleId } : {}),
            },
          });

          return finish(session, finalized);
  };

  if (input.transactionClient) {
    return mutate(input.transactionClient);
  }

  for (let attempt = 0; attempt < SESSION_MUTATION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        mutate,
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

async function emitFinalizedWindow(input: {
  issueKey: string;
  issueId: string;
  workspaceId: string;
  userId: string;
  finalized: FinalizedWindow;
}) {
  const { finalized } = input;
  if (finalized.transitionLifecycleId && finalized.workLog) {
    await publishTransitionLifecycleEffects(finalized.transitionLifecycleId);
    return;
  }
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
    transitionLifecycleIdentity?: string;
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
  const processingAt = new Date();
  const conflictBoundary = opts?.transitionObservedAt ?? processingAt;
  const ownershipIntervalEnd =
    opts?.transitionObservedAt &&
    processingAt.getTime() > conflictBoundary.getTime()
      ? processingAt
      : undefined;
  const conflictCutoff = new Date(conflictBoundary.getTime() - SESSION_TTL_MS);
  const otherWorker = await prisma.workSession.findFirst({
    where: {
      issueId: issue.id,
      userId: { not: userId },
      startedAt: ownershipIntervalEnd
        ? { lt: ownershipIntervalEnd }
        : { lte: conflictBoundary },
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

  // Ordered transition events carry the authoritative start signal time. This
  // option is internal-only; HTTP/MCP callers continue to use server time.
  const now = opts?.transitionObservedAt ?? new Date();
  // Prefer via as session source — it carries the normalized client identity
  // (e.g. 'claude-code') so that cleanupExpired can carry it to WorkLog.via.
  // Fall back to the body-provided source when via is absent.
  const sessionSource = via ?? source;

  // Resolve outbound-capture metadata before entering the interactive
  // transaction. Every database mutation below uses its transaction client.
  const captureContext = await resolveIssueCaptureContext(
    issue.projectId,
    memberId,
  );
  let autoAssigned = false;
  let reserved:
    | {
        windowResult: SessionWindowResult;
        autoAssigned: boolean;
        issueEffects: StartWorkIssueMutationEffects | null;
      }
    | undefined;
  for (let attempt = 0; attempt < SESSION_MUTATION_RETRIES; attempt++) {
    try {
      reserved = await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw<Array<{ locked: number }>>`
            SELECT 1::integer AS "locked"
            FROM pg_advisory_xact_lock(
              hashtextextended(${issue.id}::text, 243)
            )
          `;
          if (captureContext) {
            await lockIssueCaptureBindingTx(tx, captureContext.bindingId);
          }
          const lockedIssues = await tx.$queryRaw<
            Array<{ state: IssueState; assigneeId: string | null }>
          >`
            SELECT "state"::text AS "state", "assignee_id" AS "assigneeId"
            FROM "issues"
            WHERE "id" = ${issue.id}::uuid
            FOR UPDATE
          `;
          const lockedIssue = lockedIssues[0];
          if (!lockedIssue) {
            throw new AppError(
              404,
              "ISSUE_NOT_FOUND",
              `Issue "${issueKey}" not found`,
            );
          }

          const lockedOwner = await findForeignOwnerAtBoundary(
            tx,
            issue.id,
            userId,
            conflictBoundary,
            ownershipIntervalEnd,
          );
          if (lockedOwner) {
            if (opts?.onConflict === "skip") {
              return {
                windowResult: {
                  session: null,
                  finalized: null,
                } satisfies SessionWindowResult,
                autoAssigned: false,
                issueEffects: null,
              };
            }
            throw new AppError(
              409,
              "ISSUE_BUSY",
              `${lockedOwner.username} is already working on ${issueKey}. They must stop (or their session must expire) before you can start — this is a hand-off.`,
            );
          }

          const currentStateIndex = ORDERED_STATES.indexOf(lockedIssue.state);
          const inProgressIndex = ORDERED_STATES.indexOf("in_progress");
          const transitioned =
            currentStateIndex >= 0 && currentStateIndex < inProgressIndex;
          const issueCanOpen =
            transitioned ||
            lockedIssue.state === "analysis" ||
            lockedIssue.state === "in_progress";
          const assigned =
            issueCanOpen &&
            !lockedIssue.assigneeId &&
            opts?.autoAssign !== false;
          let effectiveState = lockedIssue.state;
          let issueEffects: StartWorkIssueMutationEffects | null = null;

          if (assigned || transitioned) {
            const updated = await tx.issue.update({
              where: { id: issue.id },
              data: {
                ...(assigned ? { assigneeId: memberId } : {}),
                ...(transitioned
                  ? { state: "in_progress" as const, completedAt: null }
                  : {}),
              },
            });
            effectiveState = updated.state;

            if (assigned) {
              await tx.activityLog.create({
                data: {
                  issueId: issue.id,
                  memberId,
                  action: "assigned",
                  details: {
                    from: lockedIssue.assigneeId,
                    to: memberId,
                    source: "api",
                  },
                  via: via ?? null,
                },
              });
              await tx.activityLog.create({
                data: {
                  issueId: issue.id,
                  memberId,
                  action: "edited",
                  details: { fields: ["assigneeId"] },
                  via: via ?? null,
                },
              });
            }
            if (transitioned) {
              await tx.activityLog.create({
                data: {
                  issueId: issue.id,
                  memberId,
                  action: "state_changed",
                  details: {
                    from: lockedIssue.state,
                    to: "in_progress",
                    regression: false,
                  },
                  via: via ?? null,
                },
              });
            }
            if (captureContext) {
              await captureIssueMutationTx(tx, {
                result: updated,
                capture: {
                  ...captureContext,
                  operation: "update",
                  correlationId: randomUUID(),
                  fields: {
                    ...(assigned ? { assigneeId: updated.assigneeId } : {}),
                    ...(transitioned ? { state: updated.state } : {}),
                  },
                },
              });
            }
            issueEffects = {
              issue: {
                id: issue.id,
                key: issue.key,
                title: issue.title,
                project: issue.project,
              },
              updated,
              memberId,
              userId,
              via: via ?? null,
              previousAssigneeId: lockedIssue.assigneeId,
              fromState: lockedIssue.state,
              autoAssigned: assigned,
              transitioned,
            };
          }

          const windowResult = await openOrRefreshSessionWindow({
            issueId: issue.id,
            userId,
            now,
            authoritativeStartedAt: opts?.transitionObservedAt,
            createIdentity: { memberId, source: sessionSource },
            sourceOverride: sessionSource,
            via,
            incidentIssueId: issue.type === "incident" ? issue.id : undefined,
            displaceSiblings: issue.type === "incident",
            issueKey,
            onConflict: opts?.onConflict,
            ownershipIntervalEnd,
            requiredOpenLifecycleIdentity: opts?.transitionLifecycleIdentity,
            lockedIssueState: effectiveState,
            ownershipAlreadyChecked: true,
            transactionClient: tx,
          });
          return {
            windowResult,
            autoAssigned: assigned,
            issueEffects,
          };
        },
        {
          timeout: 15_000,
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        },
      );
      break;
    } catch (err) {
      if (
        isRetryableSessionMutation(err) &&
        attempt + 1 < SESSION_MUTATION_RETRIES
      ) {
        continue;
      }
      if (isRetryableSessionMutation(err)) {
        throw new AppError(
          409,
          "SESSION_CONFLICT",
          "Work session changed concurrently",
        );
      }
      logger?.error?.(
        { err, issueKey },
        "atomic startWork transaction failed",
      );
      throw err;
    }
  }
  if (!reserved) {
    throw new AppError(
      409,
      "SESSION_CONFLICT",
      "Work session changed concurrently",
    );
  }
  const { windowResult } = reserved;
  autoAssigned = reserved.autoAssigned;

  if (reserved.issueEffects) {
    try {
      const { publishStartWorkIssueMutationEffects } = await import(
        "../issue/service.js"
      );
      await publishStartWorkIssueMutationEffects(reserved.issueEffects);
    } catch (err) {
      logger?.error?.(
        { err, issueKey },
        "startWork issue mutation projections failed",
      );
    }
  }

  if (windowResult.finalized) {
    await emitFinalizedWindow({
      issueKey,
      issueId: issue.id,
      workspaceId: issue.project.workspaceId,
      userId,
      finalized: windowResult.finalized,
    });
  }

  for (const displaced of windowResult.displaced ?? []) {
    await emitFinalizedWindow({
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
    return { session: null, warnings: [] as string[], autoAssigned: false };
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
export async function heartbeat(
  issueKey: string,
  memberIdOrUserId: string,
  userId?: string,
  via: string | null = null,
) {
  // The legacy two-argument form remains refresh-only. Missing-session adoption
  // requires the authenticated member and user identities forwarded by the route.
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

  const mayAdopt = issue.type !== "incident";
  const authenticatedIdentity = userId
    ? { memberId: memberIdOrUserId, userId, source: via ?? "mcp" }
    : null;
  const heartbeatUserId = authenticatedIdentity?.userId ?? memberIdOrUserId;
  const result = await openOrRefreshSessionWindow({
    issueId: issue.id,
    userId: heartbeatUserId,
    now: new Date(),
    ...(mayAdopt && authenticatedIdentity
      ? {
          createIdentity: authenticatedIdentity,
          sourceOverride: authenticatedIdentity.source,
          heartbeatAdoption: true,
        }
      : {}),
    via,
    incidentIssueId: issue.type === "incident" ? issue.id : undefined,
    issueKey,
    onConflict: "skip",
    // Request the current primitive's post-lock ownership interval boundary.
    ownershipIntervalEnd: new Date(),
  });

  if (result.finalized) {
    await emitFinalizedWindow({
      issueKey,
      issueId: issue.id,
      workspaceId: issue.project.workspaceId,
      userId: heartbeatUserId,
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
            userId: heartbeatUserId,
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
 * Stable work-transition identities use only semantics that survive process
 * restart. DomainEvent.id is intentionally excluded because the in-process bus
 * resets its counter; an identical tuple is therefore an exact replay.
 */
function transitionStartIdentity(input: {
  issueId: string;
  userId: string;
  memberId: string;
  startedAt: Date;
  source: string;
}): string {
  return JSON.stringify([
    "work-transition-start",
    1,
    input.issueId,
    input.userId,
    input.memberId,
    input.startedAt.toISOString(),
    input.source,
  ]);
}

function transitionCloseIdentity(input: {
  issueId: string;
  observedAt: Date;
  source: string;
}): string {
  return JSON.stringify([
    "work-transition-close",
    1,
    input.issueId,
    input.observedAt.toISOString(),
    input.source,
  ]);
}

type TransitionLifecycleRow =
  Prisma.WorkTransitionLifecycleGetPayload<Record<string, never>>;

function lifecycleResult(row: TransitionLifecycleRow) {
  return {
    id: row.id,
    startIdentity: row.startIdentity,
    closeIdentity: row.closeIdentity,
    completed: Boolean(row.startIdentity && row.closeIdentity),
    workLogId: row.workLogId,
  };
}

async function completeTransitionLifecycle(
  tx: Prisma.TransactionClient,
  row: TransitionLifecycleRow,
): Promise<TransitionLifecycleRow> {
  if (
    !row.startIdentity ||
    !row.closeIdentity ||
    !row.startedAt ||
    !row.endedAt ||
    !row.userId ||
    !row.memberId
  ) {
    return row;
  }

  if (row.workLogId) {
    const linkedWorkLog = await tx.workLog.findUnique({
      where: { id: row.workLogId },
      select: { startedAt: true, endedAt: true },
    });
    if (
      !linkedWorkLog ||
      linkedWorkLog.endedAt.getTime() <= row.endedAt.getTime()
    ) {
      return row;
    }

    const durationS = Math.max(
      0,
      Math.floor(
        (row.endedAt.getTime() - linkedWorkLog.startedAt.getTime()) / 1000,
      ),
    );
    await tx.workLog.update({
      where: { id: row.workLogId },
      data: {
        endedAt: row.endedAt,
        durationS,
        reason: "stopped",
      },
    });

    // An ordinary finalizer may have published this exact lifecycle at its
    // processing-time boundary before the authoritative close arrived. Clear
    // both the acknowledgement and any in-flight claim so the corrected row is
    // durably re-emitted; a stale publisher can no longer acknowledge its token.
    return tx.workTransitionLifecycle.update({
      where: { id: row.id },
      data: {
        effectsClaimedAt: null,
        effectClaimToken: null,
        effectsEmittedAt: null,
      },
    });
  }

  const foreignOwner = await findForeignOwnerAtBoundary(
    tx,
    row.issueId,
    row.userId,
    row.startedAt,
    row.endedAt,
  );
  if (foreignOwner) {
    // The lifecycle itself remains the durable replay identity, but foreign
    // ownership means it cannot authoritatively create work evidence.
    return tx.workTransitionLifecycle.update({
      where: { id: row.id },
      data: { effectsEmittedAt: new Date() },
    });
  }

  const session = await tx.workSession.findUnique({
    where: {
      userId_issueId: { userId: row.userId, issueId: row.issueId },
    },
  });
  const isExactGeneration =
    session?.transitionLifecycleId === row.id;
  let endedAt = row.endedAt;
  let reason: "expired" | "stopped" = "stopped";

  if (!isExactGeneration) {
    let laterGenerationBoundary: Date | null = null;
    if (
      session &&
      session.startedAt.getTime() > row.startedAt.getTime() &&
      session.startedAt.getTime() < endedAt.getTime()
    ) {
      laterGenerationBoundary = session.startedAt;
    }

    const laterWorkLog = await tx.workLog.findFirst({
      where: {
        issueId: row.issueId,
        member: { userId: row.userId },
        startedAt: { gt: row.startedAt, lt: row.endedAt },
      },
      orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      select: { startedAt: true },
    });
    if (
      laterWorkLog &&
      laterWorkLog.startedAt.getTime() > row.startedAt.getTime() &&
      laterWorkLog.startedAt.getTime() < endedAt.getTime() &&
      (!laterGenerationBoundary ||
        laterWorkLog.startedAt.getTime() < laterGenerationBoundary.getTime())
    ) {
      laterGenerationBoundary = laterWorkLog.startedAt;
    }

    if (laterGenerationBoundary) {
      // A different same-user generation owns the interval from its start
      // onward, whether it is still live or already persisted as a WorkLog.
      endedAt = laterGenerationBoundary;
    }
  }

  if (session && isExactGeneration) {
    if (session.lastHeartbeat.getTime() > row.endedAt.getTime()) {
      // A heartbeat after the close proves this row has been refreshed or
      // re-entered by a later generation. Preserve it and rebase its start so
      // the eventual stop cannot recapture the older interval.
      const rebased = await tx.workSession.updateMany({
        where: {
          id: session.id,
          lastHeartbeat: session.lastHeartbeat,
          startedAt: session.startedAt,
        },
        data: {
          startedAt: session.lastHeartbeat,
          transitionLifecycleId: null,
        },
      });
      if (rebased.count !== 1) throw new RetrySessionMutation();
    } else {
      const captured = captureThroughLease(session, row.endedAt);
      endedAt = captured.endedAt;
      reason = captured.expired ? "expired" : "stopped";
      const claimed = await tx.workSession.deleteMany({
        where: { id: session.id, lastHeartbeat: session.lastHeartbeat },
      });
      if (claimed.count !== 1) throw new RetrySessionMutation();
    }

    const interruptions = await tx.interruption.findMany({
      where: {
        incidentIssueId: row.issueId,
        memberId: row.memberId,
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
    if (interruptions.length > 0) {
      await tx.interruption.updateMany({
        where: {
          incidentIssueId: row.issueId,
          memberId: row.memberId,
          endedAt: null,
          startedAt: { lte: endedAt },
        },
        data: { endedAt },
      });
    }
  }

  const durationS = Math.floor(
    (endedAt.getTime() - row.startedAt.getTime()) / 1000,
  );
  if (durationS < MIN_WORKLOG_DURATION_S) {
    return tx.workTransitionLifecycle.update({
      where: { id: row.id },
      data: { effectsEmittedAt: new Date() },
    });
  }

  const workLog = await tx.workLog.create({
    data: {
      startedAt: row.startedAt,
      endedAt,
      durationS,
      reason,
      via: normalizeVia(row.source),
      issueId: row.issueId,
      memberId: row.memberId,
    },
  });

  return tx.workTransitionLifecycle.update({
    where: { id: row.id },
    data: { workLogId: workLog.id },
  });
}

async function mutateTransitionLifecycle(
  issueId: string,
  mutation: (
    tx: Prisma.TransactionClient,
  ) => Promise<TransitionLifecycleRow>,
): Promise<TransitionLifecycleRow> {
  for (let attempt = 0; attempt < SESSION_MUTATION_RETRIES; attempt++) {
    try {
      return await prisma.$transaction(
        async (tx) => {
          await tx.$queryRaw`
            SELECT "id"
            FROM "issues"
            WHERE "id" = ${issueId}::uuid
            FOR UPDATE
          `;
          return mutation(tx);
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );
    } catch (err) {
      if (
        isRetryableSessionMutation(err) &&
        attempt + 1 < SESSION_MUTATION_RETRIES
      ) {
        continue;
      }
      if (err instanceof RetrySessionMutation) {
        throw new AppError(
          409,
          "SESSION_CONFLICT",
          "Work-transition lifecycle changed concurrently",
        );
      }
      throw err;
    }
  }
  throw new AppError(
    409,
    "SESSION_CONFLICT",
    "Work-transition lifecycle changed concurrently",
  );
}

/**
 * Publish the durable lifecycle outbox effect.
 *
 * Claiming is atomic across processes. A crash before emission leaves a stale
 * claim that a later replay can recover; a crash after emission but before the
 * acknowledgement can still redeliver after the lease, so downstream handlers
 * must continue treating domain events as idempotent.
 */
async function publishTransitionLifecycleEffects(
  lifecycleId: string,
): Promise<void> {
  const claimToken = randomUUID();
  const claimAt = new Date();
  const staleBefore = new Date(claimAt.getTime() - LIFECYCLE_EFFECT_CLAIM_TTL_MS);
  const claimed = await prisma.workTransitionLifecycle.updateMany({
    where: {
      id: lifecycleId,
      workLogId: { not: null },
      effectsEmittedAt: null,
      OR: [
        { effectsClaimedAt: null, effectClaimToken: null },
        { effectsClaimedAt: { lt: staleBefore } },
      ],
    },
    data: { effectsClaimedAt: claimAt, effectClaimToken: claimToken },
  });
  if (claimed.count !== 1) return;

  const lifecycle = await prisma.workTransitionLifecycle.findUnique({
    where: { id: lifecycleId },
    include: {
      workLog: {
        select: { id: true, durationS: true, reason: true, endedAt: true },
      },
      issue: {
        select: {
          id: true,
          key: true,
          project: { select: { workspaceId: true } },
        },
      },
    },
  });
  if (
    !lifecycle?.workLog ||
    !lifecycle.memberId ||
    !lifecycle.userId ||
    !lifecycle.startIdentity
  ) {
    await prisma.workTransitionLifecycle.updateMany({
      where: { id: lifecycleId, effectClaimToken: claimToken },
      data: { effectsClaimedAt: null, effectClaimToken: null },
    });
    return;
  }

  try {
    await eventBus.emitAndWait({
      type: "worklog.created",
      workspaceId: lifecycle.issue.project.workspaceId,
      actorId: lifecycle.memberId,
      payload: {
        workLogId: lifecycle.workLog.id,
        issueId: lifecycle.issue.id,
        workspaceId: lifecycle.issue.project.workspaceId,
      },
    });
    await eventBus.emitAndWait({
      type: "work_session.ended",
      workspaceId: lifecycle.issue.project.workspaceId,
      actorId: lifecycle.memberId,
      payload: {
        issueKey: lifecycle.issue.key,
        issueId: lifecycle.issue.id,
        memberId: lifecycle.memberId,
        userId: lifecycle.userId,
        workLogId: lifecycle.workLog.id,
        durationS: lifecycle.workLog.durationS,
        reason: lifecycle.workLog.reason,
      },
    });
    const closedInterruptions = await prisma.interruption.findMany({
      where: {
        incidentIssueId: lifecycle.issue.id,
        memberId: lifecycle.memberId,
        endedAt: lifecycle.workLog.endedAt,
      },
      select: {
        id: true,
        incidentIssueId: true,
        interruptedIssueId: true,
        memberId: true,
      },
    });
    for (const interruption of closedInterruptions) {
      await eventBus.emitAndWait({
        type: "interruption.closed",
        workspaceId: lifecycle.issue.project.workspaceId,
        actorId: interruption.memberId,
        payload: {
          interruptionId: interruption.id,
          incidentIssueId: interruption.incidentIssueId,
          interruptedIssueId: interruption.interruptedIssueId,
          memberId: interruption.memberId,
        },
      });
    }
    await prisma.workTransitionLifecycle.updateMany({
      where: {
        id: lifecycleId,
        effectClaimToken: claimToken,
        effectsEmittedAt: null,
      },
      data: {
        effectsEmittedAt: new Date(),
        effectsClaimedAt: null,
        effectClaimToken: null,
      },
    });
  } catch {
    await prisma.workTransitionLifecycle.updateMany({
      where: {
        id: lifecycleId,
        effectClaimToken: claimToken,
        effectsEmittedAt: null,
      },
      data: { effectsClaimedAt: null, effectClaimToken: null },
    });
  }
}

/** Drain committed lifecycle effects on startup and periodically thereafter. */
export async function drainTransitionLifecycleEffects(
  lifecycleIds?: readonly string[],
): Promise<void> {
  const ids = lifecycleIds
    ? [...lifecycleIds]
    : (
        await prisma.workTransitionLifecycle.findMany({
          where: { workLogId: { not: null }, effectsEmittedAt: null },
          orderBy: [{ createdAt: "asc" }, { id: "asc" }],
          select: { id: true },
          take: 100,
        })
      ).map((row) => row.id);

  for (const id of ids) {
    await publishTransitionLifecycleEffects(id);
  }
}

/**
 * Persist an authoritative active-entry signal before attempting to open a live
 * WorkSession. A close-only row may already exist when delivery is out of
 * order; pairing and WorkLog creation then happen in this same transaction.
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
    select: { id: true },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const startIdentity = transitionStartIdentity({
    issueId: issue.id,
    userId,
    memberId,
    startedAt,
    source,
  });
  const lifecycle = await mutateTransitionLifecycle(issue.id, async (tx) => {
    const replay = await tx.workTransitionLifecycle.findUnique({
      where: { startIdentity },
    });
    if (replay) return replay;

    const waitingClose = await tx.workTransitionLifecycle.findFirst({
      where: {
        issueId: issue.id,
        source,
        startIdentity: null,
        endedAt: { gt: startedAt },
      },
      orderBy: [{ endedAt: "asc" }, { id: "asc" }],
    });
    if (!waitingClose) {
      return tx.workTransitionLifecycle.create({
        data: {
          issueId: issue.id,
          userId,
          memberId,
          source,
          startIdentity,
          startedAt,
        },
      });
    }

    const paired = await tx.workTransitionLifecycle.update({
      where: { id: waitingClose.id },
      data: {
        userId,
        memberId,
        startIdentity,
        startedAt,
      },
    });
    return completeTransitionLifecycle(tx, paired);
  });

  await publishTransitionLifecycleEffects(lifecycle.id);
  return {
    session: null,
    lifecycle: lifecycleResult(lifecycle),
    workLog: lifecycle.workLogId ? { id: lifecycle.workLogId } : null,
  };
}

/**
 * Persist a close boundary before inspecting live WorkSessions. When its start
 * has not arrived yet, the close-only row is the durable evidence recovered by
 * a delayed or replayed start in any process.
 */
export async function captureTransitionClose(
  issueKey: string,
  observedAt: Date,
  source: string = "transition-listener",
) {
  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const closeIdentity = transitionCloseIdentity({
    issueId: issue.id,
    observedAt,
    source,
  });
  const lifecycle = await mutateTransitionLifecycle(issue.id, async (tx) => {
    const replay = await tx.workTransitionLifecycle.findUnique({
      where: { closeIdentity },
    });
    if (replay) return replay;

    const waitingStart = await tx.workTransitionLifecycle.findFirst({
      where: {
        issueId: issue.id,
        source,
        closeIdentity: null,
        startedAt: { lt: observedAt },
      },
      orderBy: [{ startedAt: "desc" }, { id: "desc" }],
    });
    if (!waitingStart) {
      return tx.workTransitionLifecycle.create({
        data: {
          issueId: issue.id,
          source,
          closeIdentity,
          endedAt: observedAt,
        },
      });
    }

    const paired = await tx.workTransitionLifecycle.update({
      where: { id: waitingStart.id },
      data: { closeIdentity, endedAt: observedAt },
    });
    return completeTransitionLifecycle(tx, paired);
  });

  await publishTransitionLifecycleEffects(lifecycle.id);
  return {
    lifecycle: lifecycleResult(lifecycle),
    workLog: lifecycle.workLogId ? { id: lifecycle.workLogId } : null,
  };
}

/**
 * Atomically persist an interval already proven by its ordered transition pair.
 * The same start identity can belong to only one lifecycle, so an exact
 * completed-start replay returns the original interval rather than creating a
 * second marker, WorkSession, WorkLog, or event pair.
 */
export async function captureTransitionInterval(
  issueKey: string,
  userId: string,
  memberId: string,
  startedAt: Date,
  observedAt: Date,
  source: string = "transition-listener",
) {
  if (observedAt.getTime() <= startedAt.getTime()) {
    return { workLog: null };
  }

  const issue = await prisma.issue.findUnique({
    where: { key: issueKey },
    select: { id: true },
  });
  if (!issue) {
    throw new AppError(404, "ISSUE_NOT_FOUND", `Issue "${issueKey}" not found`);
  }

  const startIdentity = transitionStartIdentity({
    issueId: issue.id,
    userId,
    memberId,
    startedAt,
    source,
  });
  const closeIdentity = transitionCloseIdentity({
    issueId: issue.id,
    observedAt,
    source,
  });

  const lifecycle = await mutateTransitionLifecycle(issue.id, async (tx) => {
    const existingStart = await tx.workTransitionLifecycle.findUnique({
      where: { startIdentity },
    });
    if (existingStart?.closeIdentity) return existingStart;

    const existingClose = await tx.workTransitionLifecycle.findUnique({
      where: { closeIdentity },
    });

    let paired: TransitionLifecycleRow;
    if (existingStart) {
      if (existingClose && existingClose.id !== existingStart.id) {
        await tx.workTransitionLifecycle.delete({
          where: { id: existingClose.id },
        });
      }
      paired = await tx.workTransitionLifecycle.update({
        where: { id: existingStart.id },
        data: { closeIdentity, endedAt: observedAt },
      });
    } else if (existingClose) {
      paired = await tx.workTransitionLifecycle.update({
        where: { id: existingClose.id },
        data: {
          userId,
          memberId,
          startIdentity,
          startedAt,
        },
      });
    } else {
      paired = await tx.workTransitionLifecycle.create({
        data: {
          issueId: issue.id,
          userId,
          memberId,
          source,
          startIdentity,
          closeIdentity,
          startedAt,
          endedAt: observedAt,
        },
      });
    }
    return completeTransitionLifecycle(tx, paired);
  });

  await publishTransitionLifecycleEffects(lifecycle.id);
  return {
    workLog: lifecycle.workLogId
      ? {
          id: lifecycle.workLogId,
          durationS: Math.floor(
            (observedAt.getTime() - startedAt.getTime()) / 1000,
          ),
        }
      : null,
  };
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
        transitionLifecycleId: string | null;
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
          const transitionLifecycleId = existing.transitionLifecycleId;
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
            if (transitionLifecycleId) {
              const linked = await tx.workTransitionLifecycle.updateMany({
                where: { id: transitionLifecycleId, workLogId: null },
                data: { workLogId: created.id },
              });
              if (linked.count !== 1) throw new RetrySessionMutation();
            }
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
            transitionLifecycleId,
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

  const {
    existing,
    workLog,
    transitionLifecycleId,
    durationS,
    reason,
    closedInterruptions,
  } = stopped;

  if (transitionLifecycleId && workLog) {
    await publishTransitionLifecycleEffects(transitionLifecycleId);
  } else if (workLog) {
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

  if (!transitionLifecycleId || !workLog) {
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
              transitionLifecycleId: null,
              closedInterruptions: [] as ClosedInterruption[],
            };
          }

          let workLog: { id: string } | null = null;
          const transitionLifecycleId = s.transitionLifecycleId;
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
            if (transitionLifecycleId) {
              const linked = await tx.workTransitionLifecycle.updateMany({
                where: { id: transitionLifecycleId, workLogId: null },
                data: { workLogId: created.id },
              });
              if (linked.count !== 1) throw new RetrySessionMutation();
            }
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

          return {
            claimed: true as const,
            workLog,
            transitionLifecycleId,
            closedInterruptions,
          };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      );

      if (!outcome.claimed) continue;

      if (outcome.transitionLifecycleId && outcome.workLog) {
        await publishTransitionLifecycleEffects(outcome.transitionLifecycleId);
      } else if (outcome.workLog) {
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

      if (!outcome.transitionLifecycleId || !outcome.workLog) {
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
