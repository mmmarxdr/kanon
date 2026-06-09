import type { CycleScopeEvent, IssueState, Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { eventBus } from "../../services/event-bus/index.js";
import { isDoneTransition } from "../../shared/activity-log.js";

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
 * Also builds a stepped scopeLine from CycleScopeEvent rows (KAN-36):
 * index d holds cumulative scope (story points) at the end of cycle day d.
 *
 * We collapse into points-per-day so the chart can plot a daily cumulative line.
 */
async function computeBurnup(
  cycleId: string,
  start: Date,
  end: Date,
  allScopeEvents: CycleScopeEvent[],
): Promise<{ burnup: number[]; scopeLine: number[]; estMap: Map<string, number> }> {
  const days = totalDays(start, end);
  // KAN-35: read completedAt directly — no activityLogs join needed.
  // KAN-36: also select key so we can build the estimate map for scope events.
  const issues = await prisma.issue.findMany({
    where: { cycleId },
    select: {
      id: true,
      key: true,
      estimate: true,
      state: true,
      completedAt: true,
    },
  });

  // Day-of-cycle (0..days) → number of points completed that day
  const completedByDay = new Array<number>(days + 1).fill(0);

  for (const issue of issues) {
    if (issue.state !== "done") continue;
    // KAN-35: use completedAt when available; fall back to cycle endDate for
    // historical issues that have no timestamp (backfill may have left them NULL).
    const ts = issue.completedAt ?? end;
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

  // ── KAN-36: Stepped scopeLine from CycleScopeEvent ─────────────────────────
  //
  // Fallback: no scope events → flat fill(sumPoints(currentMembers)).
  // This preserves backward-compatibility for cycles with no event log.
  if (allScopeEvents.length === 0) {
    const totalScope = sumPoints(issues);
    const scopeLine = new Array(days + 1).fill(totalScope);
    // estMap built from current members (no removedKeys needed for KPI when no events)
    const fallbackEstMap = new Map<string, number>();
    for (const issue of issues) {
      fallbackEstMap.set(issue.key, issue.estimate ?? 1);
    }
    return { burnup, scopeLine, estMap: fallbackEstMap };
  }

  // Build estimate map: current members resolved O(1) from the issues query.
  const estMap = new Map<string, number>();
  for (const issue of issues) {
    estMap.set(issue.key, issue.estimate ?? 1);
  }

  // Keys that appear in scope events but are no longer current members
  // (they were removed mid-cycle, so cycleId = null now).
  const removedKeys = [
    ...new Set(
      allScopeEvents
        .map((e) => e.issueKey)
        .filter((k) => !estMap.has(k)),
    ),
  ];

  // ONE guarded findMany for removed keys — only when there are any.
  if (removedKeys.length > 0) {
    const removedIssues = await prisma.issue.findMany({
      where: { key: { in: removedKeys } },
      select: { key: true, estimate: true },
    });
    for (const ri of removedIssues) {
      estMap.set(ri.key, ri.estimate ?? 1);
    }
    // Keys still missing after lookup (deleted issues) → fallback estimate 1.
    // estMap.get(key) ?? 1 in resolve() handles this.
  }

  const resolve = (key: string): number => estMap.get(key) ?? 1;

  // Build per-day delta array using each event's createdAt timestamp, mirroring
  // burnup's clamp(round((ts - start) / DAY), 0, days). This keeps both series
  // on the SAME x-axis convention (0-based elapsed days) so scopeLine[i] and
  // burnup[i] are always plotted at the same day position on the chart.
  //
  // Initial attaches (createdAt ≈ start, elapsed 0) land at delta[0] → scopeLine[0]
  // reflects the planning baseline. Mid-cycle events land at their true elapsed
  // index — aligned with burnup. The stored event.day is no longer used here.
  const delta = new Array<number>(days + 1).fill(0);
  for (const event of allScopeEvents) {
    const elapsed = Math.max(
      0,
      Math.min(days, Math.round((event.createdAt.getTime() - start.getTime()) / ONE_DAY_MS)),
    );
    delta[elapsed] = (delta[elapsed] ?? 0) + (event.kind === "add" ? resolve(event.issueKey) : -resolve(event.issueKey));
  }

  // Cumulative prefix sum → scopeLine.
  const scopeLine: number[] = [];
  let scopeAcc = 0;
  for (let d = 0; d <= days; d++) {
    scopeAcc += delta[d] ?? 0;
    scopeLine.push(scopeAcc);
  }

  return { burnup, scopeLine, estMap };
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
 *
 * estMap and cycleStart/cycleDays are threaded in from getCycle so the
 * scope-creep rule can compute net points using the same createdAt-elapsed
 * convention as computeBurnup (elapsed >= 1 excludes the planning baseline).
 */
function computeRisks(
  cycle: { dayIndex: number; days: number; scope: number; completed: number },
  issues: Array<{ key: string; state: IssueState; updatedAt: Date }>,
  scopeEvents: CycleScopeEvent[],
  estMap: Map<string, number>,
  cycleStart: Date,
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

  // 3) Heavy mid-cycle scope changes — computed in POINTS using createdAt-elapsed.
  // Events with elapsed >= 1 are mid-cycle (consistent with KPI baseline filter
  // and computeBurnup's day-convention). The stored event.day is NOT used here.
  const resolveEst = (key: string): number => estMap.get(key) ?? 1;
  let netPoints = 0;
  for (const e of scopeEvents) {
    const elapsed = Math.max(
      0,
      Math.min(cycle.days, Math.round((e.createdAt.getTime() - cycleStart.getTime()) / ONE_DAY_MS)),
    );
    if (elapsed >= 1) {
      netPoints += e.kind === "add" ? resolveEst(e.issueKey) : -resolveEst(e.issueKey);
    }
  }
  if (netPoints >= 4) {
    out.push({
      id: "scope-creep",
      severity: "medium",
      title: "Scope expanding mid-cycle",
      detail: `+${netPoints} net points added since planning (mid-cycle drift).`,
      action: "Re-plan",
    });
  }

  return out;
}

export async function listCycles(projectId: string) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project)
    throw new AppError(404, "PROJECT_NOT_FOUND", `Project not found`);
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

  const { burnup, scopeLine, estMap } = await computeBurnup(
    cycle.id,
    cycle.startDate,
    cycle.endDate,
    allScopeEvents,
  );

  // Risk computation MUST see all events; aggregate counts MUST match totals.
  // Thread estMap + cycleStart into computeRisks so the scope-creep rule can
  // compute net points using the same createdAt-elapsed convention as computeBurnup.
  const risks = computeRisks(
    { dayIndex: dIdx, days: tDays, scope, completed },
    cycle.issues,
    allScopeEvents,
    estMap,
    cycle.startDate,
  );

  // KAN-36: scopeAdded/scopeRemoved are point-sums (not counts).
  // Only mid-cycle events (elapsed >= 1) are included — planning-baseline events
  // (elapsed 0, createdAt ≈ cycleStart) are excluded from drift KPIs.
  // The createdAt-elapsed convention is consistent with computeBurnup and
  // computeRisks; event.day is NOT used for this filter.
  // Invariant: scopeAdded - scopeRemoved === scopeLine[days] - scopeLine[0].
  const resolveEst = (key: string): number => estMap.get(key) ?? 1;
  const scopeAdded = allScopeEvents
    .filter((e) => {
      const elapsed = Math.max(0, Math.min(tDays, Math.round((e.createdAt.getTime() - cycle.startDate.getTime()) / ONE_DAY_MS)));
      return e.kind === "add" && elapsed >= 1;
    })
    .reduce((sum, e) => sum + resolveEst(e.issueKey), 0);
  const scopeRemoved = allScopeEvents
    .filter((e) => {
      const elapsed = Math.max(0, Math.min(tDays, Math.round((e.createdAt.getTime() - cycle.startDate.getTime()) / ONE_DAY_MS)));
      return e.kind === "remove" && elapsed >= 1;
    })
    .reduce((sum, e) => sum + resolveEst(e.issueKey), 0);

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
  projectId: string,
  input: CreateCycleInput,
  authorId?: string,
) {
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project)
    throw new AppError(404, "PROJECT_NOT_FOUND", `Project not found`);

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
      `The following issue keys do not belong to project "${project.key}": ${offendingKeys.join(", ")}`,
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
 * KAN-35: `closedAt` is now its own dedicated column set at close time.
 * It is distinct from `updatedAt` and NULL for historical cycles closed
 * before this change was deployed.
 *
 * S5: accepts `actorMemberId` and emits `cycle.closed` event after update
 * so the NotificationService can dispatch cycle-closed emails.
 */
export async function closeCycle(
  id: string,
  opts?: { verbose?: boolean; actorMemberId?: string },
) {
  const cycle = await prisma.cycle.findUnique({
    where: { id },
    include: {
      issues: { select: { estimate: true, state: true } },
      project: { select: { id: true, key: true, name: true, workspaceId: true } },
    },
  });
  if (!cycle) throw new AppError(404, "CYCLE_NOT_FOUND", "Cycle not found");
  const velocity = sumPoints(cycle.issues, (i) => i.state === "done");

  // Compute scope stats for email report
  const completed = cycle.issues.filter((i) => i.state === "done").length;
  const planned = cycle.issues.length;

  // KAN-35: set closedAt as its own dedicated column, distinct from updatedAt.
  const updated = await prisma.cycle.update({
    where: { id },
    data: { state: "done", velocity, closedAt: new Date() },
  });

  // Emit cycle.closed event — fire-and-forget, handler isolation via NotificationService (D3)
  try {
    eventBus.emit({
      type: "cycle.closed",
      workspaceId: cycle.project.workspaceId,
      actorId: opts?.actorMemberId ?? "",
      payload: {
        cycleId: cycle.id,
        cycleName: cycle.name,
        projectId: cycle.project.id,
        projectKey: cycle.project.key,
        projectName: cycle.project.name,
        workspaceId: cycle.project.workspaceId,
        velocity: velocity ?? 0,
        completed,
        planned,
        scopeAdded: 0,   // scope events not yet aggregated at close time
        scopeRemoved: 0,
      },
    });
  } catch {
    // Never let event emission break the mutation
  }

  if (opts?.verbose) {
    return updated;
  }
  return {
    id: updated.id,
    state: updated.state,
    velocity: updated.velocity,
    // KAN-35: source closedAt from its own dedicated column (not updatedAt).
    closedAt: updated.closedAt,
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

// ---------------------------------------------------------------------------
// computeAvgLeadDays — REQ-CYCLE-LEAD-TIME-001..003, REQ-INBOX-CYCLE-004
// ---------------------------------------------------------------------------

/**
 * Compute the average lead time (in decimal days) for issues that were
 * transitioned to "done" within the given cycle.
 *
 * Algorithm (anti N+1, design §3.1):
 *  1. Fetch all issues in the cycle (id + createdAt). If empty → null early return.
 *  2. ONE batch query for all state_changed activity logs for those issueIds.
 *  3. In-memory: filter to logs where details.to === "done", take the
 *     most-recent log per issue, compute delta in days, average.
 *
 * Edge cases:
 *  - 0 issues → null (no extra query issued)
 *  - Issues exist but none have a non-null completedAt → null
 *  - Issue with completedAt === createdAt → 0.0 (not null)
 *  - Mixed (some with, some without completedAt) → average over those with non-null completedAt
 *
 * KAN-35: switched from ActivityLog scan to reading Issue.completedAt directly.
 * Legacy guarantee (isDoneTransition covers both {to:'done'} and {newValue:'done'})
 * is now upheld by the in-migration backfill SQL, not by a runtime log scan.
 */
export async function computeAvgLeadDays(cycleId: string): Promise<number | null> {
  // KAN-35: read completedAt directly from Issue — no ActivityLog query needed.
  const issues = await prisma.issue.findMany({
    where: { cycleId },
    select: { id: true, createdAt: true, completedAt: true },
  });

  if (issues.length === 0) return null;

  // Compute deltas in days; average only over issues with a non-null completedAt.
  const deltas: number[] = [];
  for (const issue of issues) {
    if (!issue.completedAt) continue; // exclude — not yet completed (REQ-CYCLE-LEAD-TIME-001 MUST NOT)
    deltas.push((issue.completedAt.getTime() - issue.createdAt.getTime()) / ONE_DAY_MS);
  }

  if (deltas.length === 0) return null;
  return deltas.reduce((sum, d) => sum + d, 0) / deltas.length;
}

// ---------------------------------------------------------------------------
// resolveActiveCycleForWorkspace — REQ-INBOX-CYCLE-001, REQ-API-DASHBOARD-005
// ---------------------------------------------------------------------------

/**
 * Find the "winning" active cycle for a workspace — the one the Inbox will
 * surface in the CurrentCycleCard.
 *
 * Algorithm (design §3.2):
 *  - ONE query: all cycles with state "active" in non-archived projects of
 *    the workspace, ordered by (startDate DESC, id ASC) for deterministic
 *    tie-breaking.
 *  - If none → null.
 *  - multipleActiveProjects = count of distinct projectIds among all active
 *    cycles > 1.
 *  - Winner = first result (most recent startDate, smallest id on tie).
 */
export async function resolveActiveCycleForWorkspace(workspaceId: string): Promise<{
  cycle: {
    id: string;
    name: string;
    startDate: Date;
    endDate: Date;
    projectId: string;
  };
  projectName: string;
  multipleActiveProjects: boolean;
} | null> {
  const activeCycles = await prisma.cycle.findMany({
    where: {
      state: "active",
      project: { workspaceId, archived: false },
    },
    orderBy: [{ startDate: "desc" }, { id: "asc" }],
    select: {
      id: true,
      name: true,
      startDate: true,
      endDate: true,
      projectId: true,
      project: { select: { name: true } },
    },
  });

  if (activeCycles.length === 0) return null;

  const distinctProjects = new Set(activeCycles.map((c) => c.projectId));
  const winner = activeCycles[0]!;

  return {
    cycle: {
      id: winner.id,
      name: winner.name,
      startDate: winner.startDate,
      endDate: winner.endDate,
      projectId: winner.projectId,
    },
    projectName: winner.project.name,
    multipleActiveProjects: distinctProjects.size > 1,
  };
}

// Re-export deleteCycle for symmetry with the existing service surface
// so routes can import from "./service.js" consistently.
export { deleteCycle } from "./delete-cycle.js";
