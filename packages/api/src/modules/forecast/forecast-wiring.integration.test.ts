/**
 * Smoke test — app wiring: registerForecastListener (KAN-102 PR2 / Phase 9).
 *
 * Proves that buildApp() actually registers the forecast listener on the real
 * eventBus so that domain events trigger a real database rebuild end-to-end.
 *
 * Timing strategy (real timers, default debounce):
 *   The listener is built with env.FORECAST_DEBOUNCE_MS (default 3000ms).
 *   In vitest singleFork mode the env._env cache is shared across test files
 *   so vi.stubEnv cannot lower the debounce after it is cached. We therefore
 *   wait for the full debounce window plus a generous buffer for real DB I/O:
 *
 *     wait = FORECAST_DEBOUNCE_MS(3000) + Prisma-findUnique(~50ms)
 *           + rebuildProjectForecast(~200ms) + safety margin = 3500ms total.
 *
 *   No fake timers — mixing vi.useFakeTimers() with real Prisma I/O is
 *   non-deterministic (fake timers do not control OS-level I/O callbacks).
 *   A real 3500ms wait is deterministic and well within testTimeout(15000ms).
 *
 * Requires:
 *   - kanon_test DB up (kanon-postgres-1) with 20260615005259_ppm_w3_issue_forecast
 *     migration applied.
 *   - app.ts must import and register registerForecastListener (Phase 9 task 9.2).
 */

import {
  describe,
  it,
  expect,
  beforeAll,
  afterAll,
  beforeEach,
} from "vitest";
import type { FastifyInstance } from "fastify";
import {
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
  createTestApp,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";

// ── Test-local DB helpers (mirrors forecast.integration.test.ts) ───────────────

async function cleanForecastData(): Promise<void> {
  await prisma.mcpProposal.deleteMany();
  await prisma.issueForecast.deleteMany();
  await prisma.milestoneDeliverable.deleteMany();
  await prisma.milestone.deleteMany();
  await prisma.issueDependency.deleteMany();
  await prisma.issueSchedule.deleteMany();
}

async function seedProjectContext() {
  const ws = await seedTestWorkspace();
  const owner = await seedTestMemberWithRole(ws.id, "owner");
  const project = await seedTestProject(ws.id);
  return { workspaceId: ws.id, projectId: project.id, ownerId: owner.id };
}

async function seedScheduledIssue(
  projectId: string,
  key: string,
  seqNum: number,
  opts: {
    startDate?: Date;
    dueDate?: Date;
    estimateHours?: number;
    progress?: number;
  } = {}
) {
  const issue = await prisma.issue.create({
    data: {
      key,
      title: `Issue ${key}`,
      type: "task",
      state: "in_progress",
      projectId,
      sequenceNum: seqNum,
    },
  });

  if (
    opts.startDate !== undefined ||
    opts.dueDate !== undefined ||
    opts.estimateHours !== undefined ||
    opts.progress !== undefined
  ) {
    await prisma.issueSchedule.create({
      data: {
        issueId: issue.id,
        startDate: opts.startDate ?? null,
        dueDate: opts.dueDate ?? null,
        estimateHours: opts.estimateHours ?? null,
        progress: opts.progress ?? 0,
      },
    });
  }

  return issue;
}

// ─────────────────────────────────────────────────────────────────────────────

let app: FastifyInstance;

beforeAll(async () => {
  app = await createTestApp();
});

afterAll(async () => {
  await app.close();
  await disconnectTestDb();
});

beforeEach(async () => {
  await cleanForecastData();
  await cleanDatabase();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("App wiring smoke test — registerForecastListener (Phase 9)", () => {
  it("9.2 — emitting schedule-config.updated on the real eventBus triggers a forecast rebuild (KAN-147)", async () => {
    // Seed: workspace + member + project + issue with a schedule
    const { workspaceId, projectId, ownerId } = await seedProjectContext();
    await seedScheduledIssue(projectId, "KFW-CAL-1", 1, {
      startDate: new Date("2026-06-01"),
      estimateHours: 8,
    });

    // Confirm no forecast rows yet
    const before = await prisma.issueForecast.findMany({
      where: { issue: { projectId } },
    });
    expect(before).toHaveLength(0);

    // Emit schedule-config.updated — the forecast listener handles it directly
    // by projectId (no issue resolution step needed). The rebuild writes
    // issue_forecasts rows just like any other trigger.
    eventBus.emit({
      type: "schedule-config.updated",
      workspaceId,
      actorId: ownerId,
      payload: { projectId },
    });

    // Poll: wait for the debounce to fire and the rebuild to write rows.
    const deadline = 3000 + 5000;
    const startedAt = Date.now();
    let after = await prisma.issueForecast.findMany({ where: { issue: { projectId } } });
    while (after.length === 0 && Date.now() - startedAt < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      after = await prisma.issueForecast.findMany({ where: { issue: { projectId } } });
    }

    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const row of after) {
      expect(row.computedAt).toBeDefined();
    }

    void ownerId;
  });

  it("9.1 — emitting schedule.updated on the real eventBus triggers a forecast rebuild end-to-end", async () => {
    // Seed: workspace + member + project + issue with a schedule
    const { workspaceId, projectId, ownerId } = await seedProjectContext();
    const issue = await seedScheduledIssue(projectId, "KFW-1", 1, {
      startDate: new Date("2026-06-01"),
      dueDate: new Date("2026-06-11"),
      estimateHours: 8,
    });

    // Confirm no forecast rows yet
    const before = await prisma.issueForecast.findMany({
      where: { issue: { projectId } },
    });
    expect(before).toHaveLength(0);

    // Emit a schedule.updated event on the real singleton eventBus.
    // The forecast listener (registered by buildApp via app.ts wiring) will:
    //   1. Resolve projectId from issueId (Prisma DB lookup)
    //   2. Schedule a trailing debounce for projectId (FORECAST_DEBOUNCE_MS, 3000ms)
    //   3. When it fires: call rebuildProjectForecast(projectId) — real service, real DB
    //   4. Service writes issue_forecasts rows and emits ppm.forecast.updated
    eventBus.emit({
      type: "schedule.updated",
      workspaceId,
      actorId: ownerId,
      payload: { issueId: issue.id, progress: 0 },
    });

    // We can't shorten the debounce (env is a cached Proxy, shared across files in
    // singleFork) and fake timers don't control Prisma's real I/O — so poll for the
    // rebuild's side-effect: wait past the debounce window, re-querying until rows
    // appear or a hard cap is hit. Deterministic and non-flaky: it passes as soon as
    // the rebuild lands (~3s) and only fails if nothing appears within the cap.
    const deadline = 3000 + 5000; // debounce window + generous real-I/O cap
    const startedAt = Date.now();
    let after = await prisma.issueForecast.findMany({ where: { issue: { projectId } } });
    while (after.length === 0 && Date.now() - startedAt < deadline) {
      await new Promise<void>((resolve) => setTimeout(resolve, 150));
      after = await prisma.issueForecast.findMany({ where: { issue: { projectId } } });
    }

    // Assert: issue_forecasts rows were created for the seeded project
    expect(after.length).toBeGreaterThanOrEqual(1);
    for (const row of after) {
      expect(row.issueId).toBe(issue.id);
      expect(row.computedAt).toBeDefined();
    }

    void ownerId;
  });
});
