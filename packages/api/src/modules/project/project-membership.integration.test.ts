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

/**
 * Integration tests for KAN-16: project membership enforcement.
 *
 * Covers spec scenarios:
 *   R-KAN16 (a) unassigned member → 403
 *   R-KAN16 (b) assigned member sufficient role → 200
 *   R-KAN16 (c) assigned viewer on member-minimum route → 403
 *   R-KAN16 (d) workspace admin no PM row → 200 (bypass)
 *   R-KAN16 (e) createProject creator auto-gets owner PM row
 *   R-KAN16-bug cross-workspace key collision → scoped to user's workspace
 *   R-INV1 issue creation uses workspace Member.id (not PM.id)
 */
describe("KAN-16: Project Membership Enforcement", () => {
  let app: FastifyInstance;
  let workspaceId: string;

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
    const ws = await seedTestWorkspace(`k16${Math.random().toString(36).slice(2, 7)}`);
    workspaceId = ws.id;
  });

  // ── R-KAN16 (a): unassigned member gets 403 on project-scoped route ─────

  it("(a) R-KAN16: member with no PM row gets 403 on GET /api/projects/:key", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const project = await seedTestProject(workspaceId, "A403");
    // No seedTestProjectMember call → no PM row

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("(a) R-KAN16: member with no PM row gets 403 on POST /api/projects/:key/issues", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const project = await seedTestProject(workspaceId, "A403B");
    // No PM row

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/issues`,
      headers: {
        authorization: `Bearer ${member.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "test issue", type: "task", priority: "medium" }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── R-KAN16 (b): assigned member with sufficient role → 200 ─────────────

  it("(b) R-KAN16: member with PM row (role=member) on member-minimum route returns 200", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const project = await seedTestProject(workspaceId, "B200");
    await seedTestProjectMember(member.userId, project.id, "member");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  // ── R-KAN16 (c): viewer PM on member-minimum route → 403 ─────────────────

  it("(c) R-KAN16: viewer PM role on member-minimum route returns 403", async () => {
    const viewer = await seedTestMemberWithRole(workspaceId, "viewer");
    const project = await seedTestProject(workspaceId, "C403");
    // PM row with viewer role
    await seedTestProjectMember(viewer.userId, project.id, "viewer");

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/issues`,
      headers: {
        authorization: `Bearer ${viewer.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "test issue", type: "task", priority: "medium" }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── R-KAN16 (d): workspace admin bypasses without PM row ─────────────────

  it("(d) R-KAN16: workspace admin with no PM row still gets 200 (bypass)", async () => {
    const admin = await seedTestMemberWithRole(workspaceId, "admin");
    const project = await seedTestProject(workspaceId, "D200A");
    // No PM row for admin — bypass should apply

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}`,
      headers: { authorization: `Bearer ${admin.token}` },
    });

    expect(res.statusCode).toBe(200);
  });

  it("(d) R-KAN16: workspace owner with no PM row can update project (bypass)", async () => {
    const owner = await seedTestMemberWithRole(workspaceId, "owner");
    const project = await seedTestProject(workspaceId, "D200B");
    // No PM row for owner

    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/${project.key}`,
      headers: {
        authorization: `Bearer ${owner.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "Updated Name" }),
    });

    expect(res.statusCode).toBe(200);
  });

  // ── R-KAN16 (e): createProject creator auto-gets owner PM row ────────────

  it("(e) R-KAN16: workspace member creating a project gets owner PM row auto-inserted", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");

    const createRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspaceId}/projects`,
      headers: {
        authorization: `Bearer ${member.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ key: "NEWP", name: "New Project" }),
    });

    expect(createRes.statusCode).toBe(201);
    const createdProject = createRes.json();

    // Verify PM row was inserted with role=owner
    const pm = await prisma.projectMember.findUnique({
      where: {
        userId_projectId: {
          userId: member.userId,
          projectId: createdProject.id,
        },
      },
      select: { role: true },
    });

    expect(pm).not.toBeNull();
    expect(pm?.role).toBe("owner");
  });

  it("(e) R-KAN16: after createProject, creator's subsequent project-scoped GET returns 200", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");

    const createRes = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspaceId}/projects`,
      headers: {
        authorization: `Bearer ${member.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ key: "NEWP2", name: "New Project 2" }),
    });

    expect(createRes.statusCode).toBe(201);
    const { key } = createRes.json();

    const getRes = await app.inject({
      method: "GET",
      url: `/api/projects/${key}`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(getRes.statusCode).toBe(200);
  });

  // ── R-KAN16-bug: cross-workspace key collision scoped to user's workspace ─

  it("R-KAN16-bug: same key in two workspaces — user in WA gets WA's project (not WB's)", async () => {
    // WA: user is a member (workspaceId already created in beforeEach)
    const wsA = { id: workspaceId };

    // WB: separate workspace user does NOT belong to
    const wsB = await seedTestWorkspace(`wb${Math.random().toString(36).slice(2, 7)}`);

    // Both workspaces have a project with key "SHARED"
    const projectA = await seedTestProject(wsA.id, "SHARED");
    const _projectB = await seedTestProject(wsB.id, "SHARED");

    const member = await seedTestMemberWithRole(wsA.id, "member");
    await seedTestProjectMember(member.userId, projectA.id, "member");
    // Member is NOT in wsB

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/SHARED`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    // Should resolve to WA's project (user belongs to WA)
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(projectA.id);
  });

  it("R-KAN16-bug: user NOT in any workspace with key returns 404 (no cross-workspace leak)", async () => {
    // wsB has "NOACCESS" project; user is NOT a member of wsB
    const wsB = await seedTestWorkspace(`wb2${Math.random().toString(36).slice(2, 7)}`);
    await seedTestProject(wsB.id, "NOACC");

    // User is a member of workspaceId (wsA) only — which has no such project
    const member = await seedTestMemberWithRole(workspaceId, "member");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/NOACC`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(404);
  });

  // ── R-INV1: issue creation uses workspace Member.id, not PM.id ───────────

  it("R-INV1: created issue uses workspace Member.id as assigneeId (not ProjectMember.id)", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const project = await seedTestProject(workspaceId, "INV1");
    const pm = await seedTestProjectMember(member.userId, project.id, "member");

    // Sanity: workspace member id and PM id must differ
    expect(member.id).not.toBe(pm.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/issues`,
      headers: {
        authorization: `Bearer ${member.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        title: "invariant test issue",
        type: "task",
        priority: "medium",
        assigneeId: member.id, // workspace Member.id
      }),
    });

    expect(res.statusCode).toBe(201);
    const issue = res.json();

    // assigneeId must be the workspace Member.id (not PM.id)
    expect(issue.assigneeId).toBe(member.id);
    expect(issue.assigneeId).not.toBe(pm.id);

    // Verify directly in DB
    const dbIssue = await prisma.issue.findUnique({
      where: { id: issue.id },
      select: { assigneeId: true },
    });
    expect(dbIssue?.assigneeId).toBe(member.id);
  });

  // ── R-KAN14: distinct users can both have PM rows for same project ────────

  it("R-KAN14: two distinct members can both hold PM rows for the same project", async () => {
    const m1 = await seedTestMemberWithRole(workspaceId, "member");
    const m2 = await seedTestMemberWithRole(workspaceId, "member");
    const project = await seedTestProject(workspaceId, "KAN14");

    await seedTestProjectMember(m1.userId, project.id, "member");
    await seedTestProjectMember(m2.userId, project.id, "viewer");

    // Both should be able to GET the project
    const res1 = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}`,
      headers: { authorization: `Bearer ${m1.token}` },
    });
    expect(res1.statusCode).toBe(200);

    const res2 = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}`,
      headers: { authorization: `Bearer ${m2.token}` },
    });
    expect(res2.statusCode).toBe(200);
  });
});
