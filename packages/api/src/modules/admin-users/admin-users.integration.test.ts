/**
 * Instance-admin user directory — integration tests (KAN-224).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { prisma } from "../../config/prisma.js";
import {
  createTestApp,
  cleanDatabase,
  disconnectTestDb,
  generateTestToken,
  seedInstanceAdminUser,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
} from "../../test/helpers.js";

describe("GET /api/admin/users — list + detail", () => {
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

  it("401 when unauthenticated", async () => {
    const res = await app.inject({ method: "GET", url: "/api/admin/users" });
    expect(res.statusCode).toBe(401);
  });

  it("403 when authenticated but not instance-admin", async () => {
    const user = await prisma.user.create({
      data: {
        email: `plain-${randomUUID().slice(0, 8)}@kanon.test`,
        passwordHash: "$2b$04$placeholder",
      },
    });
    const token = generateTestToken({ userId: user.id, email: user.email });
    const res = await app.inject({
      method: "GET",
      url: "/api/admin/users",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it("lists users with search, verified filter, and pagination", async () => {
    const { token } = await seedInstanceAdminUser({
      email: `admin-${randomUUID().slice(0, 8)}@kanon.test`,
    });
    const ws = await seedTestWorkspace();

    const verified = await seedTestMemberWithRole(ws.id, "member", {
      email: `alice-${randomUUID().slice(0, 8)}@example.com`,
    });
    await prisma.user.update({
      where: { id: verified.userId },
      data: { emailVerifiedAt: new Date() },
    });

    await seedTestMemberWithRole(ws.id, "member", {
      email: `bob-${randomUUID().slice(0, 8)}@example.com`,
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/users?limit=50&offset=0",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    const body = list.json();
    expect(body.total).toBeGreaterThanOrEqual(3);
    expect(body.limit).toBe(50);
    expect(body.offset).toBe(0);
    expect(body.users[0]).toMatchObject({
      email: expect.any(String),
      emailVerified: expect.any(Boolean),
      workspaceCount: expect.any(Number),
      workspaces: expect.any(Array),
    });
    const aliceRow = body.users.find((u: { id: string }) => u.id === verified.userId);
    expect(aliceRow.workspaces).toEqual([
      expect.objectContaining({ id: ws.id, name: ws.name }),
    ]);

    const search = await app.inject({
      method: "GET",
      url: `/api/admin/users?q=alice`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(search.statusCode).toBe(200);
    const searchBody = search.json();
    expect(searchBody.users.every((u: { email: string }) => u.email.includes("alice"))).toBe(
      true,
    );

    const unverified = await app.inject({
      method: "GET",
      url: "/api/admin/users?verified=false&limit=50",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(unverified.statusCode).toBe(200);
    expect(
      unverified.json().users.every((u: { emailVerified: boolean }) => u.emailVerified === false),
    ).toBe(true);
  });

  it("returns detail with memberships and assigned projects", async () => {
    const { token } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace();
    const project = await seedTestProject(ws.id, "ADM");
    const member = await seedTestMemberWithRole(ws.id, "member", {
      email: `detail-${randomUUID().slice(0, 8)}@example.com`,
      projectAccess: "assigned",
    });
    await seedTestProjectMember(member.userId, project.id, "member");

    const res = await app.inject({
      method: "GET",
      url: `/api/admin/users/${member.userId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const detail = res.json();
    expect(detail.id).toBe(member.userId);
    expect(detail.memberships).toHaveLength(1);
    expect(detail.memberships[0]).toMatchObject({
      memberId: member.id,
      workspaceId: ws.id,
      role: "member",
      projectAccess: "assigned",
    });
    expect(detail.memberships[0].projects).toEqual([
      expect.objectContaining({
        projectId: project.id,
        key: "ADM",
        role: "member",
      }),
    ]);
  });

  it("404 for unknown user detail", async () => {
    const { token } = await seedInstanceAdminUser();
    const res = await app.inject({
      method: "GET",
      url: `/api/admin/users/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it("lists workspaces and projects for assignment pickers", async () => {
    const { token } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace(`admin-ws-${randomUUID().slice(0, 6)}`);
    const project = await seedTestProject(ws.id, "PK");

    const workspaces = await app.inject({
      method: "GET",
      url: "/api/admin/users/workspaces",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(workspaces.statusCode).toBe(200);
    expect(workspaces.json().workspaces).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: ws.id, name: ws.name }),
      ]),
    );

    const projects = await app.inject({
      method: "GET",
      url: `/api/admin/users/workspaces/${ws.id}/projects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(projects.statusCode).toBe(200);
    expect(projects.json().projects).toEqual([
      expect.objectContaining({ id: project.id, key: "PK" }),
    ]);
  });

  it("404 when workspace projects picker targets unknown workspace", async () => {
    const { token } = await seedInstanceAdminUser();
    const res = await app.inject({
      method: "GET",
      url: `/api/admin/users/workspaces/${randomUUID()}/projects`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("WORKSPACE_NOT_FOUND");
  });

  it("filters verified=true and returns workspace-mode memberships without project rows", async () => {
    const { token } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member", {
      email: `verified-${randomUUID().slice(0, 8)}@example.com`,
      projectAccess: "workspace",
    });
    await prisma.user.update({
      where: { id: member.userId },
      data: { emailVerifiedAt: new Date("2026-01-15T12:00:00.000Z") },
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/admin/users?verified=true&limit=50",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(
      list.json().users.every((u: { emailVerified: boolean }) => u.emailVerified),
    ).toBe(true);
    expect(list.json().users.some((u: { id: string }) => u.id === member.userId)).toBe(
      true,
    );

    const detail = await app.inject({
      method: "GET",
      url: `/api/admin/users/${member.userId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(detail.statusCode).toBe(200);
    expect(detail.json().emailVerifiedAt).toBe("2026-01-15T12:00:00.000Z");
    expect(detail.json().memberships[0]).toMatchObject({
      projectAccess: "workspace",
      projects: null,
    });
  });
});

describe("POST/PATCH/DELETE admin user mutations", () => {
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

  it("verifies email idempotently", async () => {
    const { token } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");

    const first = await app.inject({
      method: "POST",
      url: `/api/admin/users/${member.userId}/verify-email`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(first.statusCode).toBe(200);
    expect(first.json()).toMatchObject({
      emailVerified: true,
      alreadyVerified: false,
    });

    const second = await app.inject({
      method: "POST",
      url: `/api/admin/users/${member.userId}/verify-email`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(second.statusCode).toBe(200);
    expect(second.json().alreadyVerified).toBe(true);
  });

  it("adds, patches, replaces projects, and removes membership", async () => {
    const { token, userId: adminId } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace();
    // Ensure workspace has an owner so removals are allowed
    await seedTestMemberWithRole(ws.id, "owner", {
      email: `owner-${randomUUID().slice(0, 8)}@example.com`,
    });
    const projectA = await seedTestProject(ws.id, "PA");
    const projectB = await seedTestProject(ws.id, "PB");

    const target = await prisma.user.create({
      data: {
        email: `target-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: "$2b$04$placeholder",
        displayName: "Target",
      },
    });

    const added = await app.inject({
      method: "POST",
      url: `/api/admin/users/${target.id}/memberships`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workspaceId: ws.id,
        role: "member",
        projectAccess: "assigned",
      },
    });
    expect(added.statusCode).toBe(201);
    const memberId = added.json().memberships[0].memberId as string;

    const patched = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${target.id}/memberships/${memberId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { role: "admin", projectAccess: "assigned" },
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().memberships[0]).toMatchObject({
      role: "admin",
      projectAccess: "assigned",
    });

    const replaced = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${target.id}/memberships/${memberId}/projects`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        projects: [
          { projectId: projectA.id, role: "member" },
          { projectId: projectB.id, role: "viewer" },
        ],
      },
    });
    expect(replaced.statusCode).toBe(200);
    expect(replaced.json().memberships[0].projects).toHaveLength(2);

    const replacedAgain = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${target.id}/memberships/${memberId}/projects`,
      headers: { authorization: `Bearer ${token}` },
      payload: { projects: [{ projectId: projectA.id, role: "pm" }] },
    });
    expect(replacedAgain.statusCode).toBe(200);
    expect(replacedAgain.json().memberships[0].projects).toEqual([
      expect.objectContaining({ projectId: projectA.id, role: "pm" }),
    ]);

    const removed = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${target.id}/memberships/${memberId}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(removed.statusCode).toBe(200);
    expect(removed.json().memberships).toHaveLength(0);

    // actor id used for remove — keep referenced so lint doesn't complain if unused
    expect(adminId).toBeTruthy();
  });

  it("moves a membership to another workspace", async () => {
    const { token } = await seedInstanceAdminUser();
    const source = await seedTestWorkspace();
    const target = await seedTestWorkspace();
    await seedTestMemberWithRole(source.id, "owner");
    const member = await seedTestMemberWithRole(source.id, "member", {
      email: `move-${randomUUID().slice(0, 8)}@example.com`,
      projectAccess: "assigned",
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/admin/users/${member.userId}/memberships/${member.id}/move`,
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: target.id, role: "admin", projectAccess: "workspace" },
    });
    expect(res.statusCode).toBe(200);
    const memberships = res.json().memberships as Array<{
      workspaceId: string;
      role: string;
      projectAccess: string;
    }>;
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({
      workspaceId: target.id,
      role: "admin",
      projectAccess: "workspace",
      projects: null,
    });
  });

  it("422 when add membership gets invalid initial projects and leaves no membership", async () => {
    const { token } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace();
    const otherWs = await seedTestWorkspace();
    const foreign = await seedTestProject(otherWs.id, "FX");
    const target = await prisma.user.create({
      data: {
        email: `orphan-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: "$2b$04$placeholder",
        displayName: "Orphan",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/admin/users/${target.id}/memberships`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workspaceId: ws.id,
        role: "member",
        projectAccess: "assigned",
        projects: [{ projectId: foreign.id, role: "member" }],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_PROJECT");

    const leftover = await prisma.member.findUnique({
      where: { userId_workspaceId: { userId: target.id, workspaceId: ws.id } },
    });
    expect(leftover).toBeNull();
  });

  it("422 when replacing projects on workspace-mode membership", async () => {
    const { token } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace();
    const project = await seedTestProject(ws.id, "WX");
    const member = await seedTestMemberWithRole(ws.id, "member", {
      projectAccess: "workspace",
    });

    const res = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${member.userId}/memberships/${member.id}/projects`,
      headers: { authorization: `Bearer ${token}` },
      payload: { projects: [{ projectId: project.id }] },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_PROJECT_ACCESS");
  });

  it("422 when replace projects includes foreign id and keeps existing assignments", async () => {
    const { token } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace();
    const otherWs = await seedTestWorkspace();
    const project = await seedTestProject(ws.id, "OK");
    const foreign = await seedTestProject(otherWs.id, "FX");
    const member = await seedTestMemberWithRole(ws.id, "member", {
      projectAccess: "assigned",
    });
    await seedTestProjectMember(member.userId, project.id, "pm");

    const res = await app.inject({
      method: "PUT",
      url: `/api/admin/users/${member.userId}/memberships/${member.id}/projects`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        projects: [
          { projectId: project.id, role: "member" },
          { projectId: foreign.id, role: "member" },
        ],
      },
    });
    expect(res.statusCode).toBe(422);
    expect(res.json().code).toBe("INVALID_PROJECT");

    const still = await prisma.projectMember.findMany({
      where: { userId: member.userId, projectId: project.id },
    });
    expect(still).toHaveLength(1);
    expect(still[0]!.role).toBe("pm");
  });

  it("bulk verify and remove_from_workspace", async () => {
    const { token } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace();
    await seedTestMemberWithRole(ws.id, "owner");
    const a = await seedTestMemberWithRole(ws.id, "member");
    const b = await seedTestMemberWithRole(ws.id, "member");

    const verify = await app.inject({
      method: "POST",
      url: "/api/admin/users/bulk",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        action: "verify_email",
        userIds: [a.userId, b.userId],
      },
    });
    expect(verify.statusCode).toBe(200);
    expect(verify.json().results).toEqual([
      { userId: a.userId, ok: true },
      { userId: b.userId, ok: true },
    ]);

    const remove = await app.inject({
      method: "POST",
      url: "/api/admin/users/bulk",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        action: "remove_from_workspace",
        userIds: [a.userId, randomUUID()],
        workspaceId: ws.id,
      },
    });
    expect(remove.statusCode).toBe(200);
    const results = remove.json().results as Array<{
      userId: string;
      ok: boolean;
      error?: string;
    }>;
    expect(results.find((r) => r.userId === a.userId)).toMatchObject({ ok: true });
    expect(results.find((r) => r.userId !== a.userId)).toMatchObject({
      ok: false,
      error: "NOT_A_MEMBER",
    });
  });

  it("covers mutation error paths and workspace-mode add", async () => {
    const { token } = await seedInstanceAdminUser();
    const ws = await seedTestWorkspace();
    await seedTestMemberWithRole(ws.id, "owner");
    const target = await prisma.user.create({
      data: {
        email: `err-${randomUUID().slice(0, 8)}@example.com`,
        passwordHash: "$2b$04$placeholder",
      },
    });

    const verifyMissing = await app.inject({
      method: "POST",
      url: `/api/admin/users/${randomUUID()}/verify-email`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(verifyMissing.statusCode).toBe(404);

    const addMissingUser = await app.inject({
      method: "POST",
      url: `/api/admin/users/${randomUUID()}/memberships`,
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: ws.id, role: "member" },
    });
    expect(addMissingUser.statusCode).toBe(404);
    expect(addMissingUser.json().code).toBe("USER_NOT_FOUND");

    const addMissingWs = await app.inject({
      method: "POST",
      url: `/api/admin/users/${target.id}/memberships`,
      headers: { authorization: `Bearer ${token}` },
      payload: { workspaceId: randomUUID(), role: "member" },
    });
    expect(addMissingWs.statusCode).toBe(404);
    expect(addMissingWs.json().code).toBe("WORKSPACE_NOT_FOUND");

    const addWorkspaceAccess = await app.inject({
      method: "POST",
      url: `/api/admin/users/${target.id}/memberships`,
      headers: { authorization: `Bearer ${token}` },
      payload: {
        workspaceId: ws.id,
        role: "member",
        projectAccess: "workspace",
      },
    });
    expect(addWorkspaceAccess.statusCode).toBe(201);
    expect(addWorkspaceAccess.json().memberships[0].projectAccess).toBe("workspace");

    const emptyPatch = await app.inject({
      method: "PATCH",
      url: `/api/admin/users/${target.id}/memberships/${addWorkspaceAccess.json().memberships[0].memberId}`,
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(emptyPatch.statusCode).toBe(400);

    const wrongMember = await app.inject({
      method: "DELETE",
      url: `/api/admin/users/${target.id}/memberships/${randomUUID()}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(wrongMember.statusCode).toBe(404);
    expect(wrongMember.json().code).toBe("MEMBER_NOT_FOUND");

    const bulkMissingWs = await app.inject({
      method: "POST",
      url: "/api/admin/users/bulk",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        action: "remove_from_workspace",
        userIds: [target.id],
      },
    });
    expect(bulkMissingWs.statusCode).toBe(400);

    // Sole owner removal surfaces as AppError in bulk catch path
    const soleWs = await seedTestWorkspace();
    const soleOwner = await seedTestMemberWithRole(soleWs.id, "owner");
    const bulkLastOwner = await app.inject({
      method: "POST",
      url: "/api/admin/users/bulk",
      headers: { authorization: `Bearer ${token}` },
      payload: {
        action: "remove_from_workspace",
        userIds: [soleOwner.userId],
        workspaceId: soleWs.id,
      },
    });
    expect(bulkLastOwner.statusCode).toBe(200);
    expect(bulkLastOwner.json().results[0]).toMatchObject({
      userId: soleOwner.userId,
      ok: false,
      error: "LAST_OWNER",
    });
  });
});
