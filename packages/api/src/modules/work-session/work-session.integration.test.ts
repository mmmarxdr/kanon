import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";

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
});
