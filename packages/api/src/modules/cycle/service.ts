import type { CycleScopeEvent, IssueState, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { eventBus } from "../../services/event-bus/index.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 1-based day index inside a cycle (clamped to [1, totalDays]).
 * Exported so other modules (e.g. issue service) can stamp scope events
 * with a consistent day value.
 */
export function dayIndex(
  start: Date,
  end: Date,
  now: Date = new Date(),
): number {
  const total = Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / ONE_DAY_MS),
  );
  const elapsed = Math.round((now.getTime() - start.getTime()) / ONE_DAY_MS);
  return Math.max(1, Math.min(total, elapsed));
}

function totalDays(start: Date, end: Date): number {
  return Math.max(
    1,
    Math.round((end.getTime() - start.getTime()) / ONE_DAY_MS),
  );
}

/**
 * Validate that a cycle exists AND belongs to a given project. Throws
 * AppError 400 CROSS_PROJECT_CYCLE if the cycle's project differs.
 *
 * Returns the loaded cycle (with startDate/endDate) so callers can reuse it
 * for day-index computation without a second findUnique.
 */
export async function validateCycleBelongsToProject(
  cycleId: string,
  projectId: string,
): Promise<{
  id: string;
  projectId: string;
  startDate: Date;
  endDate: Date;
}> {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: { id: true, projectId: true, startDate: true, endDate: true },
  });
  if (!cycle) {
    throw new AppError(
      400,
      "CROSS_PROJECT_CYCLE",
      `Cycle "${cycleId}" not found`,
    );
  }
  if (cycle.projectId !== projectId) {
    throw new AppError(
      400,
      "CROSS_PROJECT_CYCLE",
      `Cycle "${cycleId}" belongs to a different project`,
    );
  }
  return cycle;
}

/**
 * Insert a CycleScopeEvent row. Used by both the cycle attach/detach API
 * and by the issue service when createIssue/updateIssue mutate cycleId.
 *
 * If `day` is not provided, the cycle is loaded to compute it.
 * Pass `tx` to participate in an outer transaction.
 */
export async function recordCycleScopeEvent(params: {
  cycleId: string;
  kind: "add" | "remove";
  issueKey: string;
  reason?: string | null;
  authorId?: string | null;
  day?: number;
  tx?: Prisma.TransactionClient;
}): Promise<void> {
  const client = params.tx ?? prisma;

  let day = params.day;
  if (day === undefined) {
    const cycle = await client.cycle.findUnique({
      where: { id: params.cycleId },
      select: { startDate: true, endDate: true },
    });
    if (!cycle) {
      // Cycle disappeared — nothing to record. Caller decides whether to log.
      return;
    }
    day = dayIndex(cycle.startDate, cycle.endDate);
  }

  await client.cycleScopeEvent.create({
    data: {
      cycleId: params.cycleId,
      day,
      kind: params.kind,
      issueKey: params.issueKey,
      reason: params.reason ?? undefined,
      authorId: params.authorId ?? undefined,
    },
  });
}

/**
 * Sum of estimates (story points). Issues without an estimate count as 1
 * (so unestimated cycles still produce a meaningful number).
 */
function sumPoints(
  issues: Array<{ estimate: number | null; state: IssueState }>,
  filter: (i: { state: IssueState }) => boolean = () => true,
): number {
  return issues
    .filter(filter)
    .reduce((acc, i) => acc + (i.estimate ?? 1), 0);
}

/**
 * Build a per-day burnup series: how many points were completed by the end of
 * each day, derived from each issue's last `state_changed -> done` activity.
 *
 * We collapse into points-per-day so the chart can plot a daily cumulative line.
 */
async function computeBurnup(
  cycleId: string,
  start: Date,
  end: Date,
): Promise<{ burnup: number[]; scopeLine: number[] }> {
  const days = totalDays(start, end);
  const issues = await prisma.issue.findMany({
    where: { cycleId },
    select: {
      id: true,
      estimate: true,
      state: true,
      activityLogs: {
        where: { action: "state_changed" },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, details: true },
      },
    },
  });

  // Day-of-cycle (0..days) → number of points completed that day
  const completedByDay = new Array<number>(days + 1).fill(0);

  for (const issue of issues) {
    if (issue.state !== "done") continue;
    // Find the last state_changed activity that ended in done; fall back to
    // the cycle end if we cannot tell.
    const doneEvent = [...issue.activityLogs].reverse().find((a) => {
      const det = a.details as { newValue?: string } | null;
      return det?.newValue === "done";
    });
    const ts = doneEvent?.createdAt ?? end;
    const day = Math.max(
      0,
      Math.min(days, Math.round((ts.getTime() - start.getTime()) / ONE_DAY_MS)),
    );
    completedByDay[day] = (completedByDay[day] ?? 0) + (issue.estimate ?? 1);
  }

  // Cumulative completed series.
  const burnup: number[] = [];
  let acc = 0;
  for (let d = 0; d <= days; d++) {
    acc += completedByDay[d] ?? 0;
    burnup.push(acc);
  }

  // Total scope (constant for now — we do not yet recompute scope at each day
  // from CycleScopeEvent because adding/removing issues just changes the cycle
  // membership directly).
  const totalScope = sumPoints(issues);
  const scopeLine = new Array(days + 1).fill(totalScope);

  return { burnup, scopeLine };
}

interface RiskRule {
  id: string;
  severity: "low" | "medium" | "high";
  title: string;
  detail: string;
  action?: string;
}

/**
 * Pure risk computation. Given a snapshot of cycle state, returns a list of
 * surfaced risks. Lightweight heuristics for now — Phase 4 can replace this
 * with an MCP-driven analyzer.
 */
function computeRisks(
  cycle: { dayIndex: number; days: number; scope: number; completed: number },
  issues: Array<{ key: string; state: IssueState; updatedAt: Date }>,
  scopeEvents: CycleScopeEvent[],
): RiskRule[] {
  const out: RiskRule[] = [];

  // 1) Burn pace lagging vs elapsed time
  const elapsedPct = cycle.dayIndex / cycle.days;
  const completedPct = cycle.scope > 0 ? cycle.completed / cycle.scope : 0;
  if (cycle.dayIndex >= 3 && completedPct < elapsedPct - 0.15) {
    out.push({
      id: "behind-pace",
      severity: "high",
      title: "Cycle behind pace",
      detail: `${Math.round(completedPct * 100)}% complete on day ${cycle.dayIndex} of ${cycle.days} (${Math.round(elapsedPct * 100)}% elapsed).`,
      action: "Review scope",
    });
  }

  // 2) Review queue piling up
  const inReview = issues.filter((i) => i.state === "review").length;
  if (inReview >= 3) {
    out.push({
      id: "review-buildup",
      severity: "medium",
      title: "Review queue building up",
      detail: `${inReview} issues waiting in review.`,
      action: "Ping reviewers",
    });
  }

  // 3) Heavy mid-cycle scope changes
  const scopeNet =
    scopeEvents.filter((e) => e.kind === "add").length -
    scopeEvents.filter((e) => e.kind === "remove").length;
  if (scopeNet >= 4) {
    out.push({
      id: "scope-creep",
      severity: "medium",
      title: "Scope expanding mid-cycle",
      detail: `+${scopeNet} net issues added since planning.`,
      action: "Re-plan",
    });
  }

  return out;
}

export async function listCycles(projectKey: string) {
  const project = await prisma.project.findFirst({ where: { key: projectKey } });
  if (!project)
    throw new AppError(404, "PROJECT_NOT_FOUND", `Project "${projectKey}" not found`);
  return prisma.cycle.findMany({
    where: { projectId: project.id },
    orderBy: { startDate: "desc" },
  });
}

/**
 * Default cap for `scopeEvents` returned in cycle responses. Burnup math and
 * risk computation always run on the FULL event set; only the response slice
 * is capped.
 */
const DEFAULT_SCOPE_EVENTS_LIMIT = 20;

export async function getCycle(
  id: string,
  opts?: { includeAllScopeEvents?: boolean },
) {
  const cycle = await prisma.cycle.findUnique({
    where: { id },
    include: {
      issues: {
        select: {
          id: true,
          key: true,
          title: true,
          type: true,
          priority: true,
          state: true,
          estimate: true,
          updatedAt: true,
          assignee: { select: { id: true, username: true } },
        },
      },
    },
  });
  if (!cycle) throw new AppError(404, "CYCLE_NOT_FOUND", "Cycle not found");

  // Fetch scope events separately so we can keep the FULL array for burnup +
  // risk math while only paginating the response. One extra read; no count()
  // round-trip needed because we measure length() on the in-memory array.
  const allScopeEvents = await prisma.cycleScopeEvent.findMany({
    where: { cycleId: cycle.id },
    orderBy: { day: "asc" },
    include: {
      author: { select: { id: true, username: true, isAgent: true } },
    },
  });

  const dIdx = dayIndex(cycle.startDate, cycle.endDate);
  const tDays = totalDays(cycle.startDate, cycle.endDate);
  const scope = sumPoints(cycle.issues);
  const completed = sumPoints(cycle.issues, (i) => i.state === "done");

  const { burnup, scopeLine } = await computeBurnup(
    cycle.id,
    cycle.startDate,
    cycle.endDate,
  );

  // Risk computation MUST see all events; aggregate counts MUST match totals.
  const risks = computeRisks(
    { dayIndex: dIdx, days: tDays, scope, completed },
    cycle.issues,
    allScopeEvents,
  );
  const scopeAdded = allScopeEvents.filter((e) => e.kind === "add").length;
  const scopeRemoved = allScopeEvents.filter((e) => e.kind === "remove").length;

  // Response slice: last N events by insertion order (already day-asc).
  const responseScopeEvents = opts?.includeAllScopeEvents
    ? allScopeEvents
    : allScopeEvents.slice(-DEFAULT_SCOPE_EVENTS_LIMIT);

  return {
    ...cycle,
    scopeEvents: responseScopeEvents,
    totalScopeEvents: allScopeEvents.length,
    dayIndex: dIdx,
    days: tDays,
    scope,
    completed,
    scopeAdded,
    scopeRemoved,
    burnup,
    scopeLine,
    risks,
  };
}

interface CreateCycleInput {
  name: string;
  goal?: string;
  startDate: Date;
  endDate: Date;
  state?: "upcoming" | "active" | "done";
  /**
   * Optional keys of issues to attach to the new cycle atomically.
   * When provided (length > 0), the cycle creation, demotion of any other
   * active cycle, the issue.updateMany, and the scope-event createMany ALL
   * run inside a single Prisma transaction — so a failure rolls everything
   * back. Pre-validation (cross-project / missing key) runs BEFORE the tx
   * to avoid wasted work.
   */
  attachIssueKeys?: string[];
}

export async function createCycle(
  projectKey: string,
  input: CreateCycleInput,
  authorId?: string,
) {
  const project = await prisma.project.findFirst({ where: { key: projectKey } });
  if (!project)
    throw new AppError(404, "PROJECT_NOT_FOUND", `Project "${projectKey}" not found`);

  const attachKeys = input.attachIssueKeys ?? [];
  const shouldAttach = attachKeys.length > 0;

  // ── Path A: no attach work — keep the legacy non-tx path so call sites
  // that don't need atomicity don't pay the tx overhead.
  if (!shouldAttach) {
    if (input.state === "active") {
      await prisma.cycle.updateMany({
        where: { projectId: project.id, state: "active" },
        data: { state: "done" },
      });
    }
    return prisma.cycle.create({
      data: {
        name: input.name,
        goal: input.goal,
        state: input.state ?? "upcoming",
        startDate: input.startDate,
        endDate: input.endDate,
        projectId: project.id,
      },
    });
  }

  // ── Path B: attach issues atomically.
  // Pre-validate cross-project / missing keys BEFORE opening the tx — same
  // approach as `attachIssues` for consistent error semantics.
  const foundIssues = await prisma.issue.findMany({
    where: { key: { in: attachKeys } },
    select: { key: true, projectId: true },
  });
  const foundKeySet = new Set(foundIssues.map((i) => i.key));
  const missingKeys = attachKeys.filter((k) => !foundKeySet.has(k));
  const crossProjectKeys = foundIssues
    .filter((i) => i.projectId !== project.id)
    .map((i) => i.key);
  const offendingKeys = [...new Set([...missingKeys, ...crossProjectKeys])];
  if (offendingKeys.length > 0) {
    throw new AppError(
      400,
      "CROSS_PROJECT_ISSUE",
      `The following issue keys do not belong to project "${projectKey}": ${offendingKeys.join(", ")}`,
    );
  }

  const cycle = await prisma.$transaction(async (tx) => {
    // Demote inside the tx so a later failure also rolls back the demotion.
    if (input.state === "active") {
      await tx.cycle.updateMany({
        where: { projectId: project.id, state: "active" },
        data: { state: "done" },
      });
    }

    const created = await tx.cycle.create({
      data: {
        name: input.name,
        goal: input.goal,
        state: input.state ?? "upcoming",
        startDate: input.startDate,
        endDate: input.endDate,
        projectId: project.id,
      },
    });

    // Attach all issues in the SAME tx so an FK violation rolls back the
    // cycle.create above.
    await tx.issue.updateMany({
      where: { key: { in: attachKeys }, projectId: project.id },
      data: { cycleId: created.id },
    });

    const day = dayIndex(created.startDate, created.endDate);
    await tx.cycleScopeEvent.createMany({
      data: attachKeys.map((issueKey) => ({
        cycleId: created.id,
        day,
        kind: "add" as const,
        issueKey,
        authorId: authorId ?? null,
      })),
    });

    return created;
  });

  // Post-commit SSE: only fires once the whole tx committed. Mirrors the
  // emission pattern in `attachIssues`.
  if (authorId) {
    try {
      for (const issueKey of attachKeys) {
        eventBus.emit({
          type: "issue.updated",
          workspaceId: project.workspaceId,
          actorId: authorId,
          payload: { issueKey, fields: ["cycleId"] },
        });
      }
    } catch {
      // Never let event emission break the mutation
    }
  }

  return cycle;
}

/**
 * Close a cycle. Default response is a minimal ack
 *   `{ id, state, velocity, closedAt }`
 * sized to fit MCP token budgets. Pass `{ verbose: true }` to receive the
 * full updated cycle row (legacy shape) — used when the caller still needs
 * raw cycle data and wants to skip a follow-up `getCycle` round-trip.
 *
 * Note: the Prisma `Cycle` model does not currently have a dedicated
 * `closedAt` column. We surface the row's `updatedAt` (which Prisma stamps
 * on `update`) under the ack-friendly name. If a dedicated column is added
 * later, swap the source here.
 */
export async function closeCycle(
  id: string,
  opts?: { verbose?: boolean },
) {
  const cycle = await prisma.cycle.findUnique({
    where: { id },
    include: {
      issues: { select: { estimate: true, state: true } },
    },
  });
  if (!cycle) throw new AppError(404, "CYCLE_NOT_FOUND", "Cycle not found");
  const velocity = sumPoints(cycle.issues, (i) => i.state === "done");
  const updated = await prisma.cycle.update({
    where: { id },
    data: { state: "done", velocity },
  });
  if (opts?.verbose) {
    return updated;
  }
  return {
    id: updated.id,
    state: updated.state,
    velocity: updated.velocity,
    closedAt: updated.updatedAt,
  };
}

interface AttachIssuesInput {
  add?: string[]; // issue keys
  remove?: string[]; // issue keys
  reason?: string;
  authorId?: string;
}

export async function attachIssues(cycleId: string, input: AttachIssuesInput) {
  const cycle = await prisma.cycle.findUnique({
    where: { id: cycleId },
    select: {
      id: true,
      projectId: true,
      startDate: true,
      endDate: true,
      project: { select: { workspaceId: true } },
    },
  });
  if (!cycle) throw new AppError(404, "CYCLE_NOT_FOUND", "Cycle not found");

  const allKeys = [...(input.add ?? []), ...(input.remove ?? [])];

  if (allKeys.length > 0) {
    const foundIssues = await prisma.issue.findMany({
      where: { key: { in: allKeys } },
      select: { key: true, projectId: true },
    });

    const foundKeySet = new Set(foundIssues.map((i) => i.key));

    // Keys that do not exist in the database at all
    const missingKeys = allKeys.filter((k) => !foundKeySet.has(k));

    // Keys that exist but belong to a different project
    const crossProjectKeys = foundIssues
      .filter((i) => i.projectId !== cycle.projectId)
      .map((i) => i.key);

    const offendingKeys = [...new Set([...missingKeys, ...crossProjectKeys])];

    if (offendingKeys.length > 0) {
      throw new AppError(
        400,
        "CROSS_PROJECT_ISSUE",
        `The following issue keys do not belong to this cycle's project: ${offendingKeys.join(", ")}`,
      );
    }
  }

  const day = dayIndex(cycle.startDate, cycle.endDate);

  await prisma.$transaction(async (tx) => {
    if (input.add?.length) {
      await tx.issue.updateMany({
        where: { key: { in: input.add }, projectId: cycle.projectId },
        data: { cycleId: cycle.id },
      });
      for (const key of input.add) {
        await recordCycleScopeEvent({
          cycleId: cycle.id,
          kind: "add",
          issueKey: key,
          reason: input.reason,
          authorId: input.authorId,
          day,
          tx,
        });
      }
    }
    if (input.remove?.length) {
      await tx.issue.updateMany({
        where: { key: { in: input.remove }, cycleId: cycle.id },
        data: { cycleId: null },
      });
      for (const key of input.remove) {
        await recordCycleScopeEvent({
          cycleId: cycle.id,
          kind: "remove",
          issueKey: key,
          reason: input.reason,
          authorId: input.authorId,
          day,
          tx,
        });
      }
    }
  });

  // Emit issue.updated for each affected issue (fire-and-forget) so SSE
  // listeners (useDomainEvents) invalidate cycleKeys.all on the frontend.
  // Without this, cycle membership changes don't auto-refresh the Cycles view.
  // Route handlers always pass authorId from request.member!.id; if absent
  // (only possible from internal callers), skip emission rather than crash.
  if (input.authorId) {
    try {
      const actorId = input.authorId;
      const affected = [...(input.add ?? []), ...(input.remove ?? [])];
      for (const key of affected) {
        eventBus.emit({
          type: "issue.updated",
          workspaceId: cycle.project.workspaceId,
          actorId,
          payload: { issueKey: key, fields: ["cycleId"] },
        });
      }
    } catch {
      // Never let event emission break the mutation
    }
  }

  return getCycle(cycleId);
}
