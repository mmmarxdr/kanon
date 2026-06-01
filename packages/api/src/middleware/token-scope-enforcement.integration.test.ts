/**
 * Integration tests for KAN-19 PR2: token project scope enforcement.
 *
 * T2.1: scoped token [P] + workspace-admin + project Q → 403 (guard before admin bypass)
 * T2.2: scoped token [P] + project P + ProjectMember → 200/allowed
 * T2.3: scoped token [P] + project P + workspace-member + NO ProjectMember → 403 (PM gate)
 * T2.4: unscoped token (allowedProjectIds=[]) + ProjectMember for P → 200 (backward-compat)
 * T2.5: X-API-Key path → no scope restriction (always unscoped)
 * T2.6: requireIssueRole and requireCycleRole with scoped token [P], issue/cycle in Q → 403
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

/**
 * Mint a scoped Bearer access token for a given user + workspace + allowedProjectIds.
 * Signs with JWT_SECRET using the AccessTokenPayload shape (scope:"access").
 */
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

describe("KAN-19 PR2 — Token Scope Enforcement", () => {
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

  // ── T2.1: scoped [P] + admin + project Q → 403 (scope guard fires before admin bypass) ──

  it("T2.1: scoped token [P] + workspace admin + project Q → 403 even though admin bypass would normally allow", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const projectP = await seedTestProject(ws.id, "TSE_P1");
    const projectQ = await seedTestProject(ws.id, "TSE_Q1");

    // Admin is authorized on projectQ via bypass — without scope guard this would be 200
    // With scope guard [P], accessing Q must be 403
    const scopedToken = mintScopedAccessToken(admin.userId, ws.id, [projectP.id]);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectQ.key}`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── T2.2: scoped [P] + project P + ProjectMember → 200 (scope passes, PM gate passes) ──

  it("T2.2: scoped token [P] + project P + ProjectMember row → access granted", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const projectP = await seedTestProject(ws.id, "TSE_P2");

    // Scope [P] and has a PM row for P
    await seedTestProjectMember(member.userId, projectP.id, "member");

    const scopedToken = mintScopedAccessToken(member.userId, ws.id, [projectP.id]);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectP.key}`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  // ── T2.3: scoped [P] + project P + workspace-member + NO ProjectMember → 403 ──
  // Scope passes precondition but PM gate denies — scope never expands access.

  it("T2.3: scoped token [P] + project P + workspace-member + NO ProjectMember row → 403", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const projectP = await seedTestProject(ws.id, "TSE_P3");

    // Scope [P] — precondition allows P, but no PM row → PM gate must deny
    const scopedToken = mintScopedAccessToken(member.userId, ws.id, [projectP.id]);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectP.key}`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── T2.4: unscoped token (allowedProjectIds=[]) + ProjectMember for P → 200 (backward-compat) ──

  it("T2.4: unscoped/legacy token (no allowedProjectIds claim) + ProjectMember for P → full access unchanged", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const projectP = await seedTestProject(ws.id, "TSE_P4");

    await seedTestProjectMember(member.userId, projectP.id, "member");

    // Mint unscoped access token (no allowedProjectIds claim)
    const unscopedToken = mintScopedAccessToken(member.userId, ws.id, []);

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectP.key}`,
      headers: { authorization: `Bearer ${unscopedToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  // ── T2.5: X-API-Key path → always unscoped (no scope restriction) ──

  it("T2.5: X-API-Key authenticated request → no scope restriction applied", async () => {
    const ws = await seedTestWorkspace();
    const projectP = await seedTestProject(ws.id, "TSE_P5");

    // Create a user with an API key
    const { randomBytes, createHash } = await import("node:crypto");
    const rawApiKey = randomBytes(32).toString("hex");
    const apiKeyHash = createHash("sha256").update(rawApiKey).digest("hex");

    const user = await prisma.user.create({
      data: {
        email: `api-user-${randomBytes(4).toString("hex")}@kanon.test`,
        passwordHash: "not-used",
        displayName: "API User",
        apiKeyHash,
      },
    });

    // Create workspace member with owner role so bypass grants access
    await prisma.member.create({
      data: {
        username: `api-user-${randomBytes(4).toString("hex")}`,
        role: "owner",
        userId: user.id,
        workspaceId: ws.id,
      },
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectP.key}`,
      headers: { "x-api-key": rawApiKey },
    });

    // Should NOT be 403 due to scope — X-API-Key is always unscoped
    // Owner bypass applies → 200
    expect(res.statusCode).toBe(200);
  });

  // ── T2.6: requireIssueRole and requireCycleRole with scoped [P], accessing Q → 403 ──

  it("T2.6a: scoped token [P] + issue in project Q (user is admin) → 403 on requireIssueRole", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const projectP = await seedTestProject(ws.id, "TSE_P6");
    const projectQ = await seedTestProject(ws.id, "TSE_Q6");

    // Create an issue in projectQ
    const issueCount = await prisma.issue.count();
    const issue = await prisma.issue.create({
      data: {
        key: `TSE_Q6-${issueCount + 1}`,
        sequenceNum: issueCount + 1,
        title: "Scope test issue",
        type: "task",
        priority: "medium",
        state: "backlog",
        projectId: projectQ.id,
      },
    });

    // Scoped to P — issue is in Q → 403
    const scopedToken = mintScopedAccessToken(admin.userId, ws.id, [projectP.id]);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/issues/${issue.key}`,
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "Updated title" }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("T2.6b: scoped token [P] + cycle in project Q (user is admin) → 403 on requireCycleRole", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const projectP = await seedTestProject(ws.id, "TSE_P7");
    const projectQ = await seedTestProject(ws.id, "TSE_Q7");

    // Create a cycle in projectQ
    const cycle = await prisma.cycle.create({
      data: {
        name: "Scope test cycle",
        projectId: projectQ.id,
        state: "active",
        startDate: new Date("2026-06-01"),
        endDate: new Date("2026-06-14"),
      },
    });

    // Scoped to P — cycle is in Q → 403
    const scopedToken = mintScopedAccessToken(admin.userId, ws.id, [projectP.id]);

    const res = await app.inject({
      method: "POST",
      url: `/api/cycles/${cycle.id}/close`,
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({}),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});
