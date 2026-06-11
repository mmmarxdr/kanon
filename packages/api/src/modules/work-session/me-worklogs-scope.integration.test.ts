/**
 * KAN-82: GET /api/me/worklogs must be scoped to a single workspace. Without a
 * required workspaceId it aggregated the caller's worklogs across ALL their
 * workspaces, leaking other-workspace activity into a single-workspace context.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";

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

describe("KAN-82 — GET /me/worklogs workspace scoping", () => {
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

  async function seedIssue(workspaceId: string, key: string) {
    const project = await seedTestProject(workspaceId, key);
    return prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        title: "Test issue",
        type: "task",
        state: "backlog",
        projectId: project.id,
        sequenceNum: 1,
      },
    });
  }

  async function seedWorklog(memberId: string, issueId: string) {
    return prisma.workLog.create({
      data: {
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
        durationS: 60,
        issueId,
        memberId,
      },
    });
  }

  it("scopes results to the requested workspace and never spans others", async () => {
    // User X is a member of two workspaces, with a worklog in each.
    const wsA = await seedTestWorkspace();
    const x = await seedTestMemberWithRole(wsA.id, "member");
    const issueA = await seedIssue(wsA.id, "AAA");
    await seedWorklog(x.id, issueA.id);

    const wsB = await seedTestWorkspace();
    const xMemberB = await prisma.member.create({
      data: { username: "x-in-b", role: "member", userId: x.userId, workspaceId: wsB.id },
    });
    const issueB = await seedIssue(wsB.id, "BBB");
    await seedWorklog(xMemberB.id, issueB.id);

    const res = await app.inject({
      method: "GET",
      url: `/api/me/worklogs?workspaceId=${wsA.id}`,
      headers: { authorization: `Bearer ${x.token}` },
    });

    expect(res.statusCode).toBe(200);
    const logs = res.json().worklogs as Array<{ issueId: string }>;
    expect(logs).toHaveLength(1);
    expect(logs[0].issueId).toBe(issueA.id); // only workspace A's worklog
  });

  it("requires workspaceId (400 when omitted)", async () => {
    const wsA = await seedTestWorkspace();
    const x = await seedTestMemberWithRole(wsA.id, "member");

    const res = await app.inject({
      method: "GET",
      url: `/api/me/worklogs`,
      headers: { authorization: `Bearer ${x.token}` },
    });

    expect(res.statusCode).toBe(400);
  });

  it("returns empty when the caller is not a member of the workspace", async () => {
    const wsA = await seedTestWorkspace();
    const x = await seedTestMemberWithRole(wsA.id, "member");
    const otherWs = await seedTestWorkspace(); // X is NOT a member here

    const res = await app.inject({
      method: "GET",
      url: `/api/me/worklogs?workspaceId=${otherWs.id}`,
      headers: { authorization: `Bearer ${x.token}` },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().worklogs).toHaveLength(0);
  });
});

/**
 * KAN-86: GET /api/me/worklogs must also honor the allowedProjectIds token scope
 * (the KAN-79 list-scoping pattern). A project-scoped token must not read the
 * caller's OWN worklogs for issues in projects outside its scope.
 */
describe("KAN-86 — GET /me/worklogs honors allowedProjectIds", () => {
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

  async function seedIssueInProject(projectId: string, key: string, seq: number) {
    return prisma.issue.create({
      data: {
        key,
        title: "Test issue",
        type: "task",
        state: "backlog",
        projectId,
        sequenceNum: seq,
      },
    });
  }

  async function seedWorklog(memberId: string, issueId: string) {
    return prisma.workLog.create({
      data: {
        startedAt: new Date(Date.now() - 60_000),
        endedAt: new Date(),
        durationS: 60,
        issueId,
        memberId,
      },
    });
  }

  it("scoped token → only worklogs for in-scope projects", async () => {
    const ws = await seedTestWorkspace();
    const x = await seedTestMemberWithRole(ws.id, "member");
    const projP = await seedTestProject(ws.id, "PPP");
    const projQ = await seedTestProject(ws.id, "QQQ");
    const issueP = await seedIssueInProject(projP.id, "PPP-1", 1);
    const issueQ = await seedIssueInProject(projQ.id, "QQQ-1", 1);
    await seedWorklog(x.id, issueP.id);
    await seedWorklog(x.id, issueQ.id);

    const token = mintScopedAccessToken(x.userId, ws.id, [projP.id]);
    const res = await app.inject({
      method: "GET",
      url: `/api/me/worklogs?workspaceId=${ws.id}`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(res.statusCode).toBe(200);
    const logs = res.json().worklogs as Array<{ issueId: string }>;
    expect(logs).toHaveLength(1);
    expect(logs[0].issueId).toBe(issueP.id); // QQQ worklog is out of scope
  });

  it("unscoped token → all of the caller's worklogs (backward-compat)", async () => {
    const ws = await seedTestWorkspace();
    const x = await seedTestMemberWithRole(ws.id, "member");
    const projP = await seedTestProject(ws.id, "PPP");
    const projQ = await seedTestProject(ws.id, "QQQ");
    const issueP = await seedIssueInProject(projP.id, "PPP-1", 1);
    const issueQ = await seedIssueInProject(projQ.id, "QQQ-1", 1);
    await seedWorklog(x.id, issueP.id);
    await seedWorklog(x.id, issueQ.id);

    const res = await app.inject({
      method: "GET",
      url: `/api/me/worklogs?workspaceId=${ws.id}`,
      headers: { authorization: `Bearer ${x.token}` }, // unscoped
    });

    expect(res.statusCode).toBe(200);
    const ids = (res.json().worklogs as Array<{ issueId: string }>).map((l) => l.issueId);
    expect(ids).toContain(issueP.id);
    expect(ids).toContain(issueQ.id);
    expect(ids).toHaveLength(2);
  });
});
