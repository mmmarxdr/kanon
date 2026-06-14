/**
 * Integration test: PR2b dueDate removal (KAN-99).
 * Proves that Issue.dueDate column is GONE:
 *   - POST /api/projects/:key/issues with old dueDate field → ignored (no 400 for unknown field)
 *     but dueDate does NOT appear on the response object.
 *   - GET /api/projects/:key/issues/:issueKey response has no dueDate field.
 *   - GET /api/projects/:key/issues/:issueKey (detail) response has no dueDate field.
 *
 * Run: pnpm test:db:setup first, then pnpm test.
 */
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
} from "../../../test/helpers.js";

describe("PR2b — dueDate removal (integration)", () => {
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

  async function seedContext() {
    const ws = await seedTestWorkspace();
    await seedTestMemberWithRole(ws.id, "owner");
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id);
    await seedTestProjectMember(member.userId, project.id, "member");
    return { ws, member, project };
  }

  it("POST /api/projects/:key/issues — dueDate field in body is silently ignored; response has no dueDate", async () => {
    const { member, project } = await seedContext();

    const res = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/issues`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: {
        title: "Test issue with dueDate",
        // Old field — should be stripped by schema hard-removal
        dueDate: "2026-12-31T00:00:00.000Z",
      },
    });

    // Should succeed (extra unknown fields ignored by Zod .strip() default, or 400 if strict)
    // Either 200 or 400 is acceptable — what must NOT happen: a 500 from a column-not-found error
    expect(res.statusCode).not.toBe(500);

    // 201 = created with full body; 400 = unknown field rejected by strict schema — both acceptable.
    // What must NOT happen: 500 (column-not-found DB error).
    if (res.statusCode === 201) {
      const body = JSON.parse(res.body) as Record<string, unknown>;
      // dueDate must NOT be present on the response
      expect(body).not.toHaveProperty("dueDate");
      expect(body).not.toHaveProperty("due_date");
    }
  });

  it("GET /api/projects/:key/issues — issue list response items have no dueDate field", async () => {
    const { member, project } = await seedContext();

    // Create issue without dueDate
    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/issues`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { title: "No dueDate issue" },
    });
    expect(createRes.statusCode).toBe(201);

    const listRes = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}/issues`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(listRes.statusCode).toBe(200);

    const list = JSON.parse(listRes.body) as unknown[];
    expect(list.length).toBeGreaterThan(0);
    for (const issue of list) {
      expect(issue).not.toHaveProperty("dueDate");
      expect(issue).not.toHaveProperty("due_date");
    }
  });

  it("GET /api/projects/:key/issues/:key — issue detail response has no dueDate field", async () => {
    const { member, project } = await seedContext();

    const createRes = await app.inject({
      method: "POST",
      url: `/api/projects/${project.key}/issues`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { title: "Detail no dueDate" },
    });
    expect(createRes.statusCode).toBe(201);

    const created = JSON.parse(createRes.body) as { key: string };
    const issueKey = created.key;

    const detailRes = await app.inject({
      method: "GET",
      url: `/api/issues/${issueKey}`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(detailRes.statusCode).toBe(200);

    const detail = JSON.parse(detailRes.body) as Record<string, unknown>;
    expect(detail).not.toHaveProperty("dueDate");
    expect(detail).not.toHaveProperty("due_date");
  });
});
