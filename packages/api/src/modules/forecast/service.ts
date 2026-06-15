/**
 * Forecast service — KAN-102 PR2.
 *
 * rebuildProjectForecast(projectId) is an internal exported function (no HTTP
 * endpoint v1 — decision #9). It is called by the forecast listener (Phase 8)
 * after a debounced event fires, and may also be called directly as a job.
 *
 * Architecture:
 *   1. Load graph in 4 bounded parallel queries (Promise.all).
 *   2. Convert Prisma Decimal → number at the loader boundary.
 *   3. Call computeForecast() — pure engine, zero I/O.
 *   4. Persist each IssueForecast row; skip write when inputsHash is unchanged.
 *   5. Roll up Milestone.status (upcoming ↔ at_risk only; SKIP met/missed).
 *   6. Create McpProposal for escalation-worthy slips (dedup by targetRef+pending+generic).
 *   7. Emit ppm.forecast.updated with thin payload.
 *   8. Return ForecastStats.
 */
import { createHash } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { env } from "../../config/env.js";
import { computeForecast } from "./engine.js";
import type {
  ForecastNode,
  ForecastEdge,
  ForecastMilestoneInput,
  ForecastStats,
  IssueForecastEntry,
} from "./types.js";

// ─── Loader types (internal) ─────────────────────────────────────────────────

interface IssueRow {
  id: string;
  key: string;
  state: string;
  completedAt: Date | null;
  projectId: string;
  schedule: {
    startDate: Date | null;
    dueDate: Date | null;
    progress: number;
    estimateHours: string | null; // Prisma returns Decimal as string at JSON boundary
  } | null;
}

// Note: Prisma groupBy returns Decimal objects for Decimal fields.
// We extract the value via .toNumber() at the boundary (see approvedHoursMap build below).

interface DependencyRow {
  sourceId: string;
  targetId: string;
  type: string;
  lagDays: number;
}

interface DeliverableRow {
  issueId: string;
  milestoneId: string;
  milestone: {
    id: string;
    target: Date;
    status: string;
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** SHA-256 hex of a deterministic string. Used for the skip-on-no-change gate. */
function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

/**
 * Hash of an issue's COMPUTED forecast output (stored in the inputsHash column).
 *
 * We key the skip-write gate on the OUTPUT, NOT on the issue's local inputs.
 * This is a forward-pass/CPM engine: a successor's forecast changes when an
 * upstream predecessor slips, while the successor's OWN inputs (estimate,
 * progress, logged hours, dates, dep structure) stay identical. An input-keyed
 * hash would skip the successor's write and leave its row stale, silently
 * dropping propagated slip — the core behaviour of this engine. Hashing the
 * output makes the gate change exactly when the persisted forecast would.
 */
function computeForecastHash(entry: IssueForecastEntry): string {
  const payload = JSON.stringify({
    forecastStart: entry.forecastStart?.toISOString() ?? null,
    forecastEnd: entry.forecastEnd?.toISOString() ?? null,
    slipDays: entry.slipDays,
    critical: entry.critical,
    floatDays: entry.floatDays,
  });
  return sha256(payload);
}

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Full project forecast rebuild.
 *
 * Idempotent: calling multiple times produces the same row count as issue count.
 * Skip-on-no-change: if inputsHash is unchanged from the stored row, the upsert
 * is skipped entirely (computedAt is NOT updated).
 *
 * @param projectId - UUID of the project to rebuild.
 * @returns ForecastStats — thin summary for the event payload.
 */
export async function rebuildProjectForecast(projectId: string): Promise<ForecastStats> {
  const hoursPerDay = env.FORECAST_HOURS_PER_DAY;
  const atRiskBufferDays = env.FORECAST_AT_RISK_BUFFER_DAYS;

  // ── Step 1: Load project graph in 4 parallel queries ────────────────────
  const [issues, approvedHoursRows, dependencies, deliverables] = await Promise.all([
    // Loader 1: issues + schedule for this project
    prisma.issue.findMany({
      where: { projectId },
      select: {
        id: true,
        key: true,
        state: true,
        completedAt: true,
        projectId: true,
        schedule: {
          select: {
            startDate: true,
            dueDate: true,
            progress: true,
            estimateHours: true,
          },
        },
      },
    }) as Promise<IssueRow[]>,

    // Loader 2: approved TimeEntry hours, grouped by issueId
    // Decision #12: null issueId (issue-less work) → SKIP (filter issueId!=null)
    prisma.timeEntry.groupBy({
      by: ["issueId"],
      where: {
        issue: { projectId },
        status: "approved",
        issueId: { not: null },
      },
      _sum: { hours: true },
    }),

    // Loader 3: dependencies where source issue belongs to this project
    prisma.issueDependency.findMany({
      where: { source: { projectId } },
      select: { sourceId: true, targetId: true, type: true, lagDays: true },
    }) as Promise<DependencyRow[]>,

    // Loader 4: milestone deliverables with milestone context
    prisma.milestoneDeliverable.findMany({
      where: { milestone: { projectId } },
      select: {
        issueId: true,
        milestoneId: true,
        milestone: {
          select: { id: true, target: true, status: true },
        },
      },
    }) as Promise<DeliverableRow[]>,
  ]);

  // ── Step 2: Convert Decimal → number at the boundary ────────────────────
  // Prisma groupBy returns Decimal objects for Decimal fields. We call .toNumber()
  // (Prisma's Decimal class method) to get a plain JS number before passing to the engine.
  const approvedHoursMap = new Map<string, number>();
  for (const row of approvedHoursRows) {
    if (row.issueId === null) continue; // guard (filtered above, but be safe)
    const raw = row._sum.hours;
    // Prisma Decimal has .toNumber(); fall back to Number() for safety.
    const h =
      raw !== null && raw !== undefined
        ? typeof (raw as { toNumber?: () => number }).toNumber === "function"
          ? (raw as { toNumber: () => number }).toNumber()
          : Number(raw)
        : 0;
    approvedHoursMap.set(row.issueId, h);
  }

  // ── Step 3: Build engine input ───────────────────────────────────────────
  const nodes: ForecastNode[] = issues.map((issue) => {
    const sched = issue.schedule;
    const rawEst = sched?.estimateHours ?? null;
    const estimateHours = rawEst !== null && rawEst !== undefined ? parseFloat(rawEst) : null;
    return {
      issueId: issue.id,
      startDate: sched?.startDate ?? null,
      dueDate: sched?.dueDate ?? null,
      estimateHours: estimateHours !== null && !isNaN(estimateHours) ? estimateHours : null,
      progress: sched?.progress ?? 0,
      state: issue.state,
      completedAt: issue.completedAt,
      loggedH: approvedHoursMap.get(issue.id) ?? 0,
    };
  });

  const edges: ForecastEdge[] = dependencies
    .filter((d): d is DependencyRow & { type: ForecastEdge["type"] } =>
      ["FS", "SS", "FF", "SF", "blocks"].includes(d.type)
    )
    .map((d) => ({
      source: d.sourceId,
      target: d.targetId,
      type: d.type as ForecastEdge["type"],
      lagDays: d.lagDays,
    }));

  // Build milestone inputs (group deliverables by milestone)
  const milestoneMap = new Map<
    string,
    { id: string; target: Date; status: string; deliverableIssueIds: string[] }
  >();
  for (const d of deliverables) {
    const m = d.milestone;
    if (!milestoneMap.has(m.id)) {
      milestoneMap.set(m.id, {
        id: m.id,
        target: m.target,
        status: m.status,
        deliverableIssueIds: [],
      });
    }
    milestoneMap.get(m.id)!.deliverableIssueIds.push(d.issueId);
  }
  const milestones: ForecastMilestoneInput[] = Array.from(milestoneMap.values());

  // ── Step 4: Run pure engine ──────────────────────────────────────────────
  const result = computeForecast({ nodes, edges, milestones }, { hoursPerDay, atRiskBufferDays });

  // ── Step 5: Persist IssueForecast rows (skip if computed forecast unchanged) ──
  const computedAt = new Date();

  // Load existing rows in one query for hash comparison
  const existingRows = await prisma.issueForecast.findMany({
    where: { issue: { projectId } },
    select: { issueId: true, inputsHash: true, computedAt: true },
  });
  const existingMap = new Map(existingRows.map((r) => [r.issueId, r]));

  const issueKeyMap = new Map(issues.map((i) => [i.id, i.key]));

  for (const node of nodes) {
    const entry = result.forecasts.get(node.issueId);
    if (!entry) continue;

    const inputsHash = computeForecastHash(entry);

    const existing = existingMap.get(node.issueId);
    if (existing?.inputsHash === inputsHash) {
      // Computed forecast unchanged → skip write (idempotent, no computedAt update)
      continue;
    }

    await prisma.issueForecast.upsert({
      where: { issueId: node.issueId },
      update: {
        forecastStart: entry.forecastStart,
        forecastEnd: entry.forecastEnd,
        slipDays: entry.slipDays,
        critical: entry.critical,
        floatDays: entry.floatDays,
        inputsHash,
        computedAt,
      },
      create: {
        issueId: node.issueId,
        forecastStart: entry.forecastStart,
        forecastEnd: entry.forecastEnd,
        slipDays: entry.slipDays,
        critical: entry.critical,
        floatDays: entry.floatDays,
        inputsHash,
        computedAt,
      },
    });
  }

  // ── Step 6: Milestone rollup (upcoming ↔ at_risk only; SKIP met/missed) ──
  for (const rollup of result.milestoneRollups) {
    // INVARIANT: engine only writes upcoming/at_risk; never met/missed.
    // SKIP if milestone is already met or missed.
    if (rollup.currentStatus === "met" || rollup.currentStatus === "missed") {
      continue;
    }

    if (rollup.computedStatus !== rollup.currentStatus) {
      await prisma.milestone.update({
        where: { id: rollup.milestoneId },
        data: { status: rollup.computedStatus as "upcoming" | "at_risk" },
      });
    }
  }

  // ── Step 7: McpProposal escalation (dedup by targetRef+pending+generic) ──
  // Fetch workspace for proposal FK
  const project = await prisma.project.findUnique({
    where: { id: projectId },
    select: { workspaceId: true },
  });
  const workspaceId = project?.workspaceId;

  if (workspaceId) {
    for (const slip of result.slips) {
      // Thresholds: any slip on critical path; > 2 days elsewhere (decision #7)
      const overThreshold = slip.critical ? slip.slipDays > 0 : slip.slipDays > 2;
      if (!overThreshold) continue;

      const issueKey = issueKeyMap.get(slip.issueId);
      if (!issueKey) continue;

      const entry = result.forecasts.get(slip.issueId);

      // Dedup: skip if a pending generic proposal already exists for this targetRef
      const existing = await prisma.mcpProposal.findFirst({
        where: { targetRef: issueKey, status: "pending", kind: "generic" },
        select: { id: true },
      });
      if (existing) continue;

      await prisma.mcpProposal.create({
        data: {
          workspaceId,
          projectId,
          kind: "generic",
          status: "pending",
          targetRef: issueKey,
          title: `Forecast slip: ${issueKey} is ${slip.slipDays} day(s) late`,
          reason: slip.critical
            ? `Issue ${issueKey} is on the critical path and slipping by ${slip.slipDays} day(s).`
            : `Issue ${issueKey} is slipping by ${slip.slipDays} day(s) (>${2} days threshold).`,
          payload: {
            issueId: slip.issueId,
            issueKey,
            slipDays: slip.slipDays,
            forecastEnd: entry?.forecastEnd?.toISOString() ?? null,
            suggestion: "Review schedule and adjust dependencies or scope.",
            critical: slip.critical,
          },
          generatedBy: "forecast-engine",
        },
      });
    }
  }

  // ── Step 8: Emit ppm.forecast.updated (thin payload — decision #8) ───────
  // Fire-and-forget; emission errors must not block the caller.
  // worstSlipDays = max positive slip across project, 0 if all ahead/on-time (decision #13).
  // Skip emission when the project (hence workspace) vanished mid-rebuild — there is
  // no workspace to announce to, and an empty workspaceId would be a malformed event.
  if (workspaceId) {
    try {
      eventBus.emit({
        type: "ppm.forecast.updated",
        workspaceId,
        actorId: "forecast-engine",
        payload: {
          projectId,
          issueCount: result.stats.issueCount,
          criticalCount: result.stats.criticalCount,
          worstSlipDays: result.stats.worstSlipDays,
        },
      });
    } catch {
      // Fire-and-forget: log suppressed; a forecast bug must never break a caller
    }
  }

  return result.stats;
}
