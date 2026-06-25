import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMember,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";

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
      await seedTestProjectMember(member.userId, project.id, "member");
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
      await seedTestProjectMember(member.userId, project.id, "member");
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

  // ── DELETE /api/cycles/:id ─────────────────────────────────────────────────

  describe("DELETE /api/cycles/:id", () => {
    // C.1 — REQ-AUTH-001 s3: non-existent cycleId → 404 from preHandler
    it("returns 404 when cycle does not exist", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const nonExistentId = "00000000-0000-0000-0000-000000000099";

      const res = await app.inject({
        method: "DELETE",
        url: `/api/cycles/${nonExistentId}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("CYCLE_NOT_FOUND");
    });

    // C.2 — REQ-AUTH-001 s1: viewer role → 403 before service is invoked
    it("returns 403 when caller has viewer role", async () => {
      const ws = await seedTestWorkspace();
      const viewer = await seedTestMemberWithRole(ws.id, "viewer");
      const project = await seedTestProject(ws.id);
      const cycle = await seedCycle(project.id, { state: "done" });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/cycles/${cycle.id}`,
        headers: { authorization: `Bearer ${viewer.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    });

    // C.3 — REQ-AUTH-001 s2: member role → request.member.id passed as authorId
    it("returns 200 and passes member id as authorId for a successful delete", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
      const cycle = await seedCycle(project.id, { state: "done" });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/cycles/${cycle.id}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      // Verify authorId was set: audit log must exist with the member's id
      const auditLog = await prisma.adminAuditLog.findFirst({
        where: { entityId: cycle.id, action: "delete" },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog!.authorId).toBe(member.id);
    });

    // C.4 — REQ-API-RESPONSE-001: 200 happy path with full response shape
    it("returns 200 with body { deletedCycleId, cycleName, detachedIssueKeys, auditLogId }", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
      const cycle = await seedCycle(project.id, { state: "done" });
      // Seed a done issue so the non-terminal guard doesn't fire
      const count = await prisma.issue.count();
      const issue = await prisma.issue.create({
        data: {
          key: `DONE-${count + 1}`,
          sequenceNum: count + 1,
          title: "Done issue",
          state: "done",
          projectId: project.id,
          cycleId: cycle.id,
        },
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/cycles/${cycle.id}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveProperty("deletedCycleId", cycle.id);
      expect(body).toHaveProperty("cycleName", cycle.name);
      expect(body).toHaveProperty("detachedIssueKeys");
      expect(body.detachedIssueKeys).toContain(issue.key);
      expect(body).toHaveProperty("auditLogId");
      expect(typeof body.auditLogId).toBe("string");
    });

    // C.5 — REQ-API-ERROR-001: 409 on active cycle
    it("returns 409 CYCLE_ACTIVE when cycle.state === 'active'", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
      const cycle = await seedCycle(project.id, { state: "active" });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/cycles/${cycle.id}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(409);
      const body = res.json();
      expect(body.code).toBe("CYCLE_ACTIVE");
    });

    // C.6 — REQ-API-ERROR-001: 400 with non-terminal issues + details.issueKeys
    it("returns 400 CYCLE_HAS_NON_TERMINAL_ISSUES with details.issueKeys when issues are in non-terminal state", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
      const cycle = await seedCycle(project.id, { state: "done" });
      // Seed issue in non-terminal state
      const count = await prisma.issue.count();
      const issue = await prisma.issue.create({
        data: {
          key: `NT-${count + 1}`,
          sequenceNum: count + 1,
          title: "Non-terminal issue",
          state: "in_progress",
          projectId: project.id,
          cycleId: cycle.id,
        },
      });

      const res = await app.inject({
        method: "DELETE",
        url: `/api/cycles/${cycle.id}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
      const body = res.json();
      expect(body.code).toBe("CYCLE_HAS_NON_TERMINAL_ISSUES");
      expect(body.details).toBeDefined();
      expect(body.details.issueKeys).toContain(issue.key);
    });
  });

  // ── POST /api/cycles/:id/issues ────────────────────────────────────────────

  describe("POST /api/cycles/:id/issues", () => {
    it("creates CycleScopeEvent with kind=add when attaching an issue", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
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

    it("emits issue.updated event for each issue affected by attach/detach (so SSE handlers refresh cycle queries)", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
      const cycleA = await seedCycle(project.id);
      const cycleB = await seedCycle(project.id, { state: "upcoming" });
      const issue1 = await seedIssue(project.id, cycleA.id);
      const issue2 = await seedIssue(project.id);

      const emitSpy = vi.spyOn(eventBus, "emit");

      // Detach issue1 from cycleA, attach issue2 to cycleA — affects 2 issues.
      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycleA.id}/issues`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { add: [issue2.key], remove: [issue1.key] },
      });

      expect(res.statusCode).toBe(200);

      // One issue.updated emission per affected issue, scoped to the workspace.
      const calls = emitSpy.mock.calls
        .map((c) => c[0])
        .filter((e) => e.type === "issue.updated");
      expect(calls.length).toBe(2);
      const keys = calls.map((c) => c.payload.issueKey).sort();
      expect(keys).toEqual([issue1.key, issue2.key].sort());
      for (const c of calls) {
        expect(c.workspaceId).toBe(ws.id);
      }

      // Bonus: also verify cycle B is unaffected (only cycleA route was hit).
      const cycleBIssues = await prisma.issue.count({
        where: { cycleId: cycleB.id },
      });
      expect(cycleBIssues).toBe(0);

      emitSpy.mockRestore();
    });

    it("creates CycleScopeEvent with kind=remove when detaching an issue", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
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
      await seedTestProjectMember(member.userId, projectA.id, "member");
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
      await seedTestProjectMember(member.userId, projectA.id, "member");
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

  // ── KAN-152: baseline snapshot on activation + re-baseline admin op ─────────

  async function seedSchedule(
    issueId: string,
    startDate: Date | null,
    dueDate: Date | null,
  ) {
    return prisma.issueSchedule.create({
      data: { issueId, startDate, dueDate },
    });
  }

  describe("POST /api/cycles/:id/activate (baseline snapshot)", () => {
    it("BSL-INT-1: activating snapshots baselines for issues with plan dates, skips dateless issues", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
      const cycle = await seedCycle(project.id, { state: "upcoming" });

      const withDates = await seedIssue(project.id, cycle.id);
      await seedSchedule(withDates.id, new Date("2026-05-02"), new Date("2026-05-08"));
      const noDates = await seedIssue(project.id, cycle.id);
      await seedSchedule(noDates.id, null, null);

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/activate`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("active");

      const a = await prisma.issueSchedule.findUnique({ where: { issueId: withDates.id } });
      expect(a?.baselineStart?.toISOString()).toBe(new Date("2026-05-02").toISOString());
      expect(a?.baselineEnd?.toISOString()).toBe(new Date("2026-05-08").toISOString());
      expect(a?.baselineSetAt).not.toBeNull();

      const b = await prisma.issueSchedule.findUnique({ where: { issueId: noDates.id } });
      expect(b?.baselineSetAt).toBeNull();
      expect(b?.baselineStart).toBeNull();
    });

    it("BSL-INT-2: re-activating does NOT overwrite an existing baseline (immutability)", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
      const cycle = await seedCycle(project.id, { state: "upcoming" });

      const issue = await seedIssue(project.id, cycle.id);
      await seedSchedule(issue.id, new Date("2026-05-02"), new Date("2026-05-08"));

      // First activation snapshots the baseline.
      await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/activate`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      const first = await prisma.issueSchedule.findUnique({ where: { issueId: issue.id } });

      // Plan moves AFTER baseline is set.
      await prisma.issueSchedule.update({
        where: { issueId: issue.id },
        data: { startDate: new Date("2026-06-01"), dueDate: new Date("2026-06-10") },
      });

      // Re-activation must preserve the ORIGINAL baseline (null-guard).
      await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/activate`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      const second = await prisma.issueSchedule.findUnique({ where: { issueId: issue.id } });

      expect(second?.baselineStart?.toISOString()).toBe(first?.baselineStart?.toISOString());
      expect(second?.baselineEnd?.toISOString()).toBe(first?.baselineEnd?.toISOString());
      expect(second?.baselineEnd?.toISOString()).toBe(new Date("2026-05-08").toISOString());
    });
  });

  describe("POST /api/cycles/:id/baseline (re-baseline admin op)", () => {
    it("BSL-INT-3: returns 403 when caller is below pm (member)", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");
      const cycle = await seedCycle(project.id, { state: "active" });

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/baseline`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    });

    it("BSL-INT-4: pm OVERWRITES the baseline and writes a baseline_set audit record with previous values", async () => {
      const ws = await seedTestWorkspace();
      const pm = await seedTestMemberWithRole(ws.id, "pm");
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(pm.userId, project.id, "pm");
      const cycle = await seedCycle(project.id, { state: "active" });

      const issue = await seedIssue(project.id, cycle.id);
      // Pre-existing baseline that the admin op will overwrite.
      await prisma.issueSchedule.create({
        data: {
          issueId: issue.id,
          startDate: new Date("2026-05-03"),
          dueDate: new Date("2026-05-09"),
          baselineStart: new Date("2026-05-01"),
          baselineEnd: new Date("2026-05-07"),
          baselineSetAt: new Date("2026-04-30"),
        },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/baseline`,
        headers: { authorization: `Bearer ${pm.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().count).toBe(1);

      // Baseline overwritten with the CURRENT plan dates.
      const sched = await prisma.issueSchedule.findUnique({ where: { issueId: issue.id } });
      expect(sched?.baselineStart?.toISOString()).toBe(new Date("2026-05-03").toISOString());
      expect(sched?.baselineEnd?.toISOString()).toBe(new Date("2026-05-09").toISOString());

      // Audit record captures previous baseline values.
      const log = await prisma.activityLog.findFirst({
        where: { issueId: issue.id, action: "baseline_set" },
      });
      expect(log).not.toBeNull();
      expect(log?.memberId).toBe(pm.id);
      const details = log?.details as Record<string, unknown>;
      expect(details.previousBaselineStart).toBe(new Date("2026-05-01").toISOString());
      expect(details.previousBaselineEnd).toBe(new Date("2026-05-07").toISOString());
    });

    it("BSL-INT-5: issueIds from another project are NOT baselined (project-scope guard)", async () => {
      const ws = await seedTestWorkspace();
      const pm = await seedTestMemberWithRole(ws.id, "pm");
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(pm.userId, project.id, "pm");
      const cycle = await seedCycle(project.id, { state: "active" });

      // Foreign project + issue — same workspace, different project
      const otherProject = await seedTestProject(ws.id, "OTH");
      const foreignIssue = await seedIssue(otherProject.id); // not in this cycle
      await prisma.issueSchedule.create({
        data: {
          issueId: foreignIssue.id,
          startDate: new Date("2026-05-03"),
          dueDate: new Date("2026-05-09"),
        },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/baseline`,
        headers: { authorization: `Bearer ${pm.token}` },
        payload: { issueIds: [foreignIssue.id] },
      });

      // Cross-project issueId → 400 NO_MATCHING_ISSUES, not silent count:0
      expect(res.statusCode).toBe(400);
      expect(res.json().code).toBe("NO_MATCHING_ISSUES");

      // Foreign issue's baseline was NOT touched
      const sched = await prisma.issueSchedule.findUnique({
        where: { issueId: foreignIssue.id },
      });
      expect(sched?.baselineSetAt).toBeNull();
    });
  });

  describe("POST /api/cycles/:id/activate — state guard (Fix 1)", () => {
    it("BSL-INT-6: returns 409 when activating a done cycle; existing active cycle is NOT demoted", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");

      // Create an active cycle (the one that must NOT be demoted)
      const activeCycle = await seedCycle(project.id, { state: "active" });
      // The cycle to attempt to activate is already done
      const doneCycle = await seedCycle(project.id, { state: "done" });

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${doneCycle.id}/activate`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("INVALID_CYCLE_STATE");

      // The currently-active cycle must still be active — it was NOT demoted
      const still = await prisma.cycle.findUnique({ where: { id: activeCycle.id } });
      expect(still?.state).toBe("active");
    });

    it("BSL-INT-7: activating an already-active cycle is idempotent (200, no demotion)", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      await seedTestProjectMember(member.userId, project.id, "member");

      const cycle = await seedCycle(project.id, { state: "active" });

      const res = await app.inject({
        method: "POST",
        url: `/api/cycles/${cycle.id}/activate`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().state).toBe("active");

      // Cycle is still active — no state change
      const after = await prisma.cycle.findUnique({ where: { id: cycle.id } });
      expect(after?.state).toBe("active");
    });
  });
});
