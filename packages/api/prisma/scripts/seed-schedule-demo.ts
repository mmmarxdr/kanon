/**
 * Synthetic schedule demo seed.
 *
 * Builds a realistic PPM dataset in a dedicated "SYN" project so the schedule
 * Gantt (three-plane + forecast) has something meaningful to render, and so the
 * W4 features can be verified by eye:
 *   - KAN-145: overdue in_progress work (plan start in the past) → anchored slip
 *   - KAN-146: approved TimeEntries so logged hours feed the engine
 *   - KAN-148: a ~4-month horizon so zoom/fit is exercisable
 *   - KAN-149: a typed dependency network (FS/SS/FF/SF + lag)
 *   - KAN-150: a real critical path (engine-computed critical/floatDays)
 *
 * IMPORTANT: nothing here is pre-computed. We seed only raw inputs
 * (issues, schedules, dependencies, time entries, baselines) and then call the
 * real rebuildProjectForecast() so the engine computes forecastStart/End,
 * critical, floatDays and slipDays — exactly as production would.
 *
 * Run: pnpm --filter @kanon/api seed:schedule-demo
 * Idempotent: wipes and recreates the SYN project on each run.
 */

import { prisma } from "../../src/config/prisma.js";
import { rebuildProjectForecast } from "../../src/modules/forecast/service.js";

const DAY = 24 * 60 * 60 * 1000;
const today = new Date();
today.setUTCHours(0, 0, 0, 0);

/** today + n days at UTC midnight. */
function day(n: number): Date {
  return new Date(today.getTime() + n * DAY);
}

type Dep = { to: string; type: "FS" | "SS" | "FF" | "SF" | "blocks"; lag?: number };

interface SeedIssue {
  key: string;
  title: string;
  state: string;
  /** plan start/due, in days relative to today */
  start: number;
  due: number;
  estimateH: number;
  progress?: number;
  /** approved hours logged against the issue (feeds engine loggedH) */
  loggedH?: number;
  /** baseline (original commitment) start/due in days, to populate the baseline ghost */
  baseline?: [number, number];
  /** outgoing typed dependency edges (this issue is the source) */
  deps?: Dep[];
  completedDay?: number;
}

// A small program with a TIGHT critical chain (Design→Build→Integrate→Launch),
// contiguous so the backward pass keeps the whole chain critical (float 0), plus
// side branches with deliberately small/large slack. Estimates are at 8h/day, so
// e.g. 40h = 5 days. Dates are contiguous (successor starts where predecessor's
// forecast ends) so float is genuine CPM output, not an artifact of loose gaps.
// "today" sits mid-project so in_progress bars straddle the today line.
const ISSUES: SeedIssue[] = [
  {
    key: "DESIGN",
    title: "[Platform] Design the ingestion API",
    state: "done",
    start: -10,
    due: -5,
    estimateH: 40, // 5d → ends day -5
    progress: 100,
    loggedH: 38,
    baseline: [-12, -6],
    completedDay: -5,
    deps: [{ to: "BUILD", type: "FS", lag: 0 }],
  },
  {
    key: "BUILD",
    title: "[Platform] Build the ingestion API",
    state: "in_progress",
    start: -5,
    due: 2, // forecast ends ~+5 → slip ~3 (KAN-150 slip gap)
    estimateH: 80, // 10d → ends day +5
    progress: 40,
    loggedH: 36,
    baseline: [-5, 3],
    deps: [{ to: "INTEGRATE", type: "FS", lag: 0 }],
  },
  {
    key: "FE",
    title: "[Web] Build the ingestion dashboard",
    state: "in_progress",
    start: -5,
    due: 6,
    estimateH: 64, // 8d → ends day +3; INTEGRATE forced to +5 by BUILD → float ~2 (near-critical)
    progress: 35,
    loggedH: 20,
    deps: [{ to: "INTEGRATE", type: "FS", lag: 0 }],
  },
  {
    key: "DOCS",
    title: "[Docs] Write the ingestion guide",
    state: "todo",
    start: -3,
    due: 20,
    estimateH: 16, // 2d, huge window → comfortable float
    deps: [{ to: "LAUNCH", type: "FS", lag: 0 }],
  },
  {
    key: "INTEGRATE",
    title: "[Platform] Integration + load test",
    state: "todo",
    start: 5,
    due: 10,
    estimateH: 40, // 5d → ends day +10
    baseline: [4, 9],
    deps: [{ to: "LAUNCH", type: "FS", lag: 0 }],
  },
  {
    key: "SEC",
    title: "[Platform] Security review",
    state: "todo",
    start: 6,
    due: 12,
    estimateH: 24, // finishes alongside LAUNCH → FF
    deps: [{ to: "LAUNCH", type: "FF", lag: 0 }],
  },
  {
    key: "LAUNCH",
    title: "[Platform] GA launch",
    state: "todo",
    start: 10,
    due: 12,
    estimateH: 16, // 2d → ends day +12 (project end)
    baseline: [9, 11],
  },
  {
    key: "SPIKE",
    title: "[Platform] Spike: alternative queue backend",
    state: "in_progress",
    start: -18, // badly overdue in_progress, no deps (shows anchoring once KAN-145 lands)
    due: -4,
    estimateH: 40,
    progress: 20,
    loggedH: 10,
  },
  {
    key: "RESEARCH",
    title: "[Platform] Research: schema migration path",
    state: "done",
    start: -24,
    due: -16,
    estimateH: 24,
    progress: 100,
    loggedH: 22,
    completedDay: -16,
  },
];

async function main() {
  console.log("Seeding synthetic schedule demo (SYN)…");

  // Reuse the dev workspace/user/member from the base seed.
  const workspace = await prisma.workspace.upsert({
    where: { slug: "kanon-dev" },
    update: {},
    create: { name: "Kanon Development", slug: "kanon-dev" },
  });
  const user = await prisma.user.findFirst({ where: { email: "dev@kanon.io" } });
  if (!user) {
    throw new Error("Run `pnpm db:seed` first — dev@kanon.io user is missing.");
  }
  const member = await prisma.member.findFirstOrThrow({
    where: { userId: user.id, workspaceId: workspace.id },
  });

  // Fresh SYN project each run (cascade clears schedules/deps/forecast/issues).
  await prisma.project.deleteMany({ where: { workspaceId: workspace.id, key: "SYN" } });
  const project = await prisma.project.create({
    data: {
      key: "SYN",
      name: "Schedule Synthetics",
      description: "Synthetic dataset to exercise the PPM forecast engine + Gantt.",
      workspaceId: workspace.id,
      lastSequenceNum: ISSUES.length,
    },
  });
  console.log(`  Project: ${project.name} (${project.key})`);

  // 1) Issues + schedules + time entries.
  const idByKey = new Map<string, string>();
  for (let i = 0; i < ISSUES.length; i++) {
    const s = ISSUES[i]!;
    const issue = await prisma.issue.create({
      data: {
        key: `SYN-${i + 1}`,
        sequenceNum: i + 1,
        title: s.title,
        type: "feature",
        state: s.state,
        priority: "medium",
        labels: [],
        projectId: project.id,
        assigneeId: member.id,
        completedAt: s.completedDay != null ? day(s.completedDay) : null,
      },
    });
    idByKey.set(s.key, issue.id);

    await prisma.issueSchedule.create({
      data: {
        issueId: issue.id,
        startDate: day(s.start),
        dueDate: day(s.due),
        estimateHours: s.estimateH,
        progress: s.progress ?? 0,
        baselineStart: s.baseline ? day(s.baseline[0]) : null,
        baselineEnd: s.baseline ? day(s.baseline[1]) : null,
      },
    });

    if (s.loggedH && s.loggedH > 0) {
      await prisma.timeEntry.create({
        data: {
          memberId: member.id,
          issueId: issue.id,
          hours: s.loggedH,
          workedOn: day(s.start),
          status: "approved",
          approvedById: member.id,
        },
      });
    }
  }

  // 2) Typed dependency edges (source → target).
  let depCount = 0;
  for (const s of ISSUES) {
    const sourceId = idByKey.get(s.key)!;
    for (const d of s.deps ?? []) {
      const targetId = idByKey.get(d.to);
      if (!targetId) continue;
      await prisma.issueDependency.create({
        data: { sourceId, targetId, type: d.type, lagDays: d.lag ?? 0 },
      });
      depCount++;
    }
  }
  console.log(`  Issues: ${ISSUES.length}, dependencies: ${depCount}`);

  // 3) Let the ENGINE compute forecasts (critical/float/forecastEnd/slip).
  const stats = await rebuildProjectForecast(project.id);
  console.log(
    `  Engine forecast: ${stats.issueCount} issues, ${stats.criticalCount} critical, worst slip ${stats.worstSlipDays}d`,
  );
  console.log("\nDone. Log in as dev@kanon.io / Password123! and open project SYN → Schedule.");
}

main()
  .catch((err) => {
    console.error("Synthetic seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
