/**
 * Integration tests for KAN-25: project-scoped token enforcement on comment,
 * document, and proposal routes.
 *
 * Scenarios:
 *   C1: scoped [A], comment in project B (same ws, author=token user) → PATCH 403
 *   D1: scoped [A], document in project B (same ws, author=token user) → PATCH 403
 *   D2: scoped [A], document in project B (same ws, author=token user) → GET 403
 *   C2: unscoped token, same setup → PATCH /comments 200 (backward compat)
 *   D3: unscoped token, same setup → PATCH /documents 200 (backward compat)
 *   D4: unscoped token, same setup → GET /documents/:id 200 (backward compat)
 *   C3: scoped [A], comment in project A, author → PATCH 200 (happy path)
 *   D5: scoped [A], document in project A, author → PATCH 200 (happy path)
 *   D6: scoped [A], document in project A, author → GET 200 (happy path)
 *   C4: unscoped admin, comment in project B, non-author → 403 (author-only preserved)
 *   D7: unscoped admin, document in project B, non-author → 403 (author-only preserved)
 *   P1: scoped [A], proposal with projectId=B, ws member → POST apply 403
 *   P2: scoped [A], proposal with projectId=B, ws member → POST dismiss 403
 *   P3: scoped [A], proposal with projectId=null, ws member → POST apply 200 (ws-level proposals unaffected)
 *   P4: scoped [A], proposal with projectId=null, ws member → POST dismiss 200
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

// ---------------------------------------------------------------------------
// Token helpers
// ---------------------------------------------------------------------------

/**
 * Mint a scoped Bearer access token (KAN-19 shape).
 * Omits allowedProjectIds when the array is empty → unscoped token.
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

// ---------------------------------------------------------------------------
// Seed helpers
// ---------------------------------------------------------------------------

/** Seed an issue in a project and return its key + id. */
async function seedIssue(
  projectId: string,
  titleSuffix: string,
): Promise<{ id: string; key: string }> {
  const count = await prisma.issue.count();
  const key = `TSR-${count + 1}-${titleSuffix}`;
  const issue = await prisma.issue.create({
    data: {
      key,
      sequenceNum: count + 1,
      title: `Scope test issue ${titleSuffix}`,
      projectId,
    },
  });
  return { id: issue.id, key: issue.key };
}

/** Seed a comment by authorMemberId on an issue. Returns comment id. */
async function seedComment(issueId: string, authorMemberId: string): Promise<string> {
  const comment = await prisma.comment.create({
    data: {
      body: "Test comment body",
      issueId,
      authorId: authorMemberId,
    },
  });
  return comment.id;
}

/** Seed a document by authorMemberId on an issue. Returns document id. */
async function seedDocument(issueId: string, authorMemberId: string): Promise<string> {
  const doc = await prisma.issueDocument.create({
    data: {
      kind: "note",
      title: "Test document",
      body: "Test document body",
      issueId,
      authorId: authorMemberId,
    },
  });
  return doc.id;
}

/** Seed a pending proposal with optional projectId. */
async function seedProposal(
  workspaceId: string,
  projectId: string | null,
): Promise<string> {
  const proposal = await prisma.mcpProposal.create({
    data: {
      workspaceId,
      kind: "generic",
      title: "Scope test proposal",
      status: "pending",
      ...(projectId ? { projectId } : {}),
    },
    select: { id: true },
  });
  return proposal.id;
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("KAN-25 — Scoped token enforcement on comment, document, and proposal routes", () => {
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

  // ── C1: scoped [A], comment in B → PATCH 403 ──────────────────────────────

  it("C1: scoped token [A], comment in project B (author=token user) → PATCH 403", async () => {
    const ws = await seedTestWorkspace();
    // Use admin so the user could otherwise pass the gate (admin bypass)
    const actor = await seedTestMemberWithRole(ws.id, "admin");
    const projectA = await seedTestProject(ws.id, "TSRCA");
    const projectB = await seedTestProject(ws.id, "TSRCB");

    const issue = await seedIssue(projectB.id, "C1");
    const commentId = await seedComment(issue.id, actor.id);

    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/comments/${commentId}`,
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: "updated body" }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── D1: scoped [A], document in B → PATCH 403 ─────────────────────────────

  it("D1: scoped token [A], document in project B (author=token user) → PATCH 403", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "admin");
    const projectA = await seedTestProject(ws.id, "TSRDA");
    const projectB = await seedTestProject(ws.id, "TSRDB");

    const issue = await seedIssue(projectB.id, "D1");
    const docId = await seedDocument(issue.id, actor.id);

    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/documents/${docId}`,
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "updated title" }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── D2: scoped [A], document in B → GET 403 ───────────────────────────────

  it("D2: scoped token [A], document in project B → GET 403", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "admin");
    const projectA = await seedTestProject(ws.id, "TSRGA");
    const projectB = await seedTestProject(ws.id, "TSRGB");

    const issue = await seedIssue(projectB.id, "D2");
    const docId = await seedDocument(issue.id, actor.id);

    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "GET",
      url: `/api/documents/${docId}`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  // ── C2: unscoped token, comment in B → PATCH 200 (backward compat) ────────

  it("C2: unscoped token (no allowedProjectIds), comment in project B → PATCH 200 (author, admin bypass)", async () => {
    const ws = await seedTestWorkspace();
    // admin so enforceProjectAccess uses bypass (no PM row needed)
    const actor = await seedTestMemberWithRole(ws.id, "admin");
    const projectB = await seedTestProject(ws.id, "TSRC2B");

    const issue = await seedIssue(projectB.id, "C2");
    const commentId = await seedComment(issue.id, actor.id);

    // Unscoped token: no allowedProjectIds claim
    const unscopedToken = mintScopedAccessToken(actor.userId, ws.id, []);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/comments/${commentId}`,
      headers: {
        authorization: `Bearer ${unscopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: "updated body" }),
    });

    expect(res.statusCode).toBe(200);
  });

  // ── D3: unscoped token, document in B → PATCH 200 (backward compat) ───────

  it("D3: unscoped token, document in project B → PATCH 200 (author, admin bypass)", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "admin");
    const projectB = await seedTestProject(ws.id, "TSRD3B");

    const issue = await seedIssue(projectB.id, "D3");
    const docId = await seedDocument(issue.id, actor.id);

    const unscopedToken = mintScopedAccessToken(actor.userId, ws.id, []);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/documents/${docId}`,
      headers: {
        authorization: `Bearer ${unscopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "updated title" }),
    });

    expect(res.statusCode).toBe(200);
  });

  // ── D4: unscoped token, GET /documents/:id → 200 (backward compat) ────────

  it("D4: unscoped token, document in project B → GET /documents/:id 200", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "admin");
    const projectB = await seedTestProject(ws.id, "TSRD4B");

    const issue = await seedIssue(projectB.id, "D4");
    const docId = await seedDocument(issue.id, actor.id);

    const unscopedToken = mintScopedAccessToken(actor.userId, ws.id, []);

    const res = await app.inject({
      method: "GET",
      url: `/api/documents/${docId}`,
      headers: { authorization: `Bearer ${unscopedToken}` },
    });

    expect(res.statusCode).toBe(200);
  });

  // ── C3: scoped [A], comment in A, author → PATCH 200 (happy path) ─────────

  it("C3: scoped token [A], comment in project A, author with PM row → PATCH 200", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "member");
    const projectA = await seedTestProject(ws.id, "TSRC3A");

    // Seed PM row so enforceProjectAccess (non-admin path) allows access
    await seedTestProjectMember(actor.userId, projectA.id, "member");

    const issue = await seedIssue(projectA.id, "C3");
    const commentId = await seedComment(issue.id, actor.id);

    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/comments/${commentId}`,
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: "updated body" }),
    });

    expect(res.statusCode).toBe(200);
  });

  // ── D5: scoped [A], document in A, author → PATCH 200 (happy path) ────────

  it("D5: scoped token [A], document in project A, author with PM row → PATCH 200", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "member");
    const projectA = await seedTestProject(ws.id, "TSRD5A");

    await seedTestProjectMember(actor.userId, projectA.id, "member");

    const issue = await seedIssue(projectA.id, "D5");
    const docId = await seedDocument(issue.id, actor.id);

    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/documents/${docId}`,
      headers: {
        authorization: `Bearer ${scopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "updated title" }),
    });

    expect(res.statusCode).toBe(200);
  });

  // ── D6: scoped [A], document in A → GET 200 (happy path) ──────────────────

  it("D6: scoped token [A], document in project A, member with PM row → GET 200", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "member");
    const projectA = await seedTestProject(ws.id, "TSRD6A");

    await seedTestProjectMember(actor.userId, projectA.id, "member");

    const issue = await seedIssue(projectA.id, "D6");
    const docId = await seedDocument(issue.id, actor.id);

    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "GET",
      url: `/api/documents/${docId}`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(200);
    // Response shape: no issue join leaked
    expect(res.json()).not.toHaveProperty("issue");
    expect(res.json()).toHaveProperty("id", docId);
  });

  // ── C4: unscoped admin, comment in B, non-author → 403 (author-only) ──────

  it("C4: unscoped admin token, comment in project B, requester is NOT author → 403 FORBIDDEN (author-only)", async () => {
    const ws = await seedTestWorkspace();
    const author = await seedTestMemberWithRole(ws.id, "admin");
    const nonAuthor = await seedTestMemberWithRole(ws.id, "admin");
    const projectB = await seedTestProject(ws.id, "TSRC4B");

    const issue = await seedIssue(projectB.id, "C4");
    // Comment authored by `author`, request made by `nonAuthor`
    const commentId = await seedComment(issue.id, author.id);

    // Unscoped token for the non-author (admin, so gate passes)
    const unscopedToken = mintScopedAccessToken(nonAuthor.userId, ws.id, []);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/comments/${commentId}`,
      headers: {
        authorization: `Bearer ${unscopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: "hijacked body" }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    // Verify service-level message (author-only check, not scope guard)
    expect(res.json().message).toBe("Only the comment author can edit this comment");
  });

  // ── D7: unscoped admin, document in B, non-author → 403 (author-only) ─────

  it("D7: unscoped admin token, document in project B, requester is NOT author → 403 FORBIDDEN (author-only)", async () => {
    const ws = await seedTestWorkspace();
    const author = await seedTestMemberWithRole(ws.id, "admin");
    const nonAuthor = await seedTestMemberWithRole(ws.id, "admin");
    const projectB = await seedTestProject(ws.id, "TSRD7B");

    const issue = await seedIssue(projectB.id, "D7");
    const docId = await seedDocument(issue.id, author.id);

    const unscopedToken = mintScopedAccessToken(nonAuthor.userId, ws.id, []);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/documents/${docId}`,
      headers: {
        authorization: `Bearer ${unscopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "hijacked title" }),
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
    expect(res.json().message).toBe("Only the document author can edit this document");
  });

  // ── P1: scoped [A], proposal projectId=B → POST apply 403 ─────────────────

  it("P1: scoped token [A], proposal with projectId=B, workspace member → POST apply 403", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "member");
    const projectA = await seedTestProject(ws.id, "TSRP1A");
    const projectB = await seedTestProject(ws.id, "TSRP1B");

    // PM row for A (scoped project) so workspace membership isn't the block
    await seedTestProjectMember(actor.userId, projectA.id, "member");

    const proposalId = await seedProposal(ws.id, projectB.id);

    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposalId}/apply`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");

    // Proposal must remain pending
    const dbProposal = await prisma.mcpProposal.findUnique({
      where: { id: proposalId },
      select: { status: true },
    });
    expect(dbProposal?.status).toBe("pending");
  });

  // ── P2: scoped [A], proposal projectId=B → POST dismiss 403 ───────────────

  it("P2: scoped token [A], proposal with projectId=B, workspace member → POST dismiss 403", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "member");
    const projectA = await seedTestProject(ws.id, "TSRP2A");
    const projectB = await seedTestProject(ws.id, "TSRP2B");

    await seedTestProjectMember(actor.userId, projectA.id, "member");

    const proposalId = await seedProposal(ws.id, projectB.id);

    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposalId}/dismiss`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");

    const dbProposal = await prisma.mcpProposal.findUnique({
      where: { id: proposalId },
      select: { status: true },
    });
    expect(dbProposal?.status).toBe("pending");
  });

  // ── P3: scoped [A], workspace-level proposal (projectId=null) → apply 200 ─

  it("P3: scoped token [A], workspace-level proposal (projectId=null) → POST apply 200", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "member");

    // Workspace-level proposal: no projectId
    const proposalId = await seedProposal(ws.id, null);

    // Scoped to some project — workspace-level proposals must NOT be blocked
    const projectA = await seedTestProject(ws.id, "TSRP3A");
    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposalId}/apply`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("applied");
  });

  // ── LI-C: lock-in — ws member (no PM row), unscoped token, author → PATCH 200 ─
  //
  // lock-in: workspace-member without ProjectMember row retains author PATCH
  // access — guards the resolveAndCheckMember (not enforceProjectAccess) design
  // choice in requireCommentRole. If the factory is reverted to
  // enforceProjectAccess this test turns red immediately.

  it("LI-C: lock-in: workspace-member without ProjectMember row retains author PATCH access — guards resolveAndCheckMember design in requireCommentRole", async () => {
    const ws = await seedTestWorkspace();
    // role "member", NO seedTestProjectMember call — no PM row exists
    const actor = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "TSRLIC");

    const issue = await seedIssue(project.id, "LIC");
    const commentId = await seedComment(issue.id, actor.id);

    // Unscoped token: resolveAndCheckMember workspace gate only (no PM row needed)
    const unscopedToken = mintScopedAccessToken(actor.userId, ws.id, []);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/comments/${commentId}`,
      headers: {
        authorization: `Bearer ${unscopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ body: "updated by ws-member without PM row" }),
    });

    expect(res.statusCode).toBe(200);
    // Verify the update actually landed in the DB
    const updated = await prisma.comment.findUnique({ where: { id: commentId } });
    expect(updated?.body).toBe("updated by ws-member without PM row");
  });

  // ── LI-D: lock-in — ws member (no PM row), unscoped token, author → PATCH 200 ─
  //
  // lock-in: workspace-member without ProjectMember row retains author PATCH
  // access — guards the resolveAndCheckMember (not enforceProjectAccess) design
  // choice in requireDocumentRole. If the factory is reverted to
  // enforceProjectAccess this test turns red immediately.

  it("LI-D: lock-in: workspace-member without ProjectMember row retains author PATCH access — guards resolveAndCheckMember design in requireDocumentRole", async () => {
    const ws = await seedTestWorkspace();
    // role "member", NO seedTestProjectMember call — no PM row exists
    const actor = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "TSRLID");

    const issue = await seedIssue(project.id, "LID");
    const docId = await seedDocument(issue.id, actor.id);

    // Unscoped token: resolveAndCheckMember workspace gate only (no PM row needed)
    const unscopedToken = mintScopedAccessToken(actor.userId, ws.id, []);

    const res = await app.inject({
      method: "PATCH",
      url: `/api/documents/${docId}`,
      headers: {
        authorization: `Bearer ${unscopedToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ title: "updated by ws-member without PM row" }),
    });

    expect(res.statusCode).toBe(200);
    // Verify the update actually landed in the DB
    const updated = await prisma.issueDocument.findUnique({ where: { id: docId } });
    expect(updated?.title).toBe("updated by ws-member without PM row");
  });

  // ── P4: scoped [A], workspace-level proposal (projectId=null) → dismiss 200

  it("P4: scoped token [A], workspace-level proposal (projectId=null) → POST dismiss 200", async () => {
    const ws = await seedTestWorkspace();
    const actor = await seedTestMemberWithRole(ws.id, "member");

    const proposalId = await seedProposal(ws.id, null);

    const projectA = await seedTestProject(ws.id, "TSRP4A");
    const scopedToken = mintScopedAccessToken(actor.userId, ws.id, [projectA.id]);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposalId}/dismiss`,
      headers: { authorization: `Bearer ${scopedToken}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("dismissed");
  });
});
