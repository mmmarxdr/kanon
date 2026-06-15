/**
 * Integration tests for milestone routes.
 *
 * Scenarios covered:
 *   M.1  POST /projects/:key/milestones → 201 (ownerId defaults to actor)
 *   M.2  GET  /projects/:key/milestones → 200, returns list with deliverables
 *   M.3  PATCH /milestones/:id → 200, updates name/status/metOn
 *   M.4  POST /milestones/:id/deliverables → 201, attaches same-project issue
 *   M.5  DELETE /milestones/:id/deliverables/:issueId → 200, detaches issue
 *   M.6  POST deliverable — cross-project issue → 422 DELIVERABLE_PROJECT_MISMATCH
 *   M.7  POST deliverable — duplicate → 409 DUPLICATE_DELIVERABLE
 *   M.8  Non-pm (member role) → POST milestone → 403 FORBIDDEN
 *   M.9  Non-pm (member role) → PATCH milestone → 403 FORBIDDEN
 *   M.10 Non-pm (member role) → POST deliverable → 403 FORBIDDEN
 *   M.11 Non-member → POST milestone → 403 / 404
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
} from "../../../test/helpers.js";
import { prisma } from "../../../config/prisma.js";

// ── helper: seed an issue in a project ───────────────────────────────────────

async function seedIssue(projectId: string, keySuffix: string) {
  const count = await prisma.issue.count();
  return prisma.issue.create({
    data: {
      key: `MST-${keySuffix}`,
      sequenceNum: count + 1,
      title: `Test issue ${keySuffix}`,
      type: "task",
      priority: "medium",
      state: "backlog",
      projectId,
    },
    select: { id: true, key: true },
  });
}

// ── helper: seed a milestone ──────────────────────────────────────────────────

async function seedMilestone(projectId: string, ownerId: string, name = "Test Milestone") {
  return prisma.milestone.create({
    data: {
      name,
      target: new Date("2026-09-01T00:00:00.000Z"),
      status: "upcoming",
      projectId,
      ownerId,
    },
    select: { id: true, name: true, status: true, projectId: true, ownerId: true },
  });
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe("milestone routes — CRUD + role guards (KAN-101 PR2)", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await cleanDatabase();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  // ── M.1: Create milestone → 201 (ownerId defaults to actor) ─────────────────

  it("M.1: pm creates milestone — ownerId defaults to actor when not provided", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const project = await seedTestProject(ws.id, "MST1A");
    await seedTestProjectMember(pm.userId, project.id, "pm");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/milestones`,
      headers: { authorization: `Bearer ${pm.token}` },
      payload: {
        name: "Release 1.0",
        target: "2026-09-01T00:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.name).toBe("Release 1.0");
    expect(body.status).toBe("upcoming");
    // ownerId should default to the creating pm's member id
    expect(body.ownerId).toBe(pm.id);
  });

  it("M.1b: pm creates milestone with explicit ownerId — uses provided ownerId", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const otherMember = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "MST1B");
    await seedTestProjectMember(pm.userId, project.id, "pm");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/milestones`,
      headers: { authorization: `Bearer ${pm.token}` },
      payload: {
        name: "Release 2.0",
        target: "2026-12-01T00:00:00.000Z",
        ownerId: otherMember.id,
      },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().ownerId).toBe(otherMember.id);
  });

  // ── M.2: List milestones → 200 ───────────────────────────────────────────────

  it("M.2: member lists milestones — returns list with deliverables array", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const viewer = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "MST2A");
    await seedTestProjectMember(pm.userId, project.id, "pm");
    await seedTestProjectMember(viewer.userId, project.id, "viewer");
    await seedMilestone(project.id, pm.id, "Q3 Release");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}/milestones`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(Array.isArray(body)).toBe(true);
    expect(body).toHaveLength(1);
    expect(body[0].name).toBe("Q3 Release");
    expect(Array.isArray(body[0].deliverables)).toBe(true);
  });

  // ── M.3: Update milestone — name, status, metOn ─────────────────────────────

  it("M.3: pm updates milestone name, status, and metOn", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const project = await seedTestProject(ws.id, "MST3A");
    await seedTestProjectMember(pm.userId, project.id, "pm");
    const ms = await seedMilestone(project.id, pm.id);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/milestones/${ms.id}`,
      headers: { authorization: `Bearer ${pm.token}` },
      payload: {
        name: "Updated Release",
        status: "met",
        metOn: "2026-08-30T00:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.name).toBe("Updated Release");
    expect(body.status).toBe("met");
    expect(body.metOn).toBeTruthy();
  });

  // ── M.4: Attach deliverable — same-project issue → 201 ─────────────────────

  it("M.4: pm attaches same-project issue as deliverable → 201", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const project = await seedTestProject(ws.id, "MST4A");
    await seedTestProjectMember(pm.userId, project.id, "pm");
    const ms = await seedMilestone(project.id, pm.id);
    const issue = await seedIssue(project.id, "attach-ok");

    const res = await app.inject({
      method: "POST",
      url: `/api/milestones/${ms.id}/deliverables`,
      headers: { authorization: `Bearer ${pm.token}` },
      payload: { issueKey: issue.key },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.milestoneId).toBe(ms.id);
    expect(body.issue.key).toBe(issue.key);
  });

  // ── M.5: Detach deliverable → 200 ────────────────────────────────────────────

  it("M.5: pm detaches issue deliverable → 200 ok", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const project = await seedTestProject(ws.id, "MST5A");
    await seedTestProjectMember(pm.userId, project.id, "pm");
    const ms = await seedMilestone(project.id, pm.id);
    const issue = await seedIssue(project.id, "detach-ok");

    // First attach
    const deliverable = await prisma.milestoneDeliverable.create({
      data: { milestoneId: ms.id, issueId: issue.id },
      select: { id: true },
    });
    void deliverable;

    const res = await app.inject({
      method: "DELETE",
      url: `/api/milestones/${ms.id}/deliverables/${issue.id}`,
      headers: { authorization: `Bearer ${pm.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);
  });

  // ── M.6: Cross-project deliverable → 422 ─────────────────────────────────────

  it("M.6: attach issue from different project → 422 DELIVERABLE_PROJECT_MISMATCH", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const projectA = await seedTestProject(ws.id, "MST6A");
    const projectB = await seedTestProject(ws.id, "MST6B");
    await seedTestProjectMember(pm.userId, projectA.id, "pm");
    await seedTestProjectMember(pm.userId, projectB.id, "pm");

    const ms = await seedMilestone(projectA.id, pm.id);
    // Issue from project B — different project than the milestone
    const crossIssue = await seedIssue(projectB.id, "cross-proj");

    const res = await app.inject({
      method: "POST",
      url: `/api/milestones/${ms.id}/deliverables`,
      headers: { authorization: `Bearer ${pm.token}` },
      payload: { issueKey: crossIssue.key },
    });

    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("DELIVERABLE_PROJECT_MISMATCH");
  });

  // ── M.7: Duplicate deliverable → 409 ─────────────────────────────────────────

  it("M.7: attach same issue twice → 409 DUPLICATE_DELIVERABLE", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const project = await seedTestProject(ws.id, "MST7A");
    await seedTestProjectMember(pm.userId, project.id, "pm");
    const ms = await seedMilestone(project.id, pm.id);
    const issue = await seedIssue(project.id, "dup-del");

    // First attach via API
    const first = await app.inject({
      method: "POST",
      url: `/api/milestones/${ms.id}/deliverables`,
      headers: { authorization: `Bearer ${pm.token}` },
      payload: { issueKey: issue.key },
    });
    expect(first.statusCode).toBe(201);

    // Second attach — should fail with 409
    const second = await app.inject({
      method: "POST",
      url: `/api/milestones/${ms.id}/deliverables`,
      headers: { authorization: `Bearer ${pm.token}` },
      payload: { issueKey: issue.key },
    });
    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("DUPLICATE_DELIVERABLE");
  });

  // ── M.8: Non-pm member → POST milestone → 403 ────────────────────────────────

  it("M.8: project member (not pm) creates milestone → 403 FORBIDDEN", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "MST8A");
    await seedTestProjectMember(member.userId, project.id, "member");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/milestones`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: {
        name: "Should Fail",
        target: "2026-09-01T00:00:00.000Z",
      },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── M.9: Non-pm → PATCH milestone → 403 ──────────────────────────────────────

  it("M.9: project member (not pm) patches milestone → 403 FORBIDDEN", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "MST9A");
    await seedTestProjectMember(pm.userId, project.id, "pm");
    await seedTestProjectMember(member.userId, project.id, "member");
    const ms = await seedMilestone(project.id, pm.id);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/milestones/${ms.id}`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { name: "Should Fail" },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── M.10: Non-pm → POST deliverable → 403 ────────────────────────────────────

  it("M.10: project member (not pm) attaches deliverable → 403 FORBIDDEN", async () => {
    const ws = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(ws.id, "pm");
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "MSTA0");
    await seedTestProjectMember(pm.userId, project.id, "pm");
    await seedTestProjectMember(member.userId, project.id, "member");
    const ms = await seedMilestone(project.id, pm.id);
    const issue = await seedIssue(project.id, "no-pm-del");

    const res = await app.inject({
      method: "POST",
      url: `/api/milestones/${ms.id}/deliverables`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { issueKey: issue.key },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── M.11: Non-member → 403 / 404 ─────────────────────────────────────────────

  it("M.11: non-member of the project → POST milestone → 403 or 404", async () => {
    const wsA = await seedTestWorkspace();
    const pm = await seedTestMemberWithRole(wsA.id, "pm");
    const projectA = await seedTestProject(wsA.id, "MSTB1");
    await seedTestProjectMember(pm.userId, projectA.id, "pm");

    // Stranger from a different workspace
    const wsB = await seedTestWorkspace();
    const stranger = await seedTestMemberWithRole(wsB.id, "pm");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${projectA.key}/milestones`,
      headers: { authorization: `Bearer ${stranger.token}` },
      payload: {
        name: "Should Fail",
        target: "2026-09-01T00:00:00.000Z",
      },
    });

    expect(res.statusCode).not.toBe(201);
    expect([403, 404]).toContain(res.statusCode);
    void pm;
  });
});
