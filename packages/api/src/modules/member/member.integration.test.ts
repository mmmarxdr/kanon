import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
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

/**
 * Integration tests for workspace member management routes
 * and route authorization enforcement.
 */
describe("Workspace Member Management", () => {
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

  // ── Task 5.3: Member CRUD routes ───────────────────────────────────

  describe("POST /api/workspaces/:wid/members", () => {
    it("owner adds a member (201)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");

      // Create a user to add
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash("password123", 4);
      const newUser = await prisma.user.create({
        data: {
          email: "newmember@test.com",
          passwordHash: hash,
          displayName: "New Member",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { email: "newmember@test.com", role: "member" },
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.role).toBe("member");
      expect(body.user.email).toBe("newmember@test.com");
    });

    it("admin adds a member (201)", async () => {
      const ws = await seedTestWorkspace();
      // Need an owner first, then an admin
      await seedTestMemberWithRole(ws.id, "owner");
      const admin = await seedTestMemberWithRole(ws.id, "admin");

      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash("password123", 4);
      await prisma.user.create({
        data: {
          email: "invited@test.com",
          passwordHash: hash,
          displayName: "Invited User",
        },
      });

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { email: "invited@test.com", role: "viewer" },
      });

      expect(res.statusCode).toBe(201);
      expect(res.json().role).toBe("viewer");
    });

    it("returns 404 for non-existent user email", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { email: "noone@nonexistent.com", role: "member" },
      });

      expect(res.statusCode).toBe(404);
    });

    it("returns 409 for duplicate membership", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const existingMember = await seedTestMemberWithRole(ws.id, "member");

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { email: existingMember.email, role: "member" },
      });

      expect(res.statusCode).toBe(409);
    });

    it("returns 403 when member-role user tries to add a member", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const member = await seedTestMemberWithRole(ws.id, "member");

      const res = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { email: "anyone@test.com", role: "viewer" },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("GET /api/workspaces/:wid/members", () => {
    it("returns member list (200)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      await seedTestMemberWithRole(ws.id, "admin");
      await seedTestMemberWithRole(ws.id, "member");

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${owner.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(3);
      // Each member should have user info
      for (const m of body) {
        expect(m).toHaveProperty("id");
        expect(m).toHaveProperty("role");
        expect(m).toHaveProperty("user");
        expect(m.user).toHaveProperty("email");
      }
    });

    it("viewer can list members (200)", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const viewer = await seedTestMemberWithRole(ws.id, "viewer");

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${viewer.token}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it("non-member gets 403", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      // Create user in different workspace
      const otherWs = await seedTestWorkspace();
      const outsider = await seedTestMemberWithRole(otherWs.id, "owner");

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${outsider.token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("PATCH /api/workspaces/:wid/members/:mid", () => {
    it("owner changes member role (200)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const member = await seedTestMemberWithRole(ws.id, "member");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/workspaces/${ws.id}/members/${member.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { role: "admin" },
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe("admin");
    });

    it("rejects demotion of last owner (422)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/workspaces/${ws.id}/members/${owner.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { role: "admin" },
      });

      expect(res.statusCode).toBe(422);
    });

    it("admin cannot promote to owner (403)", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const admin = await seedTestMemberWithRole(ws.id, "admin");
      const member = await seedTestMemberWithRole(ws.id, "member");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/workspaces/${ws.id}/members/${member.id}`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { role: "owner" },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  describe("DELETE /api/workspaces/:wid/members/:mid", () => {
    it("owner removes a member (204)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const member = await seedTestMemberWithRole(ws.id, "member");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/members/${member.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
      });

      expect(res.statusCode).toBe(204);
    });

    it("rejects removal of last owner (422)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/members/${owner.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
      });

      expect(res.statusCode).toBe(422);
    });

    it("admin cannot remove owner (403)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const admin = await seedTestMemberWithRole(ws.id, "admin");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/members/${owner.id}`,
        headers: { authorization: `Bearer ${admin.token}` },
      });

      expect(res.statusCode).toBe(403);
    });
  });

  // ── Task 5.4: Route authorization enforcement ─────────────────────

  describe("Route Authorization", () => {
    it("non-member gets 404 on project read (project not in their workspace)", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const project = await seedTestProject(ws.id);

      // Create an outsider user — belongs to a different workspace, not ws
      const otherWs = await seedTestWorkspace();
      const outsider = await seedTestMemberWithRole(otherWs.id, "owner");

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}`,
        headers: { authorization: `Bearer ${outsider.token}` },
      });

      // R-KAN16-bug: project lookup is scoped to user's workspaces.
      // Since outsider is NOT in ws, the project is invisible → 404 (not 403).
      expect(res.statusCode).toBe(404);
    });

    it("viewer can read projects (200)", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const viewer = await seedTestMemberWithRole(ws.id, "viewer");
      const project = await seedTestProject(ws.id);
      // KAN-16: viewer needs an explicit PM row to access project-scoped routes
      await seedTestProjectMember(viewer.userId, project.id, "viewer");

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}`,
        headers: { authorization: `Bearer ${viewer.token}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it("viewer gets 403 on issue creation (write)", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const viewer = await seedTestMemberWithRole(ws.id, "viewer");
      const project = await seedTestProject(ws.id);

      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/issues`,
        headers: { authorization: `Bearer ${viewer.token}` },
        payload: { title: "Should fail", type: "task" },
      });

      expect(res.statusCode).toBe(403);
    });

    it("member can create issues (200/201)", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const member = await seedTestMemberWithRole(ws.id, "member");
      const project = await seedTestProject(ws.id);
      // KAN-16: member needs an explicit PM row to access project-scoped routes
      await seedTestProjectMember(member.userId, project.id, "member");

      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/issues`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { title: "Member issue", type: "task" },
      });

      expect(res.statusCode).toBe(201);
    });

    it("admin can manage members", async () => {
      const ws = await seedTestWorkspace();
      await seedTestMemberWithRole(ws.id, "owner");
      const admin = await seedTestMemberWithRole(ws.id, "admin");

      // Admin can list members
      const listRes = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${admin.token}` },
      });
      expect(listRes.statusCode).toBe(200);

      // Admin can add members
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash("password123", 4);
      await prisma.user.create({
        data: {
          email: "manageable@test.com",
          passwordHash: hash,
          displayName: "Manageable",
        },
      });

      const addRes = await app.inject({
        method: "POST",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${admin.token}` },
        payload: { email: "manageable@test.com", role: "viewer" },
      });
      expect(addRes.statusCode).toBe(201);
    });

    it("owner can do everything", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const project = await seedTestProject(ws.id);

      // Read project
      const readRes = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}`,
        headers: { authorization: `Bearer ${owner.token}` },
      });
      expect(readRes.statusCode).toBe(200);

      // Create issue
      const issueRes = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/issues`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { title: "Owner issue", type: "task" },
      });
      expect(issueRes.statusCode).toBe(201);

      // List members
      const membersRes = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${owner.token}` },
      });
      expect(membersRes.statusCode).toBe(200);

      // Update workspace
      const updateRes = await app.inject({
        method: "PATCH",
        url: `/api/workspaces/${ws.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
        payload: { name: "Updated Name" },
      });
      expect(updateRes.statusCode).toBe(200);
    });
  });

  // ── B-01: Cascade — ws removeMember deletes ProjectMember rows ───

  describe("DELETE /api/workspaces/:wid/members/:mid — cascade PM cleanup (R-PMM-cascade)", () => {
    it("B-01a: removes PM rows scoped to the workspace when the ws member is deleted", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const target = await seedTestMemberWithRole(ws.id, "member");

      // Seed two projects in the same workspace with PM rows for the target
      const proj1 = await seedTestProject(ws.id);
      const proj2 = await seedTestProject(ws.id);
      await seedTestProjectMember(target.userId, proj1.id, "member");
      await seedTestProjectMember(target.userId, proj2.id, "admin");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/members/${target.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
      });

      expect(res.statusCode).toBe(204);

      // Confirm PM rows are gone
      const remaining = await prisma.projectMember.findMany({
        where: { userId: target.userId },
      });
      expect(remaining).toHaveLength(0);
    });

    it("B-01b: cascade does not delete PM rows of other users in same workspace", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const target = await seedTestMemberWithRole(ws.id, "member");
      const bystander = await seedTestMemberWithRole(ws.id, "member");

      const proj = await seedTestProject(ws.id);
      await seedTestProjectMember(target.userId, proj.id, "member");
      await seedTestProjectMember(bystander.userId, proj.id, "admin");

      await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/members/${target.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
      });

      // Bystander's PM row must still exist
      const bystanderPm = await prisma.projectMember.findUnique({
        where: { userId_projectId: { userId: bystander.userId, projectId: proj.id } },
      });
      expect(bystanderPm).not.toBeNull();
    });

    it("B-01c: cascade does not delete PM rows in OTHER workspaces for the same user", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const target = await seedTestMemberWithRole(ws.id, "member");

      // Other workspace — same user is a member there too
      const otherWs = await seedTestWorkspace();
      // Create a fresh ws membership for the same user in the other workspace
      await prisma.member.create({
        data: {
          username: `cross-ws-${target.userId.slice(0, 6)}`,
          role: "member",
          userId: target.userId,
          workspaceId: otherWs.id,
        },
      });
      const otherProj = await seedTestProject(otherWs.id);
      await seedTestProjectMember(target.userId, otherProj.id, "owner");

      // Also seed a PM row in the target workspace to ensure cascade fires there
      const wsProj = await seedTestProject(ws.id);
      await seedTestProjectMember(target.userId, wsProj.id, "member");

      await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/members/${target.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
      });

      // PM row in other workspace's project must survive
      const crossWsPm = await prisma.projectMember.findUnique({
        where: { userId_projectId: { userId: target.userId, projectId: otherProj.id } },
      });
      expect(crossWsPm).not.toBeNull();
    });

    it("B-01d: cascade bypasses project LAST_OWNER — no 422 when removed user is sole project owner", async () => {
      const ws = await seedTestWorkspace();
      // Two ws owners so the ws LAST_OWNER guard does not fire
      const owner1 = await seedTestMemberWithRole(ws.id, "owner");
      const target = await seedTestMemberWithRole(ws.id, "owner");

      const proj = await seedTestProject(ws.id);
      // target is the SOLE project owner
      await seedTestProjectMember(target.userId, proj.id, "owner");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/workspaces/${ws.id}/members/${target.id}`,
        headers: { authorization: `Bearer ${owner1.token}` },
      });

      // Must succeed — no LAST_OWNER error from the project side
      expect(res.statusCode).toBe(204);

      // PM row gone
      const pm = await prisma.projectMember.findUnique({
        where: { userId_projectId: { userId: target.userId, projectId: proj.id } },
      });
      expect(pm).toBeNull();
    });
  });

  // ── Task 5.5: Auto-owner on workspace creation ────────────────────

  describe("Auto-owner on workspace creation", () => {
    it("creates workspace and automatically assigns creator as owner", async () => {
      // Create a user with auth token (not via seedTestMember which creates its own workspace membership)
      // isInstanceAdmin=true required: POST /api/workspaces is guarded by requireInstanceAdmin (KAN-49 PR1a)
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash("password123", 4);
      const user = await prisma.user.create({
        data: {
          email: "creator@test.com",
          passwordHash: hash,
          displayName: "Creator",
          isInstanceAdmin: true,
        },
      });

      const { generateTestToken } = await import("../../test/helpers.js");
      const token = generateTestToken({ userId: user.id, email: user.email });

      const res = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "New Workspace", slug: "new-workspace" },
      });

      expect(res.statusCode).toBe(201);
      const workspace = res.json();

      // Verify the creator is automatically an owner
      const members = await prisma.member.findMany({
        where: { workspaceId: workspace.id },
      });

      expect(members).toHaveLength(1);
      expect(members[0]!.userId).toBe(user.id);
      expect(members[0]!.role).toBe("owner");
    });

    it("list members of new workspace returns exactly 1 owner", async () => {
      // isInstanceAdmin=true required: POST /api/workspaces is guarded by requireInstanceAdmin (KAN-49 PR1a)
      const bcrypt = await import("bcryptjs");
      const hash = await bcrypt.hash("password123", 4);
      const user = await prisma.user.create({
        data: {
          email: "autoowner@test.com",
          passwordHash: hash,
          displayName: "Auto Owner",
          isInstanceAdmin: true,
        },
      });

      const { generateTestToken } = await import("../../test/helpers.js");
      const token = generateTestToken({ userId: user.id, email: user.email });

      // Create workspace
      const createRes = await app.inject({
        method: "POST",
        url: "/api/workspaces",
        headers: { authorization: `Bearer ${token}` },
        payload: { name: "Owner Test WS", slug: "owner-test-ws" },
      });
      expect(createRes.statusCode).toBe(201);
      const ws = createRes.json();

      // List members via API
      const listRes = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(listRes.statusCode).toBe(200);
      const members = listRes.json();
      expect(members).toHaveLength(1);
      expect(members[0].role).toBe("owner");
      expect(members[0].user.email).toBe("autoowner@test.com");
    });
  });
});
