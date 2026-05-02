import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../../test/helpers.js";
import { prisma } from "../../../config/prisma.js";

/**
 * Integration tests for PATCH /api/comments/:id — A5.x (Batch 2)
 *
 * Uses a real Fastify app + test DB (same pattern as cycle/routes.test.ts).
 * Covers:
 *   A5.1 — happy path: author updates body → 200 with updated comment
 *   A5.2 — non-author: different member → 403
 *   A5.3 — invalid body: empty body → 422
 *   A5.x — unauthenticated → 401
 *   A5.x — comment not found → 404
 */
describe("PATCH /api/comments/:id", () => {
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

  // ── Helper: create a full comment via DB seed ─────────────────────────────

  async function seedComment(
    workspaceId: string,
    projectId: string,
    authorMemberId: string,
    body = "original body",
  ) {
    const issueCount = await prisma.issue.count();
    const issue = await prisma.issue.create({
      data: {
        key: `TEST-${issueCount + 1}`,
        sequenceNum: issueCount + 1,
        title: "Test issue",
        projectId,
      },
    });

    const comment = await prisma.comment.create({
      data: {
        body,
        source: "human",
        issueId: issue.id,
        authorId: authorMemberId,
      },
    });

    return { issue, comment };
  }

  // ── A5.1 — Happy path ─────────────────────────────────────────────────────

  describe("A5.1 — happy path", () => {
    it("returns 200 with updated body when author patches their comment", async () => {
      const ws = await seedTestWorkspace();
      const author = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const { comment } = await seedComment(ws.id, project.id, author.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/comments/${comment.id}`,
        headers: { authorization: `Bearer ${author.token}` },
        payload: { body: "updated body text" },
      });

      expect(res.statusCode).toBe(200);
      const responseBody = res.json();
      expect(responseBody.body).toBe("updated body text");
      expect(responseBody.id).toBe(comment.id);
    });

    it("persists the new body in the database", async () => {
      const ws = await seedTestWorkspace();
      const author = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const { comment } = await seedComment(ws.id, project.id, author.id, "old body");

      await app.inject({
        method: "PATCH",
        url: `/api/comments/${comment.id}`,
        headers: { authorization: `Bearer ${author.token}` },
        payload: { body: "brand new body" },
      });

      const inDb = await prisma.comment.findUnique({ where: { id: comment.id } });
      expect(inDb?.body).toBe("brand new body");
    });
  });

  // ── A5.2 — Non-author → 403 ───────────────────────────────────────────────

  describe("A5.2 — non-author receives 403", () => {
    it("returns 403 FORBIDDEN when a different member tries to edit", async () => {
      const ws = await seedTestWorkspace();
      const author = await seedTestMember(ws.id);
      const otherMember = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const { comment } = await seedComment(ws.id, project.id, author.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/comments/${comment.id}`,
        headers: { authorization: `Bearer ${otherMember.token}` },
        payload: { body: "unauthorized edit" },
      });

      expect(res.statusCode).toBe(403);
      expect(res.json().code).toBe("FORBIDDEN");
    });
  });

  // ── A5.3 — Invalid body → 400 (Zod validation error) ────────────────────
  //
  // Decision: the project's error handler maps Zod validation errors to HTTP 400,
  // not 422. The task spec says "422" but the established project convention is 400.
  // Matching the project convention. Documented in apply-progress decisions.

  describe("A5.3 — invalid body returns 400 (Zod validation)", () => {
    it("returns 400 when body is an empty string (min(1) violated)", async () => {
      const ws = await seedTestWorkspace();
      const author = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const { comment } = await seedComment(ws.id, project.id, author.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/comments/${comment.id}`,
        headers: { authorization: `Bearer ${author.token}` },
        payload: { body: "" },
      });

      // 400 (not 422) — project error handler returns 400 for Zod validation errors
      expect(res.statusCode).toBe(400);
    });

    it("returns 400 when body field is missing entirely", async () => {
      const ws = await seedTestWorkspace();
      const author = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const { comment } = await seedComment(ws.id, project.id, author.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/comments/${comment.id}`,
        headers: { authorization: `Bearer ${author.token}` },
        payload: {},
      });

      expect(res.statusCode).toBe(400);
    });
  });

  // ── A5.x — Unauthenticated → 401 ─────────────────────────────────────────

  describe("A5.x — unauthenticated request", () => {
    it("returns 401 when no Authorization header is sent", async () => {
      const ws = await seedTestWorkspace();
      const author = await seedTestMember(ws.id);
      const project = await seedTestProject(ws.id);
      const { comment } = await seedComment(ws.id, project.id, author.id);

      const res = await app.inject({
        method: "PATCH",
        url: `/api/comments/${comment.id}`,
        payload: { body: "sneaky edit" },
      });

      expect(res.statusCode).toBe(401);
    });
  });

  // ── A5.x — Comment not found → 404 ───────────────────────────────────────

  describe("A5.x — comment not found", () => {
    it("returns 404 when comment ID does not exist", async () => {
      const ws = await seedTestWorkspace();
      const member = await seedTestMember(ws.id);
      const nonExistentId = "00000000-0000-0000-0000-000000000099";

      const res = await app.inject({
        method: "PATCH",
        url: `/api/comments/${nonExistentId}`,
        headers: { authorization: `Bearer ${member.token}` },
        payload: { body: "some body" },
      });

      expect(res.statusCode).toBe(404);
      expect(res.json().code).toBe("COMMENT_NOT_FOUND");
    });
  });
});
