// ─── Via threading integration tests (S1 review fix / KAN-30) ───────────────
//
// Verifies that request.via (set by the viaPlugin from X-Kanon-Client) is
// threaded through to activity_logs.via and comments.via in the DB.
//
// RED phase: these tests MUST fail before fix 1 is applied.
// GREEN phase: pass after routes forward request.via to service calls.

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
import { prisma } from "../../../config/prisma.js";

describe("Via threading — X-Kanon-Client lands in activity_logs.via", () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let memberId: string;
  let memberToken: string;
  let issueKey: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();

    const ws = await seedTestWorkspace();
    workspaceId = ws.id;

    await seedTestMemberWithRole(ws.id, "owner");
    const member = await seedTestMemberWithRole(ws.id, "member");
    memberId = member.id;
    memberToken = member.token;

    const project = await seedTestProject(ws.id);
    await seedTestProjectMember(member.userId, project.id, "member");

    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        title: "Via test issue",
        type: "task",
        state: "backlog",
        projectId: project.id,
        sequenceNum: 1,
      },
    });
    issueKey = issue.key;
  });

  it("transition with X-Kanon-Client: claude-code lands activity_log.via='claude-code'", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/issues/${issueKey}/transition`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        "x-kanon-client": "claude-code",
      },
      payload: { to_state: "todo" },
    });

    expect(res.statusCode).toBe(200);

    const logs = await prisma.activityLog.findMany({
      where: { action: "state_changed" },
      orderBy: { createdAt: "desc" },
    });

    expect(logs.length).toBeGreaterThan(0);
    const log = logs[0]!;
    expect(log.via).toBe("claude-code");
  });

  it("transition without X-Kanon-Client header lands activity_log.via=null", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/issues/${issueKey}/transition`,
      headers: {
        authorization: `Bearer ${memberToken}`,
      },
      payload: { to_state: "todo" },
    });

    expect(res.statusCode).toBe(200);

    const logs = await prisma.activityLog.findMany({
      where: { action: "state_changed" },
      orderBy: { createdAt: "desc" },
    });

    expect(logs.length).toBeGreaterThan(0);
    const log = logs[0]!;
    expect(log.via).toBeNull();
  });

  it("comment POST with X-Kanon-Client: claude-code lands comments.via='claude-code'", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/issues/${issueKey}/comments`,
      headers: {
        authorization: `Bearer ${memberToken}`,
        "x-kanon-client": "claude-code",
      },
      payload: { body: "A test comment from claude-code", source: "mcp" },
    });

    expect(res.statusCode).toBe(201);

    const comments = await prisma.comment.findMany({
      orderBy: { createdAt: "desc" },
    });

    expect(comments.length).toBeGreaterThan(0);
    const comment = comments[0]!;
    expect(comment.via).toBe("claude-code");
  });

  it("comment POST without header lands comments.via=null", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/issues/${issueKey}/comments`,
      headers: {
        authorization: `Bearer ${memberToken}`,
      },
      payload: { body: "A test comment, no header" },
    });

    expect(res.statusCode).toBe(201);

    const comments = await prisma.comment.findMany({
      orderBy: { createdAt: "desc" },
    });

    expect(comments.length).toBeGreaterThan(0);
    const comment = comments[0]!;
    expect(comment.via).toBeNull();
  });
});
