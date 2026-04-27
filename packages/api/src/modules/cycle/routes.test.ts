import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMember,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";

/**
 * Integration tests for cycle routes.
 *
 * Covers auth guard enforcement (401/403) on the three previously unguarded
 * routes and verifies business-logic outcomes for closeCycle and attachIssues.
 */
describe("Cycle Routes", () => {
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

  // ── Helpers ────────────────────────────────────────────────────────────────

  async function seedCycle(projectId: string, overrides?: { state?: "upcoming" | "active" | "done" }) {
    return prisma.cycle.create({
      data: {
        name: "Test Sprint",
        state: overrides?.state ?? "active",
        startDate: new Date("2026-05-01"),
        endDate: new Date("2026-05-14"),
        projectId,
      },
    });
  }

  async function seedIssue(projectId: string, cycleId?: string) {
    const count = await prisma.issue.count();
    const seqNum = count + 1;
    return prisma.issue.create({
      data: {
        key: `TEST-${seqNum}`,
        sequenceNum: seqNum,
        title: "Test issue",
        state: "backlog",
        projectId,
        ...(cycleId ? { cycleId } : {}),
      },
    });
  }

  // ── GET /api/cycles/:id ────────────────────────────────────────────────────

  describe("GET /api/cycles/:id", () => {
    it("returns 401 when unauthenticated", async () => {
      const ws = await seedTestWorkspace();
      const project = await seedTestProject(ws.id);
      const cycle = await seedCycle(project.id);

      const res = await app.inject({
        method: "GET",
        url: `/api/cycles/${cycle.id}`,
      });

      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe("UNAUTHORIZED");
    });

    it("returns 403 when authenticated but not a member of the cycle's project workspace", async () => {
      // Workspace A owns the cycle; workspace B has the caller
      const wsA = await seedTestWorkspace("ws-a");
      const wsB = await seedTestWorkspace("ws-b");
      const projectA = await seedTestProject(wsA.id, "CYC");
      const cycle = await seedCycle(projectA.id);
      const outsider = await seedTestMemberWithRole(wsB.id, "member");

      const res = await app.inject({
        method: "GET",
        url: `/api/cycles/${cycle.id}`,
        headers: { authorization: `Bearer ${outsider.token}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    });

    it("returns 200 with cycle data when authenticated member requests a cycle", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const cycle = await seedCycle(project.id);

      const res = await app.inject({
        method: "GET",
        url: `/api/cycles/${cycle.id}`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.id).toBe(cycle.id);
      expect(body.name).toBe("Test Sprint");
    });
  });

  // ── POST /api/cycles/:id/close ─────────────────────────────────────────────

  describe("POST /api/cycles/:id/close", () => {
    it("returns 403 when caller has viewer role (below member)", async () => {
      const ws = await seedTestWorkspace();
      const viewer = await seedTestMemberWithRole(ws.id, "viewer");
      const project = await seedTestProject(ws.id);
      const cycle = await seedCycle(project.id);

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/close`,
        headers: { authorization: `Bearer ${viewer.token}` },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    });

    it("returns 200 and sets state=done when member closes a cycle", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const cycle = await seedCycle(project.id, { state: "active" });

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/close`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.state).toBe("done");
      expect(body.velocity).toBeDefined();
    });
  });

  // ── POST /api/cycles/:id/issues ────────────────────────────────────────────

  describe("POST /api/cycles/:id/issues", () => {
    it("creates CycleScopeEvent with kind=add when attaching an issue", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const cycle = await seedCycle(project.id);
      const issue = await seedIssue(project.id);

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/issues`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { add: [issue.key] },
      });

      expect(res.statusCode).toBe(200);

      const event = await prisma.cycleScopeEvent.findFirst({
        where: { cycleId: cycle.id, issueKey: issue.key, kind: "add" },
      });
      expect(event).not.toBeNull();
      expect(event!.kind).toBe("add");
    });

    it("creates CycleScopeEvent with kind=remove when detaching an issue", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const cycle = await seedCycle(project.id);
      const issue = await seedIssue(project.id, cycle.id);

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/issues`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { remove: [issue.key] },
      });

      expect(res.statusCode).toBe(200);

      const event = await prisma.cycleScopeEvent.findFirst({
        where: { cycleId: cycle.id, issueKey: issue.key, kind: "remove" },
      });
      expect(event).not.toBeNull();
      expect(event!.kind).toBe("remove");
    });

    it("returns 400 and creates NO db rows when add contains a cross-project key", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const projectA = await seedTestProject(ws.id, "AAA");
      const projectB = await seedTestProject(ws.id, "BBB");
      const cycle = await seedCycle(projectA.id);
      // Issue belongs to projectB — different project from cycle
      const foreignIssue = await seedIssue(projectB.id);

      const eventsBefore = await prisma.cycleScopeEvent.count();
      const issuesBefore = await prisma.issue.count({ where: { cycleId: cycle.id } });

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/issues`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { add: [foreignIssue.key] },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CROSS_PROJECT_ISSUE");
      expect(body.message).toContain(foreignIssue.key);

      // No Issue rows updated, no CycleScopeEvent rows created
      const eventsAfter = await prisma.cycleScopeEvent.count();
      const issuesAfter = await prisma.issue.count({ where: { cycleId: cycle.id } });
      expect(eventsAfter).toBe(eventsBefore);
      expect(issuesAfter).toBe(issuesBefore);
    });

    it("returns 400 and creates NO db rows when remove contains a cross-project key", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const projectA = await seedTestProject(ws.id, "CCC");
      const projectB = await seedTestProject(ws.id, "DDD");
      const cycle = await seedCycle(projectA.id);
      // Issue belongs to projectB (and is attached to the cycle — simulating a bad state)
      const foreignIssue = await prisma.issue.create({
        data: {
          key: "DDD-1",
          sequenceNum: 1,
          title: "Foreign issue",
          state: "backlog",
          projectId: projectB.id,
          cycleId: cycle.id,
        },
      });

      const eventsBefore = await prisma.cycleScopeEvent.count();

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/issues`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { remove: [foreignIssue.key] },
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CROSS_PROJECT_ISSUE");
      expect(body.message).toContain(foreignIssue.key);

      // No CycleScopeEvent rows created
      const eventsAfter = await prisma.cycleScopeEvent.count();
      expect(eventsAfter).toBe(eventsBefore);
    });
  });
});
