import type { CycleScopeEvent, IssueState } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 1-based day index inside a cycle (clamped to [1, totalDays]).
 */
function dayIndex(start: Date, end: Date, now: Date = new Date()): number {
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

export async function getCycle(id: string) {
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
      scopeEvents: {
        orderBy: { day: "asc" },
        include: {
          author: { select: { id: true, username: true, isAgent: true } },
        },
      },
    },
  });
  if (!cycle) throw new AppError(404, "CYCLE_NOT_FOUND", "Cycle not found");

  const dIdx = dayIndex(cycle.startDate, cycle.endDate);
  const tDays = totalDays(cycle.startDate, cycle.endDate);
  const scope = sumPoints(cycle.issues);
  const completed = sumPoints(cycle.issues, (i) => i.state === "done");

  const { burnup, scopeLine } = await computeBurnup(
    cycle.id,
    cycle.startDate,
    cycle.endDate,
  );

  const risks = computeRisks(
    { dayIndex: dIdx, days: tDays, scope, completed },
    cycle.issues,
    cycle.scopeEvents,
  );

  // Aggregate scope add/remove counts for the header
  const scopeAdded = cycle.scopeEvents.filter((e) => e.kind === "add").length;
  const scopeRemoved = cycle.scopeEvents.filter((e) => e.kind === "remove").length;

  return {
    ...cycle,
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
}

export async function createCycle(projectKey: string, input: CreateCycleInput) {
  const project = await prisma.project.findFirst({ where: { key: projectKey } });
  if (!project)
    throw new AppError(404, "PROJECT_NOT_FOUND", `Project "${projectKey}" not found`);

  // If the new cycle is active, demote any other active cycle to done.
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

export async function closeCycle(id: string) {
  const cycle = await prisma.cycle.findUnique({
    where: { id },
    include: {
      issues: { select: { estimate: true, state: true } },
    },
  });
  if (!cycle) throw new AppError(404, "CYCLE_NOT_FOUND", "Cycle not found");
  const velocity = sumPoints(cycle.issues, (i) => i.state === "done");
  return prisma.cycle.update({
    where: { id },
    data: { state: "done", velocity },
  });
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
    select: { id: true, projectId: true, startDate: true, endDate: true },
  });
  if (!cycle) throw new AppError(404, "CYCLE_NOT_FOUND", "Cycle not found");

  const day = dayIndex(cycle.startDate, cycle.endDate);

  await prisma.$transaction(async (tx) => {
    if (input.add?.length) {
      await tx.issue.updateMany({
        where: { key: { in: input.add }, projectId: cycle.projectId },
        data: { cycleId: cycle.id },
      });
      await tx.cycleScopeEvent.createMany({
        data: input.add.map((key) => ({
          cycleId: cycle.id,
          day,
          kind: "add" as const,
          issueKey: key,
          reason: input.reason,
          authorId: input.authorId,
        })),
      });
    }
    if (input.remove?.length) {
      await tx.issue.updateMany({
        where: { key: { in: input.remove }, cycleId: cycle.id },
        data: { cycleId: null },
      });
      await tx.cycleScopeEvent.createMany({
        data: input.remove.map((key) => ({
          cycleId: cycle.id,
          day,
          kind: "remove" as const,
          issueKey: key,
          reason: input.reason,
          authorId: input.authorId,
        })),
      });
    }
  });

  return getCycle(cycleId);
}
