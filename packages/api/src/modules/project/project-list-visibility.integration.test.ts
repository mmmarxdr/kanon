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
  generateTestToken,
} from "../../test/helpers.js";

/**
 * KAN-222: GET /api/workspaces/:wid/projects must return only openable projects.
 */
describe("KAN-222: project list visibility", () => {
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
    const ws = await seedTestWorkspace(`vis${Math.random().toString(36).slice(2, 7)}`);
    workspaceId = ws.id;
  });

  it("S1: assigned member with no PM sees empty list and 403 on open", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const project = await seedTestProject(workspaceId, "HID1");

    const list = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspaceId}/projects`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toEqual([]);

    const open = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(open.statusCode).toBe(403);
  });

  it("S2: assigned member with PM sees only assigned projects", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const p1 = await seedTestProject(workspaceId, "SEE1");
    const p2 = await seedTestProject(workspaceId, "HID2");
    await seedTestProjectMember(member.userId, p1.id, "member");

    const list = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspaceId}/projects`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(list.statusCode).toBe(200);
    const keys = list.json().map((p: { key: string }) => p.key);
    expect(keys).toEqual(["SEE1"]);
    expect(keys).not.toContain("HID2");

    const openOk = await app.inject({
      method: "GET",
      url: `/api/projects/${p1.key}`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(openOk.statusCode).toBe(200);

    const openDenied = await app.inject({
      method: "GET",
      url: `/api/projects/${p2.key}`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(openDenied.statusCode).toBe(403);
  });

  it("S3: workspace-mode member sees and opens all projects without PM rows", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member", {
      projectAccess: "workspace",
    });
    const p1 = await seedTestProject(workspaceId, "WS1");
    const p2 = await seedTestProject(workspaceId, "WS2");

    const list = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspaceId}/projects`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(list.statusCode).toBe(200);
    const keys = list.json().map((p: { key: string }) => p.key).sort();
    expect(keys).toEqual(["WS1", "WS2"]);

    for (const project of [p1, p2]) {
      const open = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}`,
        headers: { authorization: `Bearer ${member.token}` },
      });
      expect(open.statusCode).toBe(200);
    }
  });

  it("S4: owner sees all projects without PM rows", async () => {
    const owner = await seedTestMemberWithRole(workspaceId, "owner");
    await seedTestProject(workspaceId, "OWN1");
    await seedTestProject(workspaceId, "OWN2");

    const list = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspaceId}/projects`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(2);
  });

  it("S5: token allowlist intersects workspace-mode visibility", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member", {
      projectAccess: "workspace",
    });
    const p1 = await seedTestProject(workspaceId, "TOK1");
    await seedTestProject(workspaceId, "TOK2");

    const scopedToken = generateTestToken({
      userId: member.userId,
      email: member.email,
      allowedProjectIds: [p1.id],
    });

    const list = await app.inject({
      method: "GET",
      url: `/api/workspaces/${workspaceId}/projects`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().map((p: { key: string }) => p.key)).toEqual(["TOK1"]);
  });

  it("S6: a scoped owner cannot create, edit, or archive outside the token allowlist", async () => {
    const owner = await seedTestMemberWithRole(workspaceId, "owner");
    const allowed = await seedTestProject(workspaceId, "OWNCRD");
    const denied = await seedTestProject(workspaceId, "OWNDEN");
    const scopedToken = generateTestToken({
      userId: owner.userId,
      email: owner.email,
      allowedProjectIds: [allowed.id],
    });
    const headers = { authorization: `Bearer ${scopedToken}` };

    const create = await app.inject({
      method: "POST",
      url: `/api/workspaces/${workspaceId}/projects`,
      headers,
      payload: { key: "NEWPRJ", name: "New project" },
    });
    const editDenied = await app.inject({
      method: "PATCH",
      url: `/api/workspaces/${workspaceId}/projects/${denied.id}`,
      headers,
      payload: { name: "Denied edit" },
    });
    const archiveDenied = await app.inject({
      method: "DELETE",
      url: `/api/workspaces/${workspaceId}/projects/${denied.id}`,
      headers,
    });
    const editAllowed = await app.inject({
      method: "PATCH",
      url: `/api/workspaces/${workspaceId}/projects/${allowed.id}`,
      headers,
      payload: { name: "Allowed edit" },
    });

    expect(create.statusCode).toBe(403);
    expect(editDenied.statusCode).toBe(404);
    expect(archiveDenied.statusCode).toBe(404);
    expect(editAllowed.statusCode).toBe(200);
  });
});
