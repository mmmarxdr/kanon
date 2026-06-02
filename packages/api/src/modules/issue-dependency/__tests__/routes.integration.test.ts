/**
 * Integration tests for issue-dependency routes (KAN-22 security fix).
 *
 * Security scenarios (DELETE /api/issue-dependencies/:id):
 *   D.1  Non-member (different workspace) → DELETE → 403 or 404
 *   D.2  Project viewer (insufficient role) → DELETE → 403
 *   D.3  Project member → DELETE → 200 (success)
 *   D.4  Token-scoped credential excluding the project → DELETE → 403 (KAN-19)
 *
 * Regression scenarios:
 *   R.1  POST /issues/:key/dependencies (member) → 201 — unchanged
 *   R.2  GET  /issues/:key/dependencies (viewer)  → 200 — unchanged
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
} from "../../../test/helpers.js";
import { prisma } from "../../../config/prisma.js";

// ── helpers ──────────────────────────────────────────────────────────────────

/** Mint a scoped Bearer access token (mirrors KAN-19 pattern). */
function mintScopedToken(
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

/** Seed an issue in the given project. Returns the issue row. */
async function seedIssue(projectId: string, keySuffix: string) {
  const count = await prisma.issue.count();
  return prisma.issue.create({
    data: {
      key: `KAN22-${keySuffix}`,
      sequenceNum: count + 1,
      title: `Test issue ${keySuffix}`,
      type: "task",
      priority: "medium",
      state: "backlog",
      projectId,
    },
  });
}

/** Seed a dependency row (sourceId blocks targetId). Returns the dependency. */
async function seedDependency(sourceId: string, targetId: string) {
  return prisma.issueDependency.create({
    data: { sourceId, targetId, type: "blocks" },
  });
}

// ── suite ─────────────────────────────────────────────────────────────────────

describe("KAN-22 — DELETE /api/issue-dependencies/:id auth fix", () => {
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

  // ── D.1: Non-member → 403 / 404 ─────────────────────────────────────────────

  it("D.1: non-member of the dependency's project → DELETE → 403 (or 404, not 200)", async () => {
    // Workspace A owns the dependency
    const wsA = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(wsA.id, "owner");
    const project = await seedTestProject(wsA.id, "KAN22A");
    const srcIssue = await seedIssue(project.id, "src-d1");
    const tgtIssue = await seedIssue(project.id, "tgt-d1");
    const dep = await seedDependency(srcIssue.id, tgtIssue.id);

    // Workspace B: a member who has no relation to workspace A or its projects
    const wsB = await seedTestWorkspace();
    const stranger = await seedTestMemberWithRole(wsB.id, "owner");

    const res = await app.inject({
      method: "DELETE",
      url: `/api/issue-dependencies/${dep.id}`,
      headers: { authorization: `Bearer ${stranger.token}` },
    });

    // Must NOT be 200 — the bug was that a stranger could delete any dependency
    expect(res.statusCode).not.toBe(200);
    expect([403, 404]).toContain(res.statusCode);
  });

  // ── D.2: Project viewer → 403 ────────────────────────────────────────────────

  it("D.2: project viewer (insufficient role) → DELETE → 403", async () => {
    const ws = await seedTestWorkspace();
    const viewer = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "KAN22B");
    // viewer role at the project level
    await seedTestProjectMember(viewer.userId, project.id, "viewer");

    const srcIssue = await seedIssue(project.id, "src-d2");
    const tgtIssue = await seedIssue(project.id, "tgt-d2");
    const dep = await seedDependency(srcIssue.id, tgtIssue.id);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/issue-dependencies/${dep.id}`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── D.3: Project member → 200 ────────────────────────────────────────────────

  it("D.3: project member (sufficient role) → DELETE → 200", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "KAN22C");
    await seedTestProjectMember(member.userId, project.id, "member");

    const srcIssue = await seedIssue(project.id, "src-d3");
    const tgtIssue = await seedIssue(project.id, "tgt-d3");
    const dep = await seedDependency(srcIssue.id, tgtIssue.id);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/issue-dependencies/${dep.id}`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true });
  });

  // ── D.4: Token-scoped credential excluding the project → 403 (KAN-19) ────────

  it("D.4: token scoped to a different project → DELETE → 403", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const projectA = await seedTestProject(ws.id, "K22DA");
    const projectB = await seedTestProject(ws.id, "K22DB");

    // Dependency lives in projectB
    const srcIssue = await seedIssue(projectB.id, "src-d4");
    const tgtIssue = await seedIssue(projectB.id, "tgt-d4");
    const dep = await seedDependency(srcIssue.id, tgtIssue.id);

    // Token scoped only to projectA — admin bypass would normally allow projectB
    const scopedToken = mintScopedToken(admin.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "DELETE",
      url: `/api/issue-dependencies/${dep.id}`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── R.1: POST regression — member can still create dependencies ──────────────

  it("R.1: POST /issues/:key/dependencies (project member) → 201 — unchanged", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "KAN22E");
    await seedTestProjectMember(member.userId, project.id, "member");

    const issueA = await seedIssue(project.id, "r1-src");
    const issueB = await seedIssue(project.id, "r1-tgt");

    const res = await app.inject({
      method: "POST",
      url: `/api/issues/${issueA.key}/dependencies`,
      headers: {
        authorization: `Bearer ${member.token}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ targetKey: issueB.key, type: "blocks" }),
    });

    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ type: "blocks" });
  });

  // ── R.2: GET regression — viewer can still read dependencies ─────────────────

  it("R.2: GET /issues/:key/dependencies (project viewer) → 200 — unchanged", async () => {
    const ws = await seedTestWorkspace();
    const viewer = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "KAN22F");
    await seedTestProjectMember(viewer.userId, project.id, "viewer");

    const issue = await seedIssue(project.id, "r2-issue");

    const res = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/dependencies`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ blocks: [], blockedBy: [] });
  });
});
