/**
 * Integration tests for KAN-79: list endpoints honor the allowedProjectIds
 * token scope. A scoped Bearer token must not enumerate out-of-scope data on
 * the dashboard, the workspace project list, or the workspace member list.
 * Unscoped tokens (cookie / legacy / X-API-Key) keep full visibility.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  cleanDatabase,
  disconnectTestDb,
} from "../test/helpers.js";
import { prisma } from "../config/prisma.js";

function mintScopedAccessToken(
  userId: string,
  workspaceId: string,
  allowedProjectIds: string[],
): string {
  const payload: Record<string, unknown> = {
    sub: userId,
    workspace: workspaceId,
    scope: "access",
    ...(allowedProjectIds.length > 0 ? { allowedProjectIds } : {}),
  };
  return jwt.sign(payload, process.env["JWT_SECRET"]!, { expiresIn: "15m" });
}

describe("KAN-79 — list endpoints honor allowedProjectIds", () => {
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

  // ── GET /api/workspaces/:wid/projects ──────────────────────────────────────
  describe("GET /workspaces/:wid/projects", () => {
    it("scoped token → only the allowed project(s)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const projP = await seedTestProject(ws.id, "PPP");
      const projQ = await seedTestProject(ws.id, "QQQ");

      const token = mintScopedAccessToken(owner.userId, ws.id, [projP.id]);
      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/projects`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toEqual([projP.id]);
      expect(ids).not.toContain(projQ.id);
    });

    it("unscoped token → all workspace projects (backward-compat)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const projP = await seedTestProject(ws.id, "PPP");
      const projQ = await seedTestProject(ws.id, "QQQ");

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/projects`,
        headers: { authorization: `Bearer ${owner.token}` }, // unscoped
      });

      const ids = (res.json() as Array<{ id: string }>).map((p) => p.id);
      expect(ids).toContain(projP.id);
      expect(ids).toContain(projQ.id);
    });
  });

  // ── GET /api/workspaces/:wid/members ───────────────────────────────────────
  describe("GET /workspaces/:wid/members", () => {
    it("scoped token → only members of the allowed project(s)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const projP = await seedTestProject(ws.id, "PPP");
      const projQ = await seedTestProject(ws.id, "QQQ");

      const memberA = await seedTestMemberWithRole(ws.id, "member");
      const memberB = await seedTestMemberWithRole(ws.id, "member");
      await seedTestProjectMember(memberA.userId, projP.id, "member");
      await seedTestProjectMember(memberB.userId, projQ.id, "member");

      const token = mintScopedAccessToken(owner.userId, ws.id, [projP.id]);
      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const ids = (res.json() as Array<{ id: string }>).map((m) => m.id);
      expect(ids).toContain(memberA.id); // PM of P
      expect(ids).not.toContain(memberB.id); // PM of Q only → out of scope
    });

    it("unscoped token → full roster", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const memberA = await seedTestMemberWithRole(ws.id, "member");

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/members`,
        headers: { authorization: `Bearer ${owner.token}` }, // unscoped
      });

      const ids = (res.json() as Array<{ id: string }>).map((m) => m.id);
      expect(ids).toContain(owner.id);
      expect(ids).toContain(memberA.id);
    });
  });

  // ── GET /api/workspaces/:id/proposals (KAN-67) ─────────────────────────────
  describe("GET /workspaces/:id/proposals", () => {
    it("scoped token → allowed-project + workspace-level proposals only", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const projP = await seedTestProject(ws.id, "PPP");
      const projQ = await seedTestProject(ws.id, "QQQ");

      await prisma.mcpProposal.create({
        data: { kind: "generic", status: "pending", title: "P-prop", workspaceId: ws.id, projectId: projP.id },
      });
      await prisma.mcpProposal.create({
        data: { kind: "generic", status: "pending", title: "Q-prop", workspaceId: ws.id, projectId: projQ.id },
      });
      await prisma.mcpProposal.create({
        data: { kind: "generic", status: "pending", title: "WS-prop", workspaceId: ws.id, projectId: null },
      });

      const token = mintScopedAccessToken(owner.userId, ws.id, [projP.id]);
      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/proposals`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const titles = (res.json() as Array<{ title: string }>).map((p) => p.title);
      expect(titles).toContain("P-prop");
      expect(titles).toContain("WS-prop");
      expect(titles).not.toContain("Q-prop");
    });

    it("unscoped token → all workspace proposals", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const projQ = await seedTestProject(ws.id, "QQQ");
      await prisma.mcpProposal.create({
        data: { kind: "generic", status: "pending", title: "Q-prop", workspaceId: ws.id, projectId: projQ.id },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/proposals`,
        headers: { authorization: `Bearer ${owner.token}` }, // unscoped
      });

      const titles = (res.json() as Array<{ title: string }>).map((p) => p.title);
      expect(titles).toContain("Q-prop");
    });
  });

  // ── GET /api/workspaces/:id/dashboard ──────────────────────────────────────
  describe("GET /:id/dashboard", () => {
    it("scoped token → proposals limited to allowed project(s)", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const projP = await seedTestProject(ws.id, "PPP");
      const projQ = await seedTestProject(ws.id, "QQQ");

      await prisma.mcpProposal.create({
        data: { kind: "generic", status: "pending", title: "P-prop", workspaceId: ws.id, projectId: projP.id },
      });
      await prisma.mcpProposal.create({
        data: { kind: "generic", status: "pending", title: "Q-prop", workspaceId: ws.id, projectId: projQ.id },
      });
      // Workspace-level (null-project) proposal — scoped tokens SHOULD still see
      // it, consistent with requireProposalRole.
      await prisma.mcpProposal.create({
        data: { kind: "generic", status: "pending", title: "WS-prop", workspaceId: ws.id, projectId: null },
      });

      const token = mintScopedAccessToken(owner.userId, ws.id, [projP.id]);
      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/dashboard`,
        headers: { authorization: `Bearer ${token}` },
      });

      expect(res.statusCode).toBe(200);
      const titles = (res.json().proposals as Array<{ title: string }>).map((p) => p.title);
      expect(titles).toContain("P-prop");
      expect(titles).toContain("WS-prop"); // null-project proposals stay visible
      expect(titles).not.toContain("Q-prop");
    });

    it("scoped token → activeCycle resolves only within allowed projects", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const projP = await seedTestProject(ws.id, "PPP");
      const projQ = await seedTestProject(ws.id, "QQQ");

      const now = new Date();
      const later = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000);
      // Q's cycle starts more recently → it would "win" if scope were ignored.
      await prisma.cycle.create({
        data: { name: "Cycle P", state: "active", startDate: now, endDate: later, projectId: projP.id },
      });
      await prisma.cycle.create({
        data: {
          name: "Cycle Q",
          state: "active",
          startDate: new Date(now.getTime() + 1000),
          endDate: later,
          projectId: projQ.id,
        },
      });

      const token = mintScopedAccessToken(owner.userId, ws.id, [projP.id]);
      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/dashboard`,
        headers: { authorization: `Bearer ${token}` },
      });

      const body = res.json();
      // Without scoping, Q's more-recent cycle would win; scope forces P's.
      expect(body.activeCycle?.name).toBe("Cycle P");
      // Q's active cycle must not count toward the "multiple active projects" flag.
      expect(body.multipleActiveProjects).toBe(false);
    });

    it("unscoped token → proposals across the workspace", async () => {
      const ws = await seedTestWorkspace();
      const owner = await seedTestMemberWithRole(ws.id, "owner");
      const projP = await seedTestProject(ws.id, "PPP");
      const projQ = await seedTestProject(ws.id, "QQQ");

      await prisma.mcpProposal.create({
        data: { kind: "generic", status: "pending", title: "P-prop", workspaceId: ws.id, projectId: projP.id },
      });
      await prisma.mcpProposal.create({
        data: { kind: "generic", status: "pending", title: "Q-prop", workspaceId: ws.id, projectId: projQ.id },
      });

      const res = await app.inject({
        method: "GET",
        url: `/api/workspaces/${ws.id}/dashboard`,
        headers: { authorization: `Bearer ${owner.token}` }, // unscoped
      });

      const titles = (res.json().proposals as Array<{ title: string }>).map((p) => p.title);
      expect(titles).toContain("P-prop");
      expect(titles).toContain("Q-prop");
    });
  });
});
