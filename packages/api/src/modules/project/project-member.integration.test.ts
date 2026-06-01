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
 * Integration tests for KAN-17: Project Member Management.
 *
 * Covers spec scenarios:
 *   R-PMM-list   — GET /api/projects/:key/members
 *   R-PMM-add    — POST /api/projects/:key/members
 *   R-PMM-patch  — PATCH /api/projects/:key/members/:pmId
 *   R-PMM-delete — DELETE /api/projects/:key/members/:pmId
 *   R-INV1       — pmId discipline (source:'project' carries pmId; source:'workspace' never does)
 */
describe("KAN-17: Project Member Management", () => {
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
    const ws = await seedTestWorkspace(`pmm${Math.random().toString(36).slice(2, 7)}`);
    workspaceId = ws.id;
  });

  // ── R-PMM-list ─────────────────────────────────────────────────────────────

  describe("GET /api/projects/:key/members (R-PMM-list)", () => {
    it("A-02a(1): returns both explicit PM rows and implicit ws-owner rows", async () => {
      const wsOwner = await seedTestMemberWithRole(workspaceId, "owner");
      const pmMember = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "LIST1");
      const pm = await seedTestProjectMember(pmMember.userId, project.id, "member");

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/members`,
        headers: { authorization: `Bearer ${pmMember.token}` },
      });

      expect(res.statusCode).toBe(200);
      const body = res.json() as { members: unknown[] };
      const members = body.members;
      expect(Array.isArray(members)).toBe(true);

      // Explicit PM row
      const explicitRow = members.find((m: any) => m.source === "project");
      expect(explicitRow).toBeDefined();
      expect((explicitRow as any).pmId).toBe(pm.id);
      expect((explicitRow as any).role).toBe("member");

      // Implicit ws-owner row
      const implicitRow = members.find(
        (m: any) => m.source === "workspace" && m.userId === wsOwner.userId,
      );
      expect(implicitRow).toBeDefined();
      expect((implicitRow as any).pmId).toBeUndefined();
      expect((implicitRow as any).implicit).toBe(true);
    });

    it("A-02a(2): viewer with PM row can list (R-PMM-list viewer scenario)", async () => {
      const viewer = await seedTestMemberWithRole(workspaceId, "viewer");
      const project = await seedTestProject(workspaceId, "LIST2");
      await seedTestProjectMember(viewer.userId, project.id, "viewer");

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/members`,
        headers: { authorization: `Bearer ${viewer.token}` },
      });

      expect(res.statusCode).toBe(200);
    });

    it("A-02a(3): non-member (no PM row, not ws owner/admin) gets 403", async () => {
      const nonMember = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "LIST3");
      // No PM row for nonMember

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/members`,
        headers: { authorization: `Bearer ${nonMember.token}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it("A-02a(R-INV1): source:project rows have pmId; source:workspace rows do NOT", async () => {
      const wsAdmin = await seedTestMemberWithRole(workspaceId, "admin");
      const pmMember = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "INV1L");
      await seedTestProjectMember(pmMember.userId, project.id, "member");

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/members`,
        headers: { authorization: `Bearer ${wsAdmin.token}` },
      });

      expect(res.statusCode).toBe(200);
      const { members } = res.json() as { members: any[] };

      for (const row of members) {
        if (row.source === "project") {
          expect(typeof row.pmId).toBe("string");
          expect(row.implicit).toBeUndefined();
        } else if (row.source === "workspace") {
          expect(row.pmId).toBeUndefined();
          expect(row.implicit).toBe(true);
        }
      }
    });

    it("A-02a(dedup): ws-admin with explicit PM row shows source:project (explicit wins)", async () => {
      const wsAdmin = await seedTestMemberWithRole(workspaceId, "admin");
      const project = await seedTestProject(workspaceId, "DEDUP");
      const pm = await seedTestProjectMember(wsAdmin.userId, project.id, "viewer");

      const res = await app.inject({
        method: "GET",
        url: `/api/projects/${project.key}/members`,
        headers: { authorization: `Bearer ${wsAdmin.token}` },
      });

      expect(res.statusCode).toBe(200);
      const { members } = res.json() as { members: any[] };

      // The wsAdmin should appear exactly ONCE (explicit wins)
      const adminRows = members.filter((m: any) => m.userId === wsAdmin.userId);
      expect(adminRows).toHaveLength(1);
      expect(adminRows[0].source).toBe("project");
      expect(adminRows[0].pmId).toBe(pm.id);
      expect(adminRows[0].role).toBe("viewer");
    });
  });

  // ── R-PMM-add ──────────────────────────────────────────────────────────────

  describe("POST /api/projects/:key/members (R-PMM-add)", () => {
    it("A-03a(1): admin adds ws member → 201, pmId set, source:project", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "ADD1");
      // Give admin a PM row so requireProjectRole('admin') passes
      await seedTestProjectMember(admin.userId, project.id, "admin");

      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/members`,
        headers: {
          authorization: `Bearer ${admin.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: target.email, role: "member" }),
      });

      expect(res.statusCode).toBe(201);
      const body = res.json();
      expect(body.source).toBe("project");
      expect(typeof body.pmId).toBe("string");
      expect(body.role).toBe("member");
      expect(body.userId).toBe(target.userId);
    });

    it("A-03a(2): target not a ws member → 422 NOT_WORKSPACE_MEMBER", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const project = await seedTestProject(workspaceId, "ADD2");
      await seedTestProjectMember(admin.userId, project.id, "admin");

      // Create a user NOT in this workspace
      const otherWs = await seedTestWorkspace(`other${Math.random().toString(36).slice(2, 5)}`);
      const outsider = await seedTestMemberWithRole(otherWs.id, "member");

      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/members`,
        headers: {
          authorization: `Bearer ${admin.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: outsider.email, role: "member" }),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("NOT_WORKSPACE_MEMBER");
    });

    it("A-03a(3): duplicate PM row → 409 ALREADY_PROJECT_MEMBER", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "ADD3");
      await seedTestProjectMember(admin.userId, project.id, "admin");
      await seedTestProjectMember(target.userId, project.id, "member");

      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/members`,
        headers: {
          authorization: `Bearer ${admin.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: target.email, role: "member" }),
      });

      expect(res.statusCode).toBe(409);
      expect(res.json().code).toBe("ALREADY_PROJECT_MEMBER");
    });

    it("A-03a(4): admin sets role:owner → 403 ROLE_CAP_EXCEEDED", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "ADD4");
      await seedTestProjectMember(admin.userId, project.id, "admin");

      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/members`,
        headers: {
          authorization: `Bearer ${admin.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: target.email, role: "owner" }),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("ROLE_CAP_EXCEEDED");
    });

    it("A-03a(5): ws-admin (no PM row) can add via bypass", async () => {
      const wsAdmin = await seedTestMemberWithRole(workspaceId, "admin");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "ADD5");
      // No PM row for wsAdmin — bypass applies

      const res = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/members`,
        headers: {
          authorization: `Bearer ${wsAdmin.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: target.email, role: "member" }),
      });

      expect(res.statusCode).toBe(201);
    });
  });

  // ── R-PMM-patch ────────────────────────────────────────────────────────────

  describe("PATCH /api/projects/:key/members/:pmId (R-PMM-patch)", () => {
    it("A-04a(1): admin demotes member → 200, role updated", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "PAT1");
      await seedTestProjectMember(admin.userId, project.id, "admin");
      const targetPm = await seedTestProjectMember(target.userId, project.id, "admin");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.key}/members/${targetPm.id}`,
        headers: {
          authorization: `Bearer ${admin.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "member" }),
      });

      expect(res.statusCode).toBe(200);
      expect(res.json().role).toBe("member");
    });

    it("A-04a(2): admin cannot promote to owner → 403 ROLE_CAP_EXCEEDED", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "PAT2");
      await seedTestProjectMember(admin.userId, project.id, "admin");
      const targetPm = await seedTestProjectMember(target.userId, project.id, "member");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.key}/members/${targetPm.id}`,
        headers: {
          authorization: `Bearer ${admin.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "owner" }),
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("ROLE_CAP_EXCEEDED");
    });

    it("A-04a(3): sole PM owner demotion → 422 LAST_OWNER", async () => {
      const owner = await seedTestMemberWithRole(workspaceId, "owner");
      const project = await seedTestProject(workspaceId, "PAT3");
      const ownerPm = await seedTestProjectMember(owner.userId, project.id, "owner");
      // owner is the SOLE PM owner

      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.key}/members/${ownerPm.id}`,
        headers: {
          authorization: `Bearer ${owner.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "admin" }),
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("LAST_OWNER");
    });

    it("A-04a(4): actor below target role → 403", async () => {
      const actorMember = await seedTestMemberWithRole(workspaceId, "member");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "PAT4");
      await seedTestProjectMember(actorMember.userId, project.id, "member");
      const targetPm = await seedTestProjectMember(target.userId, project.id, "admin");

      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.key}/members/${targetPm.id}`,
        headers: {
          authorization: `Bearer ${actorMember.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "member" }),
      });

      expect(res.statusCode).toBe(403);
    });

    it("A-04a(5): PATCH on ws Member.id (not a PM row) → 404 (R-INV1 id-discipline)", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "PAT5");
      await seedTestProjectMember(admin.userId, project.id, "admin");
      await seedTestProjectMember(target.userId, project.id, "member");

      // Use the workspace Member.id of `target`, NOT its PM id
      const wsMemberId = target.id;

      const res = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.key}/members/${wsMemberId}`,
        headers: {
          authorization: `Bearer ${admin.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "member" }),
      });

      expect(res.statusCode).toBe(404);
    });
  });

  // ── R-PMM-delete ───────────────────────────────────────────────────────────

  describe("DELETE /api/projects/:key/members/:pmId (R-PMM-delete)", () => {
    it("A-05a(1): admin removes member → 204", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "DEL1");
      await seedTestProjectMember(admin.userId, project.id, "admin");
      const targetPm = await seedTestProjectMember(target.userId, project.id, "member");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}/members/${targetPm.id}`,
        headers: { authorization: `Bearer ${admin.token}` },
      });

      expect(res.statusCode).toBe(204);

      // Verify PM row deleted
      const deleted = await prisma.projectMember.findUnique({
        where: { id: targetPm.id },
      });
      expect(deleted).toBeNull();
    });

    it("A-05a(2): sole PM owner removal → 422 LAST_OWNER", async () => {
      const owner = await seedTestMemberWithRole(workspaceId, "owner");
      const project = await seedTestProject(workspaceId, "DEL2");
      const ownerPm = await seedTestProjectMember(owner.userId, project.id, "owner");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}/members/${ownerPm.id}`,
        headers: { authorization: `Bearer ${owner.token}` },
      });

      expect(res.statusCode).toBe(422);
      expect(res.json().code).toBe("LAST_OWNER");
    });

    it("A-05a(3): self-removal when another owner exists → 204", async () => {
      const owner1 = await seedTestMemberWithRole(workspaceId, "owner");
      const owner2 = await seedTestMemberWithRole(workspaceId, "owner");
      const project = await seedTestProject(workspaceId, "DEL3");
      const pm1 = await seedTestProjectMember(owner1.userId, project.id, "owner");
      await seedTestProjectMember(owner2.userId, project.id, "owner");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}/members/${pm1.id}`,
        headers: { authorization: `Bearer ${owner1.token}` },
      });

      expect(res.statusCode).toBe(204);
    });

    it("A-05a(4): actor below target role → 403", async () => {
      const actorMember = await seedTestMemberWithRole(workspaceId, "member");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "DEL4");
      await seedTestProjectMember(actorMember.userId, project.id, "member");
      const targetPm = await seedTestProjectMember(target.userId, project.id, "admin");

      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}/members/${targetPm.id}`,
        headers: { authorization: `Bearer ${actorMember.token}` },
      });

      expect(res.statusCode).toBe(403);
    });

    it("A-05a(5): DELETE on ws Member.id (not a PM row) → 404 (R-INV1 id-discipline)", async () => {
      const admin = await seedTestMemberWithRole(workspaceId, "admin");
      const target = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "DEL5");
      await seedTestProjectMember(admin.userId, project.id, "admin");
      await seedTestProjectMember(target.userId, project.id, "member");

      // Use ws Member.id, not PM id
      const wsMemberId = target.id;

      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}/members/${wsMemberId}`,
        headers: { authorization: `Bearer ${admin.token}` },
      });

      expect(res.statusCode).toBe(404);
    });

    /**
     * W-1: Service-level actor>=target guard (service.ts line 252).
     *
     * The existing A-05a(4) gives the actor ws:member+PM:member — the gate
     * rejects them (effectiveRole='member' < 'admin') so service.ts is never
     * reached.  This test constructs a case that BYPASSES the gate but is
     * blocked by the service guard:
     *
     *   actor:  ws role 'member' + PM role 'admin'
     *           → enforceProjectAccess Step 3: effectiveRole = pm.role = 'admin'
     *           → requireProjectRole("key","admin") passes (admin >= admin)
     *
     *   target: PM role 'owner' (LAST_OWNER bypassed: a 2nd PM owner exists)
     *
     *   service guard: roleLevel('admin'=2) < roleLevel('owner'=3) → 403 FORBIDDEN
     *   message: "Insufficient permissions to remove this member" (NOT gate message)
     *
     * Positive control: same actor successfully removes a PM:member target first,
     * proving the gate was passed before the protected delete.
     */
    it("W-1: actor PM:admin passes gate but is blocked by service guard when target is PM:owner (not gate 403)", async () => {
      // Actor: ws:member but PM:admin — passes requireProjectRole("key","admin")
      const actor = await seedTestMemberWithRole(workspaceId, "member");
      // Two owners so LAST_OWNER guard does NOT fire
      const owner1 = await seedTestMemberWithRole(workspaceId, "owner");
      const owner2 = await seedTestMemberWithRole(workspaceId, "owner");
      // A plain member target for the positive-control delete
      const plainTarget = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "W1SVC");

      await seedTestProjectMember(actor.userId, project.id, "admin");
      const ownerPm1 = await seedTestProjectMember(owner1.userId, project.id, "owner");
      await seedTestProjectMember(owner2.userId, project.id, "owner");
      const plainPm = await seedTestProjectMember(plainTarget.userId, project.id, "member");

      // Positive control: actor (effectiveRole='admin') CAN remove a PM:member target.
      // This proves the gate passed — if the gate were blocking, this would also be 403.
      const controlRes = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}/members/${plainPm.id}`,
        headers: { authorization: `Bearer ${actor.token}` },
      });
      expect(controlRes.statusCode).toBe(204);

      // Primary assertion: actor (effectiveRole='admin') CANNOT remove a PM:owner target.
      // LAST_OWNER is NOT in play (owner2 still exists). Only the service actor-level
      // guard at service.ts line 252 can produce this 403.
      const res = await app.inject({
        method: "DELETE",
        url: `/api/projects/${project.key}/members/${ownerPm1.id}`,
        headers: { authorization: `Bearer ${actor.token}` },
      });

      expect(res.statusCode).toBe(403);
      // Discriminate: service message, NOT gate message ("requires at least the...")
      expect(res.json().message).toBe("Insufficient permissions to remove this member");

      // Target PM row must still exist — confirm via DB
      const stillThere = await prisma.projectMember.findUnique({
        where: { id: ownerPm1.id },
      });
      expect(stillThere).not.toBeNull();
      expect(stillThere?.role).toBe("owner");
    });
  });

  // ── Owner-cap positive path ────────────────────────────────────────────────

  describe("Owner-cap positive path (W-2)", () => {
    /**
     * W-2: A project owner (effectiveRole='owner') CAN assign role:'owner'.
     *
     * The owner-cap guard in addProjectMember and changeProjectMemberRole only
     * blocks when actingRole !== 'owner'.  This test confirms the permitted path:
     *
     *   actor:  ws role 'owner' → bypass path, effectiveRole = 'owner'
     *
     *   POST role:'owner'  → 201, response.role === 'owner'
     *   PATCH role:'owner' → 200, response.role === 'owner'
     *
     * Both assertions verify the actual persisted value, not just the status code.
     */
    it("W-2: project owner can assign role:owner via POST and PATCH", async () => {
      // Actor: ws owner → bypass gives effectiveRole='owner'
      const wsOwner = await seedTestMemberWithRole(workspaceId, "owner");
      // Two targets: one to POST-add as owner, another to PATCH up to owner
      const newTarget = await seedTestMemberWithRole(workspaceId, "member");
      const existingTarget = await seedTestMemberWithRole(workspaceId, "member");
      const project = await seedTestProject(workspaceId, "W2CAP");

      // Seed existing target as member (will be promoted to owner)
      const existingPm = await seedTestProjectMember(existingTarget.userId, project.id, "member");

      // W-2a: POST with role:'owner' → 201
      const postRes = await app.inject({
        method: "POST",
        url: `/api/projects/${project.key}/members`,
        headers: {
          authorization: `Bearer ${wsOwner.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ email: newTarget.email, role: "owner" }),
      });

      expect(postRes.statusCode).toBe(201);
      const postBody = postRes.json();
      expect(postBody.role).toBe("owner");
      expect(postBody.source).toBe("project");
      expect(typeof postBody.pmId).toBe("string");

      // W-2b: PATCH existing member up to role:'owner' → 200
      const patchRes = await app.inject({
        method: "PATCH",
        url: `/api/projects/${project.key}/members/${existingPm.id}`,
        headers: {
          authorization: `Bearer ${wsOwner.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ role: "owner" }),
      });

      expect(patchRes.statusCode).toBe(200);
      expect(patchRes.json().role).toBe("owner");
    });
  });
});
