/**
 * Integration tests: GET /api/projects/:key/schedule-timeline (KAN-105 PR1, KAN-153).
 *
 * Covers:
 * - Project with mixed issues (full schedule+forecast, schedule-only, bare)
 *   asserts shape, null-handling, and that bare issues still appear
 * - Non-member gets 403; project member gets 200
 * - Unknown project key returns 404
 * - Empty project returns envelope { rows: [], total: 0, truncated: false, projectTotal: 0, unscheduled: 0 }
 * - KAN-153: cycleId param, from/to params, envelope response shape
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { rebuildProjectForecast } from "../forecast/service.js";
import { addWorkingDays } from "../forecast/engine.js";

describe("Schedule Timeline Routes (integration)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ── Helpers ────────────────────────────────────────────────────────────

  async function seedProjectContext() {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id);
    await seedTestProjectMember(member.userId, project.id, "member");
    return { ws, member, project };
  }

  // ── GET /api/projects/:key/schedule-timeline ────────────────────────

  describe("GET /api/projects/:key/schedule-timeline", () => {
    it("STL-1: returns envelope with empty rows for a project with no issues", async () => {
      const { member, project } = await seedProjectContext();

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ rows: [], total: 0, truncated: false, projectTotal: 0, unscheduled: 0 });
    });

    it("STL-2: 404 for non-member (project not visible outside their workspace)", async () => {
      const { project } = await seedProjectContext();
      // A member from a completely different workspace — requireProjectMember scopes
      // project lookup to workspaces the user belongs to, so a cross-workspace outsider
      // gets PROJECT_NOT_FOUND (404), not 403. This matches the roadmap route behaviour.
      const ws2 = await seedTestWorkspace();
      const outsider = await seedTestMemberWithRole(ws2.id, "member");

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${outsider.token}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it("STL-2b: 403 for workspace member without ProjectMember row", async () => {
      const { ws, project } = await seedProjectContext();
      // Member of the same workspace but no ProjectMember row for this project
      const nonProjectMember = await seedTestMemberWithRole(ws.id, "member");
      // Intentionally no seedTestProjectMember call

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${nonProjectMember.token}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it("STL-3: 404 for unknown project key", async () => {
      const { member } = await seedProjectContext();

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/DOES-NOT-EXIST/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(404);
    });

    it("STL-4: includes fully-scheduled+forecast issue with all fields", async () => {
      const { member, project } = await seedProjectContext();

      const issue = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "Fully scheduled",
          type: "task",
          state: "in_progress",
          projectId: project.id,
          sequenceNum: 1,
        },
      });

      // IssueSchedule (plan + baseline)
      await prisma.issueSchedule.create({
        data: {
          issueId: issue.id,
          startDate: new Date("2026-07-01T00:00:00.000Z"),
          dueDate: new Date("2026-07-31T00:00:00.000Z"),
          progress: 50,
          baselineStart: new Date("2026-06-01T00:00:00.000Z"),
          baselineEnd: new Date("2026-06-30T00:00:00.000Z"),
        },
      });

      // IssueForecast
      await prisma.issueForecast.create({
        data: {
          issueId: issue.id,
          forecastStart: new Date("2026-07-05T00:00:00.000Z"),
          forecastEnd: new Date("2026-08-05T00:00:00.000Z"),
          slipDays: 5,
          critical: true,
          floatDays: 3,
          computedAt: new Date(),
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // KAN-153: envelope shape
      expect(body.total).toBe(1);
      expect(body.truncated).toBe(false);
      expect(body.rows).toHaveLength(1);

      const row = body.rows[0];
      expect(row.issueId).toBe(issue.id);
      expect(row.issueKey).toBe(issue.key);
      expect(row.title).toBe("Fully scheduled");
      expect(row.state).toBe("in_progress");
      expect(row.type).toBe("task");

      // Plan plane
      expect(row.startDate).toBe("2026-07-01T00:00:00.000Z");
      expect(row.dueDate).toBe("2026-07-31T00:00:00.000Z");
      expect(row.progress).toBe(50);

      // Baseline plane
      expect(row.baselineStart).toBe("2026-06-01T00:00:00.000Z");
      expect(row.baselineEnd).toBe("2026-06-30T00:00:00.000Z");

      // Forecast plane
      expect(row.forecastStart).toBe("2026-07-05T00:00:00.000Z");
      expect(row.forecastEnd).toBe("2026-08-05T00:00:00.000Z");
      expect(row.slipDays).toBe(5);
      expect(row.critical).toBe(true);
      expect(row.floatDays).toBe(3);

      // KAN-153: isNeighbor default
      expect(row.isNeighbor).toBe(false);
    });

    it("STL-5: schedule-only issue (no estimate) gets a bootstrapped forecast — forecastEnd falls back to dueDate (KAN-161)", async () => {
      const { member, project } = await seedProjectContext();

      const issue = await prisma.issue.create({
        data: {
          key: `${project.key}-2`,
          title: "Schedule only",
          type: "feature",
          state: "todo",
          projectId: project.id,
          sequenceNum: 2,
        },
      });

      await prisma.issueSchedule.create({
        data: {
          issueId: issue.id,
          startDate: new Date("2026-08-01T00:00:00.000Z"),
          dueDate: new Date("2026-08-31T00:00:00.000Z"),
          progress: 0,
        },
      });
      // No IssueForecast row

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rows).toHaveLength(1);

      const row = body.rows[0];
      // Plan start is the raw stored date (not snapped).
      expect(row.startDate).toBe("2026-08-01T00:00:00.000Z");
      // KAN-161: the lazy bootstrap rebuilt the forecast on read. With no estimate,
      // forecastEnd falls back to the dueDate; forecastStart is populated (snapped
      // to a working day by the calendar engine). slip/critical are no longer null.
      expect(row.forecastStart).not.toBeNull();
      expect(row.forecastEnd).toBe("2026-08-31T00:00:00.000Z");
      expect(row.slipDays).toBe(0);
      expect(typeof row.critical).toBe("boolean");
    });

    it("STL-6: bare issue (no schedule) gets a bootstrapped forecast row — null dates, slip 0, not critical (KAN-161)", async () => {
      const { member, project } = await seedProjectContext();

      const bare = await prisma.issue.create({
        data: {
          key: `${project.key}-3`,
          title: "Bare issue",
          type: "bug",
          state: "backlog",
          projectId: project.id,
          sequenceNum: 3,
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rows).toHaveLength(1);

      const row = body.rows[0];
      expect(row.issueId).toBe(bare.id);
      expect(row.progress).toBe(0);
      expect(row.startDate).toBeNull();
      expect(row.dueDate).toBeNull();
      expect(row.baselineStart).toBeNull();
      expect(row.baselineEnd).toBeNull();
      // KAN-161: a forecast row is now bootstrapped on read. A bare issue has no
      // startDate so it is unschedulable — forecast dates stay null — but the row
      // exists with slipDays 0 (no dueDate) and critical false.
      expect(row.forecastStart).toBeNull();
      expect(row.forecastEnd).toBeNull();
      expect(row.slipDays).toBe(0);
      expect(row.critical).toBe(false);
      expect(row.floatDays).toBeNull();
    });

    it("STL-7: mixed project returns all issues regardless of schedule/forecast presence", async () => {
      const { member, project } = await seedProjectContext();

      // Create 3 issues: full, schedule-only, bare
      const full = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "Full",
          type: "task",
          state: "backlog",
          projectId: project.id,
          sequenceNum: 1,
        },
      });
      await prisma.issueSchedule.create({
        data: { issueId: full.id, progress: 10 },
      });
      await prisma.issueForecast.create({
        data: {
          issueId: full.id,
          slipDays: 0,
          critical: false,
          computedAt: new Date(),
        },
      });

      const scheduleOnly = await prisma.issue.create({
        data: {
          key: `${project.key}-2`,
          title: "Schedule only",
          type: "task",
          state: "backlog",
          projectId: project.id,
          sequenceNum: 2,
        },
      });
      // Add IssueSchedule so this is genuinely schedule-only (no IssueForecast)
      await prisma.issueSchedule.create({
        data: { issueId: scheduleOnly.id, progress: 0 },
      });

      await prisma.issue.create({
        data: {
          key: `${project.key}-3`,
          title: "Bare",
          type: "task",
          state: "backlog",
          projectId: project.id,
          sequenceNum: 3,
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // All 3 issues must appear (small project escape hatch, total <= 60)
      expect(body.rows).toHaveLength(3);
      expect(body.total).toBe(3);
      expect(body.truncated).toBe(false);
    });

    it("STL-8: cross-workspace same key — member of WS-A sees only WS-A issues (never WS-B)", async () => {
      // Seed workspace A with project key "ACME" and one issue
      const wsA = await seedTestWorkspace();
      const memberA = await seedTestMemberWithRole(wsA.id, "member");
      const projectA = await seedTestProject(wsA.id, "ACME");
      await seedTestProjectMember(memberA.userId, projectA.id, "member");
      await prisma.issue.create({
        data: {
          key: "ACME-1",
          title: "WS-A issue",
          type: "task",
          state: "backlog",
          projectId: projectA.id,
          sequenceNum: 1,
        },
      });

      // Seed workspace B with a DIFFERENT project also keyed "ACME" and one issue
      const wsB = await seedTestWorkspace();
      const projectB = await seedTestProject(wsB.id, "ACME");
      await prisma.issue.create({
        data: {
          key: "ACME-B-1",
          title: "WS-B issue",
          type: "task",
          state: "backlog",
          projectId: projectB.id,
          sequenceNum: 1,
        },
      });

      // memberA (only in WS-A) calls the endpoint with key "ACME"
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/ACME/schedule-timeline`,
        headers: { authorization: `Bearer ${memberA.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Must return exactly WS-A's issue — never WS-B's
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].title).toBe("WS-A issue");
    });

    it("STL-9: cross-workspace same key — outsider with no membership in either workspace gets 404", async () => {
      // Seed workspace A with project key "ACME"
      const wsA = await seedTestWorkspace();
      const projectA = await seedTestProject(wsA.id, "ACME");
      await prisma.issue.create({
        data: {
          key: "ACME-2",
          title: "WS-A issue 2",
          type: "task",
          state: "backlog",
          projectId: projectA.id,
          sequenceNum: 1,
        },
      });

      // Outsider in an unrelated workspace — no membership in WS-A
      const wsOther = await seedTestWorkspace();
      const outsider = await seedTestMemberWithRole(wsOther.id, "member");

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/ACME/schedule-timeline`,
        headers: { authorization: `Bearer ${outsider.token}` },
      });

      // requireProjectRole scopes lookup to the caller's workspaces — ACME
      // does not exist in wsOther, so the middleware returns 404
      expect(res.statusCode).toBe(404);
    });

    // ── KAN-153: scoping filter tests ─────────────────────────────────────

    it("STL-10: ?cycleId returns only issues in that cycle", async () => {
      const { member, project } = await seedProjectContext();

      // Create a cycle
      const cycle = await prisma.cycle.create({
        data: {
          name: "Sprint 1",
          state: "active",
          startDate: new Date("2026-07-01T00:00:00.000Z"),
          endDate: new Date("2026-07-14T00:00:00.000Z"),
          projectId: project.id,
        },
      });

      // Issue in the cycle
      await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "In cycle",
          type: "task",
          state: "todo",
          projectId: project.id,
          sequenceNum: 1,
          cycleId: cycle.id,
        },
      });

      // Issue NOT in the cycle
      await prisma.issue.create({
        data: {
          key: `${project.key}-2`,
          title: "Not in cycle",
          type: "task",
          state: "todo",
          projectId: project.id,
          sequenceNum: 2,
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline?cycleId=${cycle.id}`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].title).toBe("In cycle");
      expect(body.total).toBe(1);
      expect(body.truncated).toBe(false);
    });

    it("STL-11: ?from=&to= returns issues whose plan OR forecast span overlaps the window", async () => {
      const { member, project } = await seedProjectContext();

      // Issue whose plan span overlaps [2026-07-01, 2026-07-31]
      const inWindow = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "In window",
          type: "task",
          state: "todo",
          projectId: project.id,
          sequenceNum: 1,
        },
      });
      await prisma.issueSchedule.create({
        data: {
          issueId: inWindow.id,
          startDate: new Date("2026-07-10T00:00:00.000Z"),
          dueDate: new Date("2026-07-20T00:00:00.000Z"),
          progress: 0,
        },
      });

      // Issue whose PLAN span is entirely before the window, but it is an OPEN
      // (todo) overdue issue. On read the endpoint lazily bootstraps its forecast
      // (KAN-161), and an overdue non-terminal issue is anchored to today
      // (KAN-145): its forecastStart/forecastEnd collapse to start-of-day today.
      // Today is inside the July window, so it DOES overlap via its forecast span
      // and is correctly returned. The window filter matches plan OR forecast.
      const outWindow = await prisma.issue.create({
        data: {
          key: `${project.key}-2`,
          title: "Out of window",
          type: "task",
          state: "todo",
          projectId: project.id,
          sequenceNum: 2,
        },
      });
      await prisma.issueSchedule.create({
        data: {
          issueId: outWindow.id,
          startDate: new Date("2026-05-01T00:00:00.000Z"),
          dueDate: new Date("2026-06-01T00:00:00.000Z"),
          progress: 0,
        },
      });

      // Issue with no plan dates (bare) — no forecast start either, so it never
      // matches a date window and stays excluded.
      await prisma.issue.create({
        data: {
          key: `${project.key}-3`,
          title: "Unscheduled",
          type: "task",
          state: "backlog",
          projectId: project.id,
          sequenceNum: 3,
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline?from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Both the plan-overlap issue and the forecast-overlap (today-anchored,
      // overdue open todo) issue are present; the bare issue is still excluded.
      expect(body.rows).toHaveLength(2);
      const titles = body.rows.map((r: { title: string }) => r.title).sort();
      expect(titles).toEqual(["In window", "Out of window"]);
      expect(body.total).toBe(2);

      // Lock the today-anchoring deterministically AND weekend-robustly: the
      // overdue open todo's forecast span collapses to the start of the next
      // WORKING day (default Mon–Fri calendar, KAN-147/ADR-0007). On a weekday
      // that is start-of-day today; on a weekend it rolls forward to Monday.
      // Mirror the engine's own anchor so the assert never depends on which
      // weekday CI happens to run (previously flaked every Sat/Sun).
      const startOfToday = new Date();
      startOfToday.setUTCHours(0, 0, 0, 0);
      const anchorIso = addWorkingDays(startOfToday, 0, {
        workDays: [1, 2, 3, 4, 5],
        holidays: new Set<string>(),
      }).toISOString();
      const outRow = body.rows.find((r: { title: string }) => r.title === "Out of window");
      expect(outRow.forecastStart).toBe(anchorIso);
      expect(outRow.forecastEnd).toBe(anchorIso);
    });

    it("STL-12: from/to window matches forecast-only issue (no plan dates)", async () => {
      const { member, project } = await seedProjectContext();

      // Issue with forecast span overlapping the window but NO plan dates
      const forecastOnly = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "Forecast only in window",
          type: "task",
          state: "todo",
          projectId: project.id,
          sequenceNum: 1,
        },
      });
      await prisma.issueForecast.create({
        data: {
          issueId: forecastOnly.id,
          forecastStart: new Date("2026-07-15T00:00:00.000Z"),
          forecastEnd: new Date("2026-07-25T00:00:00.000Z"),
          slipDays: 0,
          critical: false,
          computedAt: new Date(),
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline?from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].title).toBe("Forecast only in window");
    });

    it("STL-13: default behavior with active cycle returns only cycle issues", async () => {
      const { member, project } = await seedProjectContext();

      const cycle = await prisma.cycle.create({
        data: {
          name: "Active Sprint",
          state: "active",
          startDate: new Date("2026-07-01T00:00:00.000Z"),
          endDate: new Date("2026-07-14T00:00:00.000Z"),
          projectId: project.id,
        },
      });

      // Create > 60 issues so small-project escape hatch does NOT fire
      const issueData = Array.from({ length: 61 }, (_, i) => ({
        key: `${project.key}-${i + 1}`,
        title: i === 0 ? "Cycle issue" : `Backlog ${i}`,
        type: "task" as const,
        state: "backlog" as const,
        projectId: project.id,
        sequenceNum: i + 1,
        cycleId: i === 0 ? cycle.id : null,
      }));

      for (const data of issueData) {
        await prisma.issue.create({ data });
      }

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Only the cycle issue should be returned
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].title).toBe("Cycle issue");
      expect(body.total).toBe(1);
    });

    it("STL-15: a cross-project dependency does not pull a foreign issue into the timeline (KAN-162)", async () => {
      const { member, project, ws } = await seedProjectContext();

      // In-scope issue in the requested project
      const local = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "Local issue",
          type: "task",
          state: "backlog",
          projectId: project.id,
          sequenceNum: 1,
        },
      });

      // A second project in the SAME workspace with its own issue
      const foreignProject = await seedTestProject(ws.id, "FGN");
      const foreign = await prisma.issue.create({
        data: {
          key: "FGN-1",
          title: "Foreign issue",
          type: "task",
          state: "backlog",
          projectId: foreignProject.id,
          sequenceNum: 1,
        },
      });

      // Cross-project dependency edges in BOTH directions (the schema permits it —
      // FK is on Issue.id only). local→foreign exercises the target-scoped edge
      // query; foreign→local exercises the source-scoped one.
      await prisma.issueDependency.create({
        data: { sourceId: local.id, targetId: foreign.id, type: "blocks" },
      });
      await prisma.issueDependency.create({
        data: { sourceId: foreign.id, targetId: local.id, type: "blocks" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Only the local issue — the foreign neighbor must never leak in
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].title).toBe("Local issue");
      expect(body.rows.some((r: { title: string }) => r.title === "Foreign issue")).toBe(false);
    });

    it("STL-14: response envelope has correct shape (rows, total, truncated)", async () => {
      const { member, project } = await seedProjectContext();

      await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "Issue A",
          type: "task",
          state: "todo",
          projectId: project.id,
          sequenceNum: 1,
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Envelope fields
      expect(body).toHaveProperty("rows");
      expect(body).toHaveProperty("total");
      expect(body).toHaveProperty("truncated");
      expect(Array.isArray(body.rows)).toBe(true);
      expect(typeof body.total).toBe("number");
      expect(typeof body.truncated).toBe("boolean");
    });

    it("STL-16: bootstraps forecast for ALL issues on first read — self-limiting invariant (KAN-161)", async () => {
      const { member, project } = await seedProjectContext();

      // Multi-issue project: one scheduled, one bare, one schedule-only.
      // None have IssueForecast rows — simulates a freshly onboarded project.
      const scheduled = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "Scheduled with estimate",
          type: "task",
          state: "todo",
          projectId: project.id,
          sequenceNum: 1,
        },
      });
      await prisma.issueSchedule.create({
        data: {
          issueId: scheduled.id,
          startDate: new Date("2026-07-01T00:00:00.000Z"),
          dueDate: new Date("2026-07-31T00:00:00.000Z"),
          progress: 0,
          estimateHours: 16,
        },
      });

      const bare = await prisma.issue.create({
        data: {
          key: `${project.key}-2`,
          title: "Bare issue (no schedule)",
          type: "bug",
          state: "backlog",
          projectId: project.id,
          sequenceNum: 2,
        },
      });

      const scheduleOnly = await prisma.issue.create({
        data: {
          key: `${project.key}-3`,
          title: "Schedule only (no estimate)",
          type: "feature",
          state: "todo",
          projectId: project.id,
          sequenceNum: 3,
        },
      });
      await prisma.issueSchedule.create({
        data: {
          issueId: scheduleOnly.id,
          startDate: new Date("2026-08-01T00:00:00.000Z"),
          dueDate: new Date("2026-08-31T00:00:00.000Z"),
          progress: 0,
        },
      });

      // Precondition: zero forecast rows for this project.
      expect(
        await prisma.issueForecast.count({ where: { issue: { projectId: project.id } } }),
      ).toBe(0);

      // ── First GET ─────────────────────────────────────────────────────────
      const res1 = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res1.statusCode).toBe(200);
      const body1 = res1.json();
      expect(body1.rows).toHaveLength(3);

      // The bootstrap must create exactly ONE IssueForecast row per issue.
      // forecastCount === issueCount proves the self-limiting invariant.
      const forecastCountAfterFirst = await prisma.issueForecast.count({
        where: { issue: { projectId: project.id } },
      });
      expect(forecastCountAfterFirst).toBe(3);

      // The scheduled issue should have non-null forecast dates.
      const scheduledRow = body1.rows.find((r: { issueKey: string }) => r.issueKey === scheduled.key);
      expect(scheduledRow).toBeDefined();
      expect(scheduledRow.forecastStart).not.toBeNull();
      expect(scheduledRow.forecastEnd).not.toBeNull();
      expect(scheduledRow.critical).not.toBeNull();

      // ── Second GET — no re-rebuild ────────────────────────────────────────
      const res2 = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res2.statusCode).toBe(200);

      // Row count must remain at 3 — no re-rebuild created extra rows.
      const forecastCountAfterSecond = await prisma.issueForecast.count({
        where: { issue: { projectId: project.id } },
      });
      expect(forecastCountAfterSecond).toBe(3);
    });

    it("STL-18: bootstrap suppresses proposals + ppm.forecast.updated; default rebuild creates both (KAN-161)", async () => {
      const { member, project } = await seedProjectContext();

      // Seed an already-slipping issue: startDate + dueDate well in the past,
      // with an estimate — this is exactly the profile that causes the normal
      // event-driven rebuild to emit an over-threshold slip and create a proposal.
      const slipping = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "Slipping issue",
          type: "task",
          state: "in_progress",
          projectId: project.id,
          sequenceNum: 1,
        },
      });
      await prisma.issueSchedule.create({
        data: {
          issueId: slipping.id,
          startDate: new Date("2025-01-01T00:00:00.000Z"),
          dueDate: new Date("2025-01-15T00:00:00.000Z"),
          progress: 0,
          estimateHours: 40,
        },
      });

      // Precondition: no forecast rows, no proposals.
      expect(
        await prisma.issueForecast.count({ where: { issue: { projectId: project.id } } }),
      ).toBe(0);
      expect(
        await prisma.mcpProposal.count({ where: { projectId: project.id } }),
      ).toBe(0);

      // Spy on eventBus.emit BEFORE the GET so we capture bootstrap emissions.
      const emitSpy = vi.spyOn(eventBus, "emit");

      // ── Bootstrap GET (suppressSideEffects path) ──────────────────────────
      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);

      // IssueForecast rows ARE written (Gantt needs them).
      expect(
        await prisma.issueForecast.count({ where: { issue: { projectId: project.id } } }),
      ).toBe(1);

      // McpProposals must NOT be created on the bootstrap/read path.
      expect(
        await prisma.mcpProposal.count({ where: { projectId: project.id } }),
      ).toBe(0);

      // ppm.forecast.updated must NOT have been emitted during the bootstrap GET.
      const bootstrapForecastEvents = emitSpy.mock.calls.filter(
        (call) => (call[0] as { type: string }).type === "ppm.forecast.updated",
      );
      expect(bootstrapForecastEvents).toHaveLength(0);

      emitSpy.mockClear();

      // ── Causal proof: default rebuild (no suppressSideEffects) DOES create proposals + event ──
      // Delete the existing IssueForecast row so the rebuild is not a no-op (hash-skip gate).
      await prisma.issueForecast.deleteMany({ where: { issue: { projectId: project.id } } });

      await rebuildProjectForecast(project.id); // default opts — full side-effects

      // A proposal MUST now exist — proves suppression in the bootstrap was causal.
      expect(
        await prisma.mcpProposal.count({ where: { projectId: project.id } }),
      ).toBeGreaterThan(0);

      // ppm.forecast.updated MUST have been emitted on the default-rebuild path.
      const defaultForecastEvents = emitSpy.mock.calls.filter(
        (call) => (call[0] as { type: string }).type === "ppm.forecast.updated",
      );
      expect(defaultForecastEvents).toHaveLength(1);

      emitSpy.mockRestore();
    });

    it("STL-19: pre-seeded forecast row → guard skips rebuild, GET returns 200 with forecast data (KAN-161)", async () => {
      // When forecastCount === issueCount the guard condition (forecastCount < issueCount)
      // is false and rebuildProjectForecast is never called. This test confirms the guard
      // logic and that a fully-bootstrapped project serves its cached data correctly.
      // The explicit throw → 200 degrade path is covered by the unit test in
      // packages/api/src/modules/schedule/timeline-service.unit.test.ts.
      const { member, project } = await seedProjectContext();

      const issue = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "Already-forecast issue",
          type: "task",
          state: "todo",
          projectId: project.id,
          sequenceNum: 1,
        },
      });

      // Pre-seed a forecast row so forecastCount === issueCount → no rebuild triggered.
      await prisma.issueForecast.create({
        data: {
          issueId: issue.id,
          forecastStart: new Date("2026-07-01T00:00:00.000Z"),
          forecastEnd: new Date("2026-07-31T00:00:00.000Z"),
          slipDays: 0,
          critical: false,
          computedAt: new Date(),
        },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      // Must always return 200 regardless of bootstrap path.
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.rows).toHaveLength(1);
      // Forecast data is present because the pre-seeded row was returned.
      expect(body.rows[0].forecastEnd).toBe("2026-07-31T00:00:00.000Z");
    });

    it("STL-17: empty project does not trigger a bootstrap rebuild and returns an empty envelope (KAN-161)", async () => {
      const { member, project } = await seedProjectContext();

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ rows: [], total: 0, truncated: false, projectTotal: 0, unscheduled: 0 });
      // No issues → nothing to forecast → no rows created.
      expect(
        await prisma.issueForecast.count({ where: { issue: { projectId: project.id } } }),
      ).toBe(0);
    });

    it("STL-20: envelope reports projectTotal + unscheduled so hidden issues aren't silent (KAN-164)", async () => {
      const { member, project } = await seedProjectContext();

      // A: scheduled INSIDE the requested window.
      const inWin = await prisma.issue.create({
        data: { key: `${project.key}-1`, title: "In window", type: "task", state: "todo", projectId: project.id, sequenceNum: 1 },
      });
      await prisma.issueSchedule.create({
        data: { issueId: inWin.id, startDate: new Date("2026-07-10T00:00:00.000Z"), dueDate: new Date("2026-07-20T00:00:00.000Z"), progress: 0 },
      });
      // B: scheduled OUTSIDE the window (hidden by scope, but has dates). B is
      // "done" with a past completedAt, so it stays genuinely hidden: terminal
      // states are exempt from today-anchoring (KAN-145), so B's forecast stays
      // in May and never enters the July window. (An OPEN overdue todo would
      // instead be forecast to today and surface — that behaviour is covered by
      // STL-11 — which is not what this envelope hidden-count test is about.)
      const outWin = await prisma.issue.create({
        data: {
          key: `${project.key}-2`,
          title: "Out of window",
          type: "task",
          state: "done",
          completedAt: new Date("2026-05-15T00:00:00.000Z"),
          projectId: project.id,
          sequenceNum: 2,
        },
      });
      await prisma.issueSchedule.create({
        data: { issueId: outWin.id, startDate: new Date("2026-05-01T00:00:00.000Z"), dueDate: new Date("2026-05-10T00:00:00.000Z"), progress: 0 },
      });
      // C: no dates at all → unscheduled (never appears in any window).
      await prisma.issue.create({
        data: { key: `${project.key}-3`, title: "Unscheduled", type: "task", state: "backlog", projectId: project.id, sequenceNum: 3 },
      });
      // D: start-only (no dueDate) → incomplete plan span → also unscheduled (can't
      // render a bar and can't match the overlap filter). Locks the KAN-164 definition.
      const startOnly = await prisma.issue.create({
        data: { key: `${project.key}-4`, title: "Start only", type: "task", state: "todo", projectId: project.id, sequenceNum: 4 },
      });
      await prisma.issueSchedule.create({
        data: { issueId: startOnly.id, startDate: new Date("2026-07-15T00:00:00.000Z"), dueDate: null, progress: 0 },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline?from=2026-07-01T00:00:00.000Z&to=2026-07-31T00:00:00.000Z`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      // Only the fully-dated in-window issue is shown — the start-only one can't be placed.
      expect(body.rows).toHaveLength(1);
      expect(body.rows[0].title).toBe("In window");
      expect(body.total).toBe(1);
      // The envelope surfaces the true project size + the count that can't be timelined.
      expect(body.projectTotal).toBe(4);
      // Both the bare issue and the start-only issue are unscheduled (incomplete span);
      // the fully-dated out-of-window issue is NOT unscheduled (it just isn't in scope).
      expect(body.unscheduled).toBe(2);
      // hidden = projectTotal − total = 3 (out-of-window + the two unscheduled).
    });
  });
});
