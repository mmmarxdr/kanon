/**
 * Integration test for KAN-111 S22 coverage:
 * GET /api/projects/:key/issues must return HTTP 400 when an invalid
 * enum value is supplied for the `state` query parameter.
 *
 * The Zod IssueFilterQuery schema already enforces this at the route
 * boundary. This test verifies the behavior end-to-end through the
 * Fastify app rather than via the unit-level service helper.
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

describe("KAN-111 S22 — GET /api/projects/:key/issues query validation", () => {
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

  it("returns 400 when state= is an invalid enum value", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "TST");
    await seedTestProjectMember(member.userId, project.id, "member");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}/issues?state=notastate`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns 200 (not 400) when state= is a valid enum value", async () => {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id, "TST");
    await seedTestProjectMember(member.userId, project.id, "member");

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${project.key}/issues?state=backlog`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    // A valid state value must NOT produce 400 — proving the earlier 400
    // was caused by the invalid enum value and not by a broken request.
    expect(res.statusCode).toBe(200);
  });
});
