/**
 * Forecast service — KAN-102 PR2, optimised in KAN-113.
 *
 * rebuildProjectForecast(projectId) is an internal exported function (no HTTP
 * endpoint v1 — decision #9). It is called by the forecast listener after a
 * debounced event fires, and may also be called directly as a job.
 *
 * Architecture:
 *   1. Load graph in 6 parallel queries (Promise.all) — includes workspaceId and interruptions.
 *   2. Convert Prisma Decimal → number at the loader boundary.
 *   3. Call computeForecast() — pure engine, zero I/O.
 *   4. Compute desired IssueForecast rows; batch writes in a transaction:
 *        a. createMany for new rows (skipDuplicates safety net).
 *        b. Parallel updates for changed rows (hash changed).
 *        c. Parallel milestone status updates (upcoming ↔ at_risk only; SKIP met/missed).
 *        d. One McpProposal dedup query + createMany for over-threshold slips.
 *   5. Emit ppm.forecast.updated AFTER transaction commit (fire-and-forget).
 *   6. Return ForecastStats.
 *
 * KAN-113 optimizations:
 *   - workspaceId folded into the 4-loader Promise.all → 5-loader Promise.all.
 *   - IssueForecast: per-issue await upsert loop → createMany + parallel updates.
 *   - McpProposal: per-slip findFirst loop (N+1) → one findMany + createMany.
 *   - Milestone updates: sequential awaits → Promise.all.
 *   - All writes wrapped in prisma.$transaction.
 *   - Decimal handling: estimateHours consistently uses .toNumber() (was parseFloat).
 *   - Pure decision logic imported from rules.ts (mutation-testable).
 */
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { env } from "../../config/env.js";
import { computeForecast, type WorkingCalendar } from "./engine.js";
import { computeForecastHash, proposalExceedsThreshold, milestoneIsManual } from "./rules.js";
import type { ForecastNode, ForecastEdge, ForecastMilestoneInput, ForecastStats } from "./types.js";

// ─── Working calendar defaults (KAN-147, ADR-0007) ───────────────────────────

/** Default working days when a project has no ProjectScheduleConfig: Mon–Fri. */
const DEFAULT_WORK_DAYS = [1, 2, 3, 4, 5];

/**
 * Build the engine WorkingCalendar from a project's (optional) schedule config.
 * Absent config ⇒ Mon–Fri + no holidays (ADR-0007 default, zero backfill).
 */
function buildWorkingCalendar(config: {
  workDays: number[];
  holidays: string[];
} | null): WorkingCalendar {
  const workDays =
    config && config.workDays.length > 0 ? config.workDays : DEFAULT_WORK_DAYS;
  const holidays = new Set(config?.holidays ?? []);
  return { workDays, holidays };
}

/**
 * Stable fingerprint of a calendar for the per-issue inputsHash. Sorting both
 * lists makes the fingerprint order-insensitive so a reorder doesn't force a
 * needless rebuild while any real membership change does.
 */
function calendarFingerprint(calendar: WorkingCalendar): string {
  const days = [...calendar.workDays].sort((a, b) => a - b).join(",");
  const hols = [...calendar.holidays].sort().join(",");
  return `${days}|${hols}`;
}

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
    // Prisma returns Decimal objects for Decimal fields; typed accordingly.
    estimateHours: { toNumber(): number } | null;
  } | null;
}

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

// ─── Main export ─────────────────────────────────────────────────────────────

/**
 * Options for rebuildProjectForecast.
 *
 * All fields default to false (i.e. standard event-driven rebuild behaviour).
 * Only the bootstrap path in the timeline read should set these flags.
 */
export interface RebuildOptions {
  /**
   * When true, suppress all write-on-read side-effects:
   *   - McpProposal creation (step 7d) is skipped.
   *   - Milestone status updates (step 7c) are skipped — flipping milestone
   *     status on a GET can fire milestone-status notifications.
   *   - ppm.forecast.updated event emission (step 8) is skipped.
   *
   * ONLY IssueForecast row writes (steps 7a/7b) are preserved — the Gantt
   * reads those directly and needs them on first load.
   *
   * Use this when calling from a read path (lazy bootstrap) to avoid
   * write-on-read surprises and a cluttered proposal queue.
   *
   * Default: false — full standard event-driven rebuild behaviour.
   */
  suppressSideEffects?: boolean;
}

/**
 * Full project forecast rebuild.
 *
 * Idempotent: calling multiple times produces the same row count as issue count.
 * Skip-on-no-change: if inputsHash is unchanged from the stored row, the write
 * is skipped entirely (computedAt is NOT updated).
 *
 * @param projectId - UUID of the project to rebuild.
 * @param opts      - Optional flags; default behaviour (proposals + events) is unchanged.
 * @returns ForecastStats — thin summary for the event payload.
 */
export async function rebuildProjectForecast(
  projectId: string,
  opts?: RebuildOptions,
): Promise<ForecastStats> {
  const suppressSideEffects = opts?.suppressSideEffects ?? false;
  const hoursPerDay = env.FORECAST_HOURS_PER_DAY;
  const atRiskBufferDays = env.FORECAST_AT_RISK_BUFFER_DAYS;

  // ── Step 1: Load project graph in 6 parallel queries ────────────────────
  // workspaceId is folded in here (was a separate sequential query in the
  // original service, running after the upsert loop — now free via parallelism).
  // KAN-103 PR3: interruptions loader added as 6th query.
  const now = new Date();
  const [issues, approvedHoursRows, dependencies, deliverables, project, interruptionRows] = await Promise.all([
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

    // Loader 5: project workspaceId + working-day calendar (KAN-147).
    prisma.project.findUnique({
      where: { id: projectId },
      select: {
        workspaceId: true,
        scheduleConfig: { select: { workDays: true, holidays: true } },
      },
    }),

    // Loader 6: KAN-103 PR3 — interruptions for issues in this project.
    // Open interruptions (endedAt null) use `now` as end — slip is visible immediately.
    prisma.interruption.findMany({
      where: { interruptedIssue: { projectId } },
      select: { interruptedIssueId: true, startedAt: true, endedAt: true },
    }),
  ]);

  const workspaceId = project?.workspaceId;

  // KAN-147 (ADR-0007): build the working-day calendar for this project. Absent
  // config ⇒ Mon–Fri + no holidays. The fingerprint is folded into every
  // issue's inputsHash so a calendar change invalidates the dedup gate.
  const calendar = buildWorkingCalendar(project?.scheduleConfig ?? null);
  const calFingerprint = calendarFingerprint(calendar);

  // ── Step 1b: Build interruptedDaysMap (KAN-103 PR3) ─────────────────────
  // For each interrupted issue, accumulate displaced milliseconds across all
  // interruptions (open or closed). Open ones (endedAt null) use `now` as end
  // so an active incident shows slip immediately and grows until closed.
  //
  // KAN-103: ignore sub-30-min switches so brief context-switches don't inflate
  // the forecast by a full day.
  const MIN_INTERRUPTION_MS = 30 * 60 * 1000;
  const interruptedMsMap = new Map<string, number>();
  for (const row of interruptionRows) {
    const endMs = (row.endedAt ?? now).getTime();
    const startMs = row.startedAt.getTime();
    const displacedMs = Math.max(0, endMs - startMs);
    if (displacedMs < MIN_INTERRUPTION_MS) continue;
    interruptedMsMap.set(
      row.interruptedIssueId,
      (interruptedMsMap.get(row.interruptedIssueId) ?? 0) + displacedMs,
    );
  }
  const interruptedDaysMap = new Map<string, number>();
  for (const [issueId, totalMs] of interruptedMsMap) {
    interruptedDaysMap.set(issueId, Math.ceil(totalMs / 86_400_000));
  }

  // ── Step 2: Convert Decimal → number at the boundary ────────────────────
  // Prisma groupBy returns Decimal objects for Decimal fields. We call .toNumber()
  // (Prisma's Decimal class method) to get a plain JS number before passing to the engine.
  const approvedHoursMap = new Map<string, number>();
  for (const row of approvedHoursRows) {
    if (row.issueId === null) continue; // guard (filtered above, but be safe)
    const raw = row._sum.hours;
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
    // estimateHours is a Prisma Decimal object; use .toNumber() consistently.
    // (The approved-hours path already used .toNumber(); this aligns the two.)
    const rawEst = sched?.estimateHours ?? null;
    const estimateHoursNum = rawEst !== null && rawEst !== undefined ? rawEst.toNumber() : null;
    return {
      issueId: issue.id,
      startDate: sched?.startDate ?? null,
      dueDate: sched?.dueDate ?? null,
      estimateHours:
        estimateHoursNum !== null && !isNaN(estimateHoursNum) ? estimateHoursNum : null,
      progress: sched?.progress ?? 0,
      state: issue.state,
      completedAt: issue.completedAt,
      loggedH: approvedHoursMap.get(issue.id) ?? 0,
      interruptedDays: interruptedDaysMap.get(issue.id) ?? 0,
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
  const result = computeForecast(
    { nodes, edges, milestones },
    { hoursPerDay, atRiskBufferDays, calendar },
  );

  // ── Step 5: Load existing IssueForecast rows for hash comparison ─────────
  // One query outside the transaction (read-only, no need to lock).
  const existingRows = await prisma.issueForecast.findMany({
    where: { issue: { projectId } },
    select: { issueId: true, inputsHash: true },
  });
  const existingMap = new Map(existingRows.map((r) => [r.issueId, r]));

  const issueKeyMap = new Map(issues.map((i) => [i.id, i.key]));
  const computedAt = new Date();

  // ── Step 6: Compute desired write sets ──────────────────────────────────
  // Apply the inputsHash skip gate exactly as before: skip if hash unchanged.
  interface CreateRow {
    issueId: string;
    forecastStart: Date | null;
    forecastEnd: Date | null;
    slipDays: number;
    critical: boolean;
    floatDays: number | null;
    inputsHash: string;
    computedAt: Date;
  }
  const toCreate: CreateRow[] = [];
  const toUpdate: CreateRow[] = [];

  for (const node of nodes) {
    const entry = result.forecasts.get(node.issueId);
    if (!entry) continue;

    const inputsHash = computeForecastHash(entry, calFingerprint);
    const existing = existingMap.get(node.issueId);

    if (existing?.inputsHash === inputsHash) {
      // Computed forecast unchanged → skip write (idempotent, no computedAt update)
      continue;
    }

    const row: CreateRow = {
      issueId: node.issueId,
      forecastStart: entry.forecastStart,
      forecastEnd: entry.forecastEnd,
      slipDays: entry.slipDays,
      critical: entry.critical,
      floatDays: entry.floatDays,
      inputsHash,
      computedAt,
    };

    if (existing === undefined) {
      toCreate.push(row);
    } else {
      toUpdate.push(row);
    }
  }

  // Milestone updates: collect only those that need a status change (skip manual)
  const milestoneUpdates = result.milestoneRollups.filter(
    (rollup) =>
      !milestoneIsManual(rollup.currentStatus) && rollup.computedStatus !== rollup.currentStatus
  );

  // McpProposal: collect over-threshold slips, dedup in one query.
  // Skipped on the bootstrap read path (suppressSideEffects) — no point
  // building candidates we will never write.
  interface ProposalCandidate {
    issueKey: string;
    slip: { issueId: string; slipDays: number; critical: boolean };
  }
  const proposalCandidates: ProposalCandidate[] = [];

  if (!suppressSideEffects && workspaceId) {
    for (const slip of result.slips) {
      if (!proposalExceedsThreshold(slip)) continue;
      const issueKey = issueKeyMap.get(slip.issueId);
      if (!issueKey) continue;
      proposalCandidates.push({ issueKey, slip });
    }
  }

  // ── Step 7: Wrap writes in a single transaction ──────────────────────────
  // Reads (loaders + existingRows) are outside the transaction — they are
  // idempotent and don't need rollback semantics. Only writes are wrapped.
  await prisma.$transaction(async (tx) => {
    // 7a. IssueForecast: batch create new rows
    if (toCreate.length > 0) {
      await tx.issueForecast.createMany({
        data: toCreate,
        skipDuplicates: true, // safety net: race-condition guard
      });
    }

    // 7b. IssueForecast: parallel updates for changed rows
    if (toUpdate.length > 0) {
      await Promise.all(
        toUpdate.map((r) =>
          tx.issueForecast.update({
            where: { issueId: r.issueId },
            data: {
              forecastStart: r.forecastStart,
              forecastEnd: r.forecastEnd,
              slipDays: r.slipDays,
              critical: r.critical,
              floatDays: r.floatDays,
              inputsHash: r.inputsHash,
              computedAt: r.computedAt,
            },
          })
        )
      );
    }

    // 7c. Milestone status updates (parallel).
    // Skipped on the bootstrap read path (suppressSideEffects) — flipping milestone
    // status on a GET can fire milestone-status notifications (write-on-read concern).
    // The Gantt reads IssueForecast, not Milestone.status, so this is safe to omit.
    if (!suppressSideEffects && milestoneUpdates.length > 0) {
      await Promise.all(
        milestoneUpdates.map((rollup) =>
          tx.milestone.update({
            where: { id: rollup.milestoneId },
            data: { status: rollup.computedStatus as "upcoming" | "at_risk" },
          })
        )
      );
    }

    // 7d. McpProposal: one dedup query + createMany
    // Skipped on the bootstrap read path (suppressSideEffects) — write-on-read concern.
    if (!suppressSideEffects && workspaceId && proposalCandidates.length > 0) {
      const candidateKeys = proposalCandidates.map((c) => c.issueKey);

      // One findMany instead of N findFirst calls (kills the N+1)
      const existingProposals = await tx.mcpProposal.findMany({
        where: {
          // KAN-116: dedup is workspace-local (matches the partial unique index on
          // (workspace_id, target_ref)). target_ref = issue key, unique only per
          // workspace, so an unscoped read could skip a legitimately-new proposal.
          workspaceId,
          targetRef: { in: candidateKeys },
          status: "pending",
          kind: "generic",
        },
        select: { targetRef: true },
      });
      const existingProposalRefs = new Set(existingProposals.map((p) => p.targetRef));

      const newProposals = proposalCandidates
        .filter((c) => !existingProposalRefs.has(c.issueKey))
        .map((c) => {
          const entry = result.forecasts.get(c.slip.issueId);
          return {
            workspaceId: workspaceId,
            projectId,
            kind: "generic" as const,
            status: "pending" as const,
            targetRef: c.issueKey,
            title: `Forecast slip: ${c.issueKey} is ${c.slip.slipDays} day(s) late`,
            reason: c.slip.critical
              ? `Issue ${c.issueKey} is on the critical path and slipping by ${c.slip.slipDays} day(s).`
              : `Issue ${c.issueKey} is slipping by ${c.slip.slipDays} day(s) (>2 days threshold).`,
            payload: {
              issueId: c.slip.issueId,
              issueKey: c.issueKey,
              slipDays: c.slip.slipDays,
              forecastEnd: entry?.forecastEnd?.toISOString() ?? null,
              suggestion: "Review schedule and adjust dependencies or scope.",
              critical: c.slip.critical,
            },
            generatedBy: "forecast-engine",
          };
        });

      if (newProposals.length > 0) {
        await tx.mcpProposal.createMany({
          data: newProposals,
          skipDuplicates: true, // extra dedup safety (targetRef is not unique-indexed, but safe)
        });
      }
    }
  });

  // ── Step 8: Emit ppm.forecast.updated AFTER transaction commit ────────────
  // Fire-and-forget; emission errors must not block the caller.
  // worstSlipDays = max positive slip across project, 0 if all ahead/on-time (decision #13).
  // Skip emission when the project (hence workspace) vanished mid-rebuild — there is
  // no workspace to announce to, and an empty workspaceId would be a malformed event.
  // Also skip on the bootstrap read path (suppressSideEffects) — write-on-read concern.
  if (!suppressSideEffects && workspaceId) {
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
