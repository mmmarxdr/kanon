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
    });

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
});
