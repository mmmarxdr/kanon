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

// ── Helpers for S2 WorkLog tests ──────────────────────────────────────────

/**
 * Backdate a work session's startedAt so the duration calculation
 * in stopWork produces a predictable durationS ≥ 60.
 */
async function backdateSession(sessionId: string, secondsAgo: number): Promise<void> {
  const startedAt = new Date(Date.now() - secondsAgo * 1000);
  await prisma.workSession.update({
    where: { id: sessionId },
    data: { startedAt, lastHeartbeat: new Date() },
  });
}

describe("Work Session Routes", () => {
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

  /** Helper: create a workspace + member + project + issue for work session tests. */
  async function seedIssueContext(role: "owner" | "admin" | "member" | "viewer" = "member") {
    const ws = await seedTestWorkspace();
    // Always create an owner first (required for workspace)
    await seedTestMemberWithRole(ws.id, "owner");
    const member = await seedTestMemberWithRole(ws.id, role);
    const project = await seedTestProject(ws.id);

    // KAN-16: member/viewer require a ProjectMember row; owner/admin bypass
    if (role === "member" || role === "viewer") {
      await seedTestProjectMember(member.userId, project.id, role);
    }

    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        title: "Test issue",
        type: "task",
        state: "backlog",
        projectId: project.id,
        sequenceNum: 1,
      },
    });

    return { ws, member, project, issue };
  }

  // ── POST /api/issues/:key/work-sessions — start work ──────────────────

  describe("POST /api/issues/:key/work-sessions", () => {
    it("starts work and returns 201", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { source: "test" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.session).toBeDefined();
      expect(body.warnings).toEqual([]);
    });

    it("returns warning when someone else is working", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const memberA = await seedTestMemberWithRole(ws.id, "member");
      const memberB = await seedTestMemberWithRole(ws.id, "member");
      const project = await seedTestProject(ws.id);
      // KAN-16: both members need PM rows to access issue-scoped routes
      await seedTestProjectMember(memberA.userId, project.id, "member");
      await seedTestProjectMember(memberB.userId, project.id, "member");
      const issue = await prisma.issue.create({
        data: {
          key: `${project.key}-1`,
          title: "Shared issue",
          type: "task",
          state: "backlog",
          projectId: project.id,
          sequenceNum: 1,
        },
      });

      // Member A starts work
      await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${memberA.token}` },
        payload: { source: "test" },
      });

      // Member B starts work — should get warning
      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${memberB.token}` },
        payload: { source: "test" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.warnings.length).toBeGreaterThan(0);
      expect(body.warnings[0]).toContain("Other active workers");
    });

    it("auto-assigns unassigned issue", async () => {
      const { member, issue } = await seedIssueContext();

      // Verify issue has no assignee
      expect(issue.assigneeId).toBeNull();

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { source: "test" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().autoAssigned).toBe(true);

      // Verify issue now has assignee
      const updated = await prisma.issue.findUnique({ where: { id: issue.id } });
      expect(updated!.assigneeId).toBe(member.id);
    });
  });

  // ── POST /api/issues/:key/work-sessions/heartbeat ─────────────────────

  describe("POST /api/issues/:key/work-sessions/heartbeat", () => {
    it("updates heartbeat for active session", async () => {
      const { member, issue } = await seedIssueContext();

      // Start a session first
      await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { source: "test" },
      });

      // Send heartbeat
      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions/heartbeat`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().ok).toBe(true);
    });

    it("returns 404 when no active session exists", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions/heartbeat`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── DELETE /api/issues/:key/work-sessions ──────────────────────────────

  describe("DELETE /api/issues/:key/work-sessions", () => {
    it("stops work session", async () => {
      const { member, issue } = await seedIssueContext();

      // Start a session
      await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { source: "test" },
      });

      // Stop it
      const res = await app.inject({
        method: "DELETE",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body.ok).toBe(true);
      expect(body.deleted).toBe(true);
    });

    it("returns ok when no session exists", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "DELETE",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().deleted).toBe(false);
    });
  });

  // ── GET /api/issues/:key/work-sessions ─────────────────────────────────

  describe("GET /api/issues/:key/work-sessions", () => {
    it("lists active workers", async () => {
      const { member, issue } = await seedIssueContext();

      // Start a session
      await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { source: "test" },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      const workers = res.json();
      expect(workers).toHaveLength(1);
      expect(workers[0]).toHaveProperty("userId");
      expect(workers[0]).toHaveProperty("memberId");
      expect(workers[0]).toHaveProperty("username");
      expect(workers[0]).toHaveProperty("source", "test");
    });

    it("returns empty array when no active sessions", async () => {
      const { member, issue } = await seedIssueContext();

      const res = await app.inject({
        method: "GET",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${member.token}` },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual([]);
    });
  });

  // ── Auth: non-member gets 403 ─────────────────────────────────────────

  describe("Authorization", () => {
    it("non-member gets 403 on start work", async () => {
      const { issue } = await seedIssueContext();

      // Create an outsider in a different workspace
      const otherWs = await seedTestWorkspace();
      const outsider = await seedTestMemberWithRole(otherWs.id, "owner");

      const res = await app.inject({
        method: "POST",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${outsider.token}` },
        payload: { source: "test" },
      });

      expect(res.statusCode).toBe(403);
    });

    it("non-member gets 403 on list active workers", async () => {
      const { issue } = await seedIssueContext();
      const otherWs = await seedTestWorkspace();
      const outsider = await seedTestMemberWithRole(otherWs.id, "owner");

      const res = await app.inject({
        method: "GET",
        url: `/api/issues/${issue.key}/work-sessions`,
        headers: { authorization: `Bearer ${outsider.token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── S2: WorkLog capture ───────────────────────────────────────────────
  //
  // KAN-26: stopWork ≥ 60s creates one WorkLog + deletes session atomically;
  //          stopWork < 60s creates no WorkLog; list endpoints shape.

  describe("S2 — WorkLog capture", () => {
    describe("DELETE /api/issues/:key/work-sessions — WorkLog creation", () => {
      it("≥ 60s session: creates exactly one WorkLog + session is gone", async () => {
        const { member, issue } = await seedIssueContext();

        // Start a session
        const startRes = await app.inject({
          method: "POST",
          url: `/api/issues/${issue.key}/work-sessions`,
          headers: { authorization: `Bearer ${member.token}` },
          payload: { source: "test" },
        });
        expect(startRes.statusCode).toBe(201);
        const sessionId = startRes.json().session.id as string;

        // Backdate startedAt so duration is 90s
        await backdateSession(sessionId, 90);

        // Stop work
        const stopRes = await app.inject({
          method: "DELETE",
          url: `/api/issues/${issue.key}/work-sessions`,
          headers: { authorization: `Bearer ${member.token}` },
        });

        expect(stopRes.statusCode).toBe(200);
        const body = stopRes.json();
        expect(body.ok).toBe(true);
        expect(body.deleted).toBe(true);
        expect(body.workLog).not.toBeNull();
        expect(body.workLog.durationS).toBeGreaterThanOrEqual(60);

        // Session must be gone
        const session = await prisma.workSession.findUnique({
          where: { id: sessionId },
        });
        expect(session).toBeNull();

        // Exactly one WorkLog must exist for this issue + member
        const logs = await prisma.workLog.findMany({
          where: { issueId: issue.id, memberId: member.id },
        });
        expect(logs).toHaveLength(1);
        expect(logs[0]!.durationS).toBeGreaterThanOrEqual(60);
        expect(logs[0]!.reason).toBe("stopped");
      });

      it("< 60s session: NO WorkLog created; session still deleted", async () => {
        const { member, issue } = await seedIssueContext();

        // Start a session (fresh — startedAt is now, so duration will be < 60s)
        const startRes = await app.inject({
          method: "POST",
          url: `/api/issues/${issue.key}/work-sessions`,
          headers: { authorization: `Bearer ${member.token}` },
          payload: { source: "test" },
        });
        expect(startRes.statusCode).toBe(201);
        const sessionId = startRes.json().session.id as string;

        // Stop immediately (duration << 60s)
        const stopRes = await app.inject({
          method: "DELETE",
          url: `/api/issues/${issue.key}/work-sessions`,
          headers: { authorization: `Bearer ${member.token}` },
        });

        expect(stopRes.statusCode).toBe(200);
        const body = stopRes.json();
        expect(body.ok).toBe(true);
        expect(body.deleted).toBe(true);
        expect(body.workLog).toBeNull();

        // Session must be gone
        const session = await prisma.workSession.findUnique({
          where: { id: sessionId },
        });
        expect(session).toBeNull();

        // No WorkLog created
        const logs = await prisma.workLog.findMany({
          where: { issueId: issue.id, memberId: member.id },
        });
        expect(logs).toHaveLength(0);
      });

      it("stop with X-Kanon-Client header: WorkLog.via set correctly", async () => {
        const { member, issue } = await seedIssueContext();

        const startRes = await app.inject({
          method: "POST",
          url: `/api/issues/${issue.key}/work-sessions`,
          headers: { authorization: `Bearer ${member.token}` },
          payload: { source: "test" },
        });
        const sessionId = startRes.json().session.id as string;
        await backdateSession(sessionId, 90);

        await app.inject({
          method: "DELETE",
          url: `/api/issues/${issue.key}/work-sessions`,
          headers: {
            authorization: `Bearer ${member.token}`,
            "x-kanon-client": "claude-code",
          },
        });

        const logs = await prisma.workLog.findMany({
          where: { issueId: issue.id, memberId: member.id },
        });
        expect(logs).toHaveLength(1);
        expect(logs[0]!.via).toBe("claude-code");
      });
    });

    // ── GET /api/issues/:key/worklogs ─────────────────────────────────────

    describe("GET /api/issues/:key/worklogs", () => {
      it("returns WorkLog list for issue, ordered by startedAt DESC", async () => {
        const { member, ws, issue } = await seedIssueContext();

        // Create two sessions with different backdated times
        for (const secondsAgo of [90, 120]) {
          const startRes = await app.inject({
            method: "POST",
            url: `/api/issues/${issue.key}/work-sessions`,
            headers: { authorization: `Bearer ${member.token}` },
            payload: { source: "test" },
          });
          const sessionId = startRes.json().session.id as string;
          await backdateSession(sessionId, secondsAgo);
          await app.inject({
            method: "DELETE",
            url: `/api/issues/${issue.key}/work-sessions`,
            headers: { authorization: `Bearer ${member.token}` },
          });
        }

        const res = await app.inject({
          method: "GET",
          url: `/api/issues/${issue.key}/worklogs`,
          headers: { authorization: `Bearer ${member.token}` },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.worklogs).toHaveLength(2);
        // Ordered DESC by startedAt (most recent first)
        expect(new Date(body.worklogs[0].startedAt).getTime()).toBeGreaterThanOrEqual(
          new Date(body.worklogs[1].startedAt).getTime(),
        );
        // Each item has required fields
        const item = body.worklogs[0];
        expect(item).toHaveProperty("id");
        expect(item).toHaveProperty("durationS");
        expect(item).toHaveProperty("startedAt");
        expect(item).toHaveProperty("via");
        expect(item).toHaveProperty("issueId", issue.id);
        expect(body).toHaveProperty("totalDurationS");
        void ws; // used indirectly through seedIssueContext
      });

      it("requires authentication: 401 without token", async () => {
        const { issue } = await seedIssueContext();

        const res = await app.inject({
          method: "GET",
          url: `/api/issues/${issue.key}/worklogs`,
        });

        expect(res.statusCode).toBe(401);
      });
    });

    // ── GET /api/me/worklogs ──────────────────────────────────────────────

    describe("GET /api/me/worklogs", () => {
      it("returns only own WorkLogs across issues", async () => {
        const ws = await seedTestWorkspace();
        await seedTestMemberWithRole(ws.id, "owner");
        const memberA = await seedTestMemberWithRole(ws.id, "member");
        const memberB = await seedTestMemberWithRole(ws.id, "member");
        const project = await seedTestProject(ws.id);
        await seedTestProjectMember(memberA.userId, project.id, "member");
        await seedTestProjectMember(memberB.userId, project.id, "member");

        // Create two issues
        const issueA = await prisma.issue.create({
          data: {
            key: `${project.key}-1`,
            title: "Issue A",
            type: "task",
            state: "backlog",
            projectId: project.id,
            sequenceNum: 1,
          },
        });
        const issueB = await prisma.issue.create({
          data: {
            key: `${project.key}-2`,
            title: "Issue B",
            type: "task",
            state: "backlog",
            projectId: project.id,
            sequenceNum: 2,
          },
        });

        // memberA works on issueA (≥ 60s)
        const startA = await app.inject({
          method: "POST",
          url: `/api/issues/${issueA.key}/work-sessions`,
          headers: { authorization: `Bearer ${memberA.token}` },
          payload: { source: "test" },
        });
        await backdateSession(startA.json().session.id as string, 90);
        await app.inject({
          method: "DELETE",
          url: `/api/issues/${issueA.key}/work-sessions`,
          headers: { authorization: `Bearer ${memberA.token}` },
        });

        // memberB works on issueB (≥ 60s)
        const startB = await app.inject({
          method: "POST",
          url: `/api/issues/${issueB.key}/work-sessions`,
          headers: { authorization: `Bearer ${memberB.token}` },
          payload: { source: "test" },
        });
        await backdateSession(startB.json().session.id as string, 90);
        await app.inject({
          method: "DELETE",
          url: `/api/issues/${issueB.key}/work-sessions`,
          headers: { authorization: `Bearer ${memberB.token}` },
        });

        // memberA's own logs (KAN-82: workspaceId now required)
        const res = await app.inject({
          method: "GET",
          url: `/api/me/worklogs?workspaceId=${ws.id}`,
          headers: { authorization: `Bearer ${memberA.token}` },
        });

        expect(res.statusCode).toBe(200);
        const body = res.json();
        expect(body.worklogs).toHaveLength(1);
        expect(body.worklogs[0]!.issueId).toBe(issueA.id);
      });

      it("requires authentication: 401 without token", async () => {
        const res = await app.inject({
          method: "GET",
          url: "/api/me/worklogs",
        });
        expect(res.statusCode).toBe(401);
      });
    });
  });
});
