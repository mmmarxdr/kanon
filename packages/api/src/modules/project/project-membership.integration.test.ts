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

  it("(e) R-KAN16: workspace owner creating a project gets owner PM row auto-inserted", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "owner");

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

  it("(e) R-KAN16: after owner createProject, creator's subsequent project-scoped GET returns 200", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "owner");

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

  it("rejects project creation by a non-owner workspace member", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const response = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspaceId}/projects`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { key: "NOOWN", name: "Forbidden" },
    });

    expect(response.statusCode).toBe(403);
    await expect(prisma.project.count({ where: { key: "NOOWN" } })).resolves.toBe(0);
  });

  it("scopes owner project edits and archives by workspace and project id", async () => {
    const owner = await seedTestMemberWithRole(workspaceId, "owner");
    const otherWorkspace = await seedTestWorkspace();
    await prisma.member.create({
      data: {
        userId: owner.userId,
        workspaceId: otherWorkspace.id,
        username: "two-workspace-owner",
        role: "owner",
      },
    });
    const project = await seedTestProject(workspaceId, "OWNCRD");

    const wrongWorkspace = await app.inject({
      method: "PATCH",
      url: `/api/workspaces/${otherWorkspace.id}/projects/${project.id}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: "Wrong workspace" },
    });
    expect(wrongWorkspace.statusCode).toBe(404);

    const updated = await app.inject({
      method: "PATCH",
      url: `/api/workspaces/${workspaceId}/projects/${project.id}`,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { name: "Owner managed" },
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json()).toMatchObject({ id: project.id, name: "Owner managed" });

    const archived = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${workspaceId}/projects/${project.id}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(archived.statusCode).toBe(200);
    expect(archived.json()).toMatchObject({ id: project.id, archived: true });
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

  // ── R-KAN16-bug: deterministic tie-break (oldest workspace wins) ──────────

  it("R-KAN16-bug: same key in two workspaces the user belongs to — tie-break resolves to oldest workspace", async () => {
    // WA: explicitly older workspace (2020-01-01); WB: explicitly newer (2021-01-01).
    // Using prisma.workspace.create directly to control createdAt — bypassing the
    // seedTestWorkspace helper which does not expose createdAt.
    const [wsA, wsB] = await Promise.all([
      prisma.workspace.create({
        data: {
          name: "WA Older",
          slug: `wa-older-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      }),
      prisma.workspace.create({
        data: {
          name: "WB Newer",
          slug: `wb-newer-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date("2021-01-01T00:00:00.000Z"),
        },
      }),
    ]);

    // Projects: both keyed "TIEBRK" — one in each workspace.
    const [projectA, _projectB] = await Promise.all([
      seedTestProject(wsA.id, "TIEBRK"),
      seedTestProject(wsB.id, "TIEBRK"),
    ]);

    // Create the user as a member of WA via the helper (creates user + token).
    const memberInWA = await seedTestMemberWithRole(wsA.id, "member");

    // Add the SAME user as a member of WB directly (same userId, no PM row in WB).
    await prisma.member.create({
      data: {
        username: `wb-member-${Math.random().toString(36).slice(2, 7)}`,
        role: "member",
        userId: memberInWA.userId,
        workspaceId: wsB.id,
      },
    });

    // Grant access ONLY to WA's project (role=member → no admin/owner bypass).
    // WB has no PM row for this user — a wrong tie-break to WB → 403.
    await seedTestProjectMember(memberInWA.userId, projectA.id, "member");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/TIEBRK`,
      headers: { authorization: `Bearer ${memberInWA.token}` },
    });

    // Tie-break must select WA (oldest workspace, createdAt 2020 < 2021).
    // If WB were selected instead, the user has no PM row there → 403.
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(projectA.id);
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

  // ── W2: gate↔handler divergence — mutation hits gate-resolved project, not colliding one ──

  it("W2-PATCH: PATCH /projects/:key mutates gate-resolved WA project, never WB", async () => {
    // WA: explicitly older workspace; WB: newer.
    const [wsA, wsB] = await Promise.all([
      prisma.workspace.create({
        data: {
          name: "W2 WA",
          slug: `w2wa-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date("2020-01-01T00:00:00.000Z"),
        },
      }),
      prisma.workspace.create({
        data: {
          name: "W2 WB",
          slug: `w2wb-${Math.random().toString(36).slice(2, 7)}`,
          createdAt: new Date("2021-01-01T00:00:00.000Z"),
        },
      }),
    ]);

    // Both have "W2KEY" project.
    const [projectA, projectB] = await Promise.all([
      prisma.project.create({ data: { key: "W2KEY", name: "WA Project", workspaceId: wsA.id } }),
      prisma.project.create({ data: { key: "W2KEY", name: "WB Project", workspaceId: wsB.id } }),
    ]);

    // User is admin in WA (admin can PATCH without PM row — admin bypass applies).
    const memberInWA = await seedTestMemberWithRole(wsA.id, "admin");
    // Add same user to WB as admin.
    await prisma.member.create({
      data: {
        username: `w2wb-adm-${Math.random().toString(36).slice(2, 7)}`,
        role: "admin",
        userId: memberInWA.userId,
        workspaceId: wsB.id,
      },
    });

    const res = await app.inject({
      method: "PATCH",
      url: `/api/projects/W2KEY`,
      headers: {
        authorization: `Bearer ${memberInWA.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ name: "WA Mutated" }),
    });

    expect(res.statusCode).toBe(200);

    // GATE resolves to WA (oldest workspace). The handler MUST mutate WA, not WB.
    const [dbA, dbB] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectA.id }, select: { name: true } }),
      prisma.project.findUnique({ where: { id: projectB.id }, select: { name: true } }),
    ]);
    expect(dbA?.name).toBe("WA Mutated");   // gate-resolved project must be updated
    expect(dbB?.name).toBe("WB Project");   // colliding WB must be untouched
  });

  it("W2-POST-ISSUE: POST /projects/:key/issues creates issue in gate-resolved WA, never WB", async () => {
    // WB is created FIRST (older insertion order) so unscoped findFirst picks WB.
    // The gate scopes to user's workspaces and picks WA (oldest by createdAt).
    // After the fix, createIssue must use the gate-resolved WA id, not re-resolve by key.
    const wsB = await prisma.workspace.create({
      data: {
        name: "W2I WB",
        slug: `w2iwb-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date("2021-01-01T00:00:00.000Z"),
      },
    });
    const wsA = await prisma.workspace.create({
      data: {
        name: "W2I WA",
        slug: `w2iwa-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });

    // projectB inserted first → unscoped findFirst returns WB
    const projectB = await prisma.project.create({ data: { key: "W2IKEY", name: "WB Project", workspaceId: wsB.id } });
    const projectA = await prisma.project.create({ data: { key: "W2IKEY", name: "WA Project", workspaceId: wsA.id } });

    // User is member in WA (older createdAt → gate picks WA) with PM row.
    const memberInWA = await seedTestMemberWithRole(wsA.id, "member");
    await prisma.member.create({
      data: {
        username: `w2iwb-${Math.random().toString(36).slice(2, 7)}`,
        role: "member",
        userId: memberInWA.userId,
        workspaceId: wsB.id,
      },
    });
    await seedTestProjectMember(memberInWA.userId, projectA.id, "member");
    // No PM row for WB → if handler re-resolves by key (unscoped), it picks WB, issue lands there.

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/W2IKEY/issues`,
      headers: {
        authorization: `Bearer ${memberInWA.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "cross-tenant safety check", type: "task", priority: "medium" }),
    });

    expect(res.statusCode).toBe(201);
    const issue = res.json();

    // Issue MUST belong to gate-resolved WA project, not WB.
    expect(issue.projectId).toBe(projectA.id);
    expect(issue.projectId).not.toBe(projectB.id);
  });

  it("W2-DELETE: DELETE /projects/:key archives gate-resolved WA project, never WB", async () => {
    // WB inserted first (older insertion order) so unscoped findFirst picks WB.
    // Gate resolves WA (oldest by createdAt 2020 < 2021).
    const wsB = await prisma.workspace.create({
      data: {
        name: "W2D WB",
        slug: `w2dwb-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date("2021-01-01T00:00:00.000Z"),
      },
    });
    const wsA = await prisma.workspace.create({
      data: {
        name: "W2D WA",
        slug: `w2dwa-${Math.random().toString(36).slice(2, 7)}`,
        createdAt: new Date("2020-01-01T00:00:00.000Z"),
      },
    });

    // projectB inserted first → unscoped findFirst returns WB
    const projectB = await prisma.project.create({ data: { key: "W2DKEY", name: "WB Project", workspaceId: wsB.id } });
    const projectA = await prisma.project.create({ data: { key: "W2DKEY", name: "WA Project", workspaceId: wsA.id } });

    // User must be owner in WA (owner required for DELETE — no PM row needed due to bypass).
    const ownerInWA = await seedTestMemberWithRole(wsA.id, "owner");
    await prisma.member.create({
      data: {
        username: `w2dwb-own-${Math.random().toString(36).slice(2, 7)}`,
        role: "owner",
        userId: ownerInWA.userId,
        workspaceId: wsB.id,
      },
    });

    const res = await app.inject({
      method: "DELETE",
      url: `/api/projects/W2DKEY`,
      headers: { authorization: `Bearer ${ownerInWA.token}` },
    });

    expect(res.statusCode).toBe(200);

    const [dbA, dbB] = await Promise.all([
      prisma.project.findUnique({ where: { id: projectA.id }, select: { archived: true } }),
      prisma.project.findUnique({ where: { id: projectB.id }, select: { archived: true } }),
    ]);
    expect(dbA?.archived).toBe(true);   // gate-resolved WA must be archived
    expect(dbB?.archived).toBe(false);  // WB must be untouched
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
