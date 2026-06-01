import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
  authHeader,
} from "../../test/helpers.js";

/**
 * Integration tests for invite routes — PR1 scope.
 *
 * Verifies that request.member.role (populated by requireRole preHandler)
 * is forwarded into createInvite and createOnboardingInvite so that
 * owner-cap enforcement works end-to-end at the HTTP layer.
 *
 * Tasks covered: 3.1 (RED) and 3.2 (GREEN).
 */
describe("POST /api/workspaces/:wid/invites — project assignment routing", () => {
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

  // 3.1-T1: admin inviter + role:owner assignment → 403 ROLE_CAP_EXCEEDED
  it("admin inviter with role:owner assignment → 403 ROLE_CAP_EXCEEDED", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const project = await seedTestProject(ws.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/invites`,
      headers: authHeader(admin.token),
      payload: {
        role: "member",
        maxUses: 0,
        expiresInHours: 48,
        projectAssignments: [{ projectId: project.id, role: "owner" }],
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe("ROLE_CAP_EXCEEDED");
  });

  // 3.1-T2: owner inviter + role:owner assignment → 201 created
  it("owner inviter with role:owner assignment → 201 created", async () => {
    const ws = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(ws.id, "owner");
    const project = await seedTestProject(ws.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/invites`,
      headers: authHeader(owner.token),
      payload: {
        role: "member",
        maxUses: 0,
        expiresInHours: 48,
        projectAssignments: [{ projectId: project.id, role: "owner" }],
      },
    });

    expect(res.statusCode).toBe(201);
  });

  // 3.1-T3: out-of-workspace projectId → 422 INVALID_PROJECT
  it("projectId from another workspace → 422 INVALID_PROJECT", async () => {
    const ws = await seedTestWorkspace();
    const otherWs = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const foreignProject = await seedTestProject(otherWs.id);

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/invites`,
      headers: authHeader(admin.token),
      payload: {
        role: "member",
        maxUses: 0,
        expiresInHours: 48,
        projectAssignments: [{ projectId: foreignProject.id, role: "member" }],
      },
    });

    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe("INVALID_PROJECT");
  });

  // 3.1-T4: no assignments → unchanged behavior (201)
  it("no assignments → 201 (existing behavior preserved)", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/invites`,
      headers: authHeader(admin.token),
      payload: {
        role: "member",
        maxUses: 0,
        expiresInHours: 48,
      },
    });

    expect(res.statusCode).toBe(201);
  });
});

describe("POST /api/workspaces/:wid/invites/onboarding — project assignment routing", () => {
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

  // 3.1-T5: admin inviter + role:owner onboarding assignment → 403
  it("admin inviter with role:owner assignment → 403 ROLE_CAP_EXCEEDED", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const project = await seedTestProject(ws.id);
    // Target user must exist and be a member
    const target = await seedTestMemberWithRole(ws.id, "member");

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/invites/onboarding`,
      headers: authHeader(admin.token),
      payload: {
        userId: target.userId,
        ttlHours: 24,
        role: "member",
        projectAssignments: [{ projectId: project.id, role: "owner" }],
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe("ROLE_CAP_EXCEEDED");
  });

  // 3.1-T6: owner inviter + role:owner onboarding assignment → 201
  it("owner inviter with role:owner assignment → 201 created", async () => {
    const ws = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(ws.id, "owner");
    const project = await seedTestProject(ws.id);
    const target = await seedTestMemberWithRole(ws.id, "member");

    const res = await app.inject({
      method: "POST",
      url: `/api/workspaces/${ws.id}/invites/onboarding`,
      headers: authHeader(owner.token),
      payload: {
        userId: target.userId,
        ttlHours: 24,
        role: "member",
        projectAssignments: [{ projectId: project.id, role: "owner" }],
      },
    });

    expect(res.statusCode).toBe(201);
  });
});
