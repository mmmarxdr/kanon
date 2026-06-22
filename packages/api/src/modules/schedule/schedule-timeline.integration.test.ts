/**
 * Integration tests: GET /api/projects/:key/schedule-timeline (KAN-105 PR1).
 *
 * Covers:
 * - Project with mixed issues (full schedule+forecast, schedule-only, bare)
 *   asserts shape, null-handling, and that bare issues still appear
 * - Non-member gets 403; project member gets 200
 * - Unknown project key returns 404
 * - Empty project returns []
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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
    it("STL-1: returns [] for a project with no issues", async () => {
      const { member, project } = await seedProjectContext();

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/schedule-timeline`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
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
      expect(body).toHaveLength(1);

      const row = body[0];
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
    });

    it("STL-5: includes schedule-only issue with null forecast fields", async () => {
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
      expect(body).toHaveLength(1);

      const row = body[0];
      expect(row.startDate).toBe("2026-08-01T00:00:00.000Z");
      expect(row.forecastStart).toBeNull();
      expect(row.forecastEnd).toBeNull();
      expect(row.slipDays).toBeNull();
      expect(row.critical).toBeNull();
      expect(row.floatDays).toBeNull();
    });

    it("STL-6: includes bare issue (no schedule, no forecast) with all null date fields", async () => {
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
      expect(body).toHaveLength(1);

      const row = body[0];
      expect(row.issueId).toBe(bare.id);
      expect(row.progress).toBe(0);
      expect(row.startDate).toBeNull();
      expect(row.dueDate).toBeNull();
      expect(row.baselineStart).toBeNull();
      expect(row.baselineEnd).toBeNull();
      expect(row.forecastStart).toBeNull();
      expect(row.forecastEnd).toBeNull();
      expect(row.slipDays).toBeNull();
      expect(row.critical).toBeNull();
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
      // All 3 issues must appear
      expect(body).toHaveLength(3);
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
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe("WS-A issue");
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
  });
});
