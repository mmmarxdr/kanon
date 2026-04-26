import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

const BCRYPT_COST = 12;

async function main() {
  console.log("Seeding database...");

  // ── 1. Create workspace ──────────────────────────────────────────────────
  const workspace = await prisma.workspace.upsert({
    where: { slug: "kanon-dev" },
    update: {},
    create: {
      name: "Kanon Development",
      slug: "kanon-dev",
    },
  });
  console.log(`  Workspace: ${workspace.name} (${workspace.id})`);

  // ── 2. Create user ──────────────────────────────────────────────────────
  const passwordHash = await bcrypt.hash("Password1!", BCRYPT_COST);

  const user = await prisma.user.upsert({
    where: { email: "dev@kanon.io" },
    update: {},
    create: {
      email: "dev@kanon.io",
      passwordHash,
      displayName: "Dev User",
    },
  });
  console.log(`  User: ${user.email} (${user.id})`);

  // ── 3. Create member (workspace membership) ─────────────────────────────
  const member = await prisma.member.upsert({
    where: {
      userId_workspaceId: {
        userId: user.id,
        workspaceId: workspace.id,
      },
    },
    update: {},
    create: {
      username: "dev",
      role: "owner",
      userId: user.id,
      workspaceId: workspace.id,
    },
  });
  console.log(`  Member: ${member.username} (${member.id})`);

  // ── 4. Create project ────────────────────────────────────────────────────
  const project = await prisma.project.upsert({
    where: {
      workspaceId_key: {
        workspaceId: workspace.id,
        key: "KAN",
      },
    },
    update: {},
    create: {
      key: "KAN",
      name: "Kanon",
      description: "The Kanon project tracker itself",
      workspaceId: workspace.id,
    },
  });
  console.log(`  Project: ${project.name} (${project.key})`);

  // ── 5. Mock cycles + issues for the Cycles view ─────────────────────────
  await seedCyclesMock(workspace.id, project.id, project.key, member.id);

  console.log("\nSeed complete! Structural data (workspace, user, member, project) is ready.");
  console.log(`\n  Login credentials:`);
  console.log(`    Email:    dev@kanon.io`);
  console.log(`    Password: Password1!`);
  console.log(`    Workspace slug: kanon-dev`);
}

/* ────────────────────────────────────────────────────────────────
   Cycles mock — only seeded if no cycles exist for this project.
   Creates 4 closed cycles with velocity + 1 active cycle with
   issues, scope events, and a parent state-changed history that
   the burnup chart can pivot on.
   ──────────────────────────────────────────────────────────────── */

async function seedCyclesMock(
  workspaceId: string,
  projectId: string,
  projectKey: string,
  memberId: string,
) {
  const existing = await prisma.cycle.count({ where: { projectId } });
  if (existing > 0) {
    console.log(`  Cycles: ${existing} already present, skipping mock seed.`);
    return;
  }

  // Make sure we have at least one agent member for visual variety.
  const agentMember = await prisma.member.upsert({
    where: { workspaceId_username: { workspaceId, username: "claude-mcp" } },
    update: {},
    create: {
      username: "claude-mcp",
      role: "viewer",
      isAgent: true,
      userId: (await ensureAgentUser()).id,
      workspaceId,
    },
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const dayMs = 24 * 60 * 60 * 1000;

  const closedCycles = [
    { num: 7,  velocity: 27, scope: 28 },
    { num: 8,  velocity: 26, scope: 34 },
    { num: 9,  velocity: 28, scope: 30 },
    { num: 10, velocity: 30, scope: 32 },
    { num: 11, velocity: 34, scope: 36 },
  ];

  // The most recent closed cycle ended just before today's active one.
  let cursor = new Date(today.getTime() - 14 * dayMs * (closedCycles.length + 1));

  for (const c of closedCycles) {
    const start = new Date(cursor.getTime());
    const end = new Date(cursor.getTime() + 14 * dayMs);
    await prisma.cycle.create({
      data: {
        name: `Cycle ${c.num}`,
        goal: `Iteration ${c.num}`,
        state: "done",
        velocity: c.velocity,
        startDate: start,
        endDate: end,
        projectId,
      },
    });
    cursor = end;
  }

  // Active cycle: starts 9 days ago, ends 5 days from now (14-day cycle, day 9).
  const activeStart = new Date(today.getTime() - 9 * dayMs);
  const activeEnd = new Date(today.getTime() + 5 * dayMs);

  const cycle12 = await prisma.cycle.create({
    data: {
      name: "Cycle 12",
      goal: "MCP roadmap polish",
      state: "active",
      startDate: activeStart,
      endDate: activeEnd,
      projectId,
    },
  });

  // Mock issues (estimates in story points). Some already done, some in
  // various states so the burnup chart and stat strip have something to chew.
  const mockIssues = [
    { title: "Stream MCP roadmap proposals into the canvas", state: "in_progress", estimate: 5, doneOnDay: null },
    { title: "Issue auto-grouping (semantic)",                state: "in_progress", estimate: 8, doneOnDay: null },
    { title: "Roadmap drag with snap",                        state: "review",      estimate: 3, doneOnDay: null },
    { title: "Slack thread → issue",                          state: "review",      estimate: 3, doneOnDay: null },
    { title: "Webhook retries with backoff",                  state: "todo",        estimate: 5, doneOnDay: null },
    { title: "Saved views (Inbox)",                           state: "todo",        estimate: 2, doneOnDay: null },
    { title: "Cycle close report PDF",                        state: "todo",        estimate: 3, doneOnDay: null },
    { title: "Edge case: re-parented dep cycle",              state: "done",        estimate: 3, doneOnDay: 8 },
    { title: "Race in agent thread merge",                    state: "done",        estimate: 5, doneOnDay: 7 },
    { title: "SAML group → role mapping",                     state: "done",        estimate: 3, doneOnDay: 5 },
    { title: "Compaction-safe agent thread",                  state: "done",        estimate: 2, doneOnDay: 4 },
    { title: "Engram bridge: high-water-mark caching",        state: "done",        estimate: 3, doneOnDay: 3 },
    { title: "Inbox SSE invalidation",                        state: "done",        estimate: 2, doneOnDay: 6 },
  ] as const;

  // Find the next available sequence num to avoid colliding with anything
  // an integration test may have created earlier.
  const baseSeq =
    ((
      await prisma.issue.aggregate({
        where: { projectId },
        _max: { sequenceNum: true },
      })
    )._max.sequenceNum ?? 0) + 1;

  for (let i = 0; i < mockIssues.length; i++) {
    const m = mockIssues[i]!;
    const seq = baseSeq + i;
    const issue = await prisma.issue.create({
      data: {
        key: `${projectKey}-${seq}`,
        sequenceNum: seq,
        title: m.title,
        type: "feature",
        priority: i < 2 ? "high" : i < 5 ? "medium" : "low",
        state: m.state,
        estimate: m.estimate,
        labels: [],
        projectId,
        assigneeId: memberId,
        cycleId: cycle12.id,
      },
    });

    if (m.state === "done" && m.doneOnDay != null) {
      const ts = new Date(activeStart.getTime() + m.doneOnDay * dayMs);
      // Activity log entry the burnup walker pivots on.
      await prisma.activityLog.create({
        data: {
          issueId: issue.id,
          memberId,
          action: "state_changed",
          details: { oldValue: "review", newValue: "done" },
          createdAt: ts,
        },
      });
    }
  }

  // Scope events (mid-cycle scope drift).
  const scopeEventsData = [
    { day: 1, kind: "add" as const,    issueKey: `${projectKey}-${baseSeq}`,        reason: "Initial planning" },
    { day: 3, kind: "add" as const,    issueKey: `${projectKey}-${baseSeq + 4}`,    reason: "Triage incoming" },
    { day: 4, kind: "remove" as const, issueKey: `${projectKey}-${baseSeq + 11}`,   reason: "Deferred to Cycle 13" },
    { day: 5, kind: "add" as const,    issueKey: `${projectKey}-${baseSeq + 5}`,    reason: "Customer escalation" },
    { day: 7, kind: "remove" as const, issueKey: `${projectKey}-${baseSeq + 12}`,   reason: "Scope split" },
    { day: 8, kind: "add" as const,    issueKey: `${projectKey}-${baseSeq + 6}`,    reason: "Atomic break" },
  ];
  await prisma.cycleScopeEvent.createMany({
    data: scopeEventsData.map((e) => ({
      cycleId: cycle12.id,
      day: e.day,
      kind: e.kind,
      issueKey: e.issueKey,
      reason: e.reason,
      authorId: memberId,
    })),
  });

  // Active agent on one of the in-progress issues so the inbox rail + agent
  // stripe on cards have something to render.
  const inProgress = await prisma.issue.findFirst({
    where: { cycleId: cycle12.id, state: "in_progress" },
    select: { id: true },
  });
  if (inProgress) {
    await prisma.workSession.create({
      data: {
        issueId: inProgress.id,
        memberId: agentMember.id,
        userId: agentMember.userId,
        source: "claude-mcp",
        startedAt: new Date(today.getTime() - 12 * 60 * 1000),
        lastHeartbeat: new Date(),
      },
    });
  }

  console.log(
    `  Cycles seeded: ${closedCycles.length} closed + 1 active (Cycle 12) with ${mockIssues.length} issues.`,
  );
}

async function ensureAgentUser() {
  const passwordHash = await bcrypt.hash("agent-no-login-" + Date.now(), 4);
  return prisma.user.upsert({
    where: { email: "claude-mcp@kanon.local" },
    update: {},
    create: {
      email: "claude-mcp@kanon.local",
      passwordHash,
      displayName: "Claude · MCP",
    },
  });
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
