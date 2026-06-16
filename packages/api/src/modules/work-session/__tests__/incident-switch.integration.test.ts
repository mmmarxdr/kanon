import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../../test/helpers.js";
import { prisma } from "../../../config/prisma.js";

/** Backdate a session so stopWork sees duration ≥ 60s and writes a WorkLog. */
async function backdateSession(sessionId: string, secondsAgo: number): Promise<void> {
  await prisma.workSession.update({
    where: { id: sessionId },
    data: { startedAt: new Date(Date.now() - secondsAgo * 1000), lastHeartbeat: new Date() },
  });
}

/**
 * KAN-103 PR2: starting work on an incident while a session is active displaces it
 * (stop → WorkLog) and records an Interruption; resume/close stamps endedAt. Plus
 * the manual interruption endpoint.
 */
describe("KAN-103 PR2: incident switch flow + manual interruption", () => {
  let app: FastifyInstance;
  let token: string;
  let projectKey: string;
  let projectId: string;
  let seq = 0;

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
    const owner = await seedTestMemberWithRole(ws.id, "owner"); // owner bypasses ProjectMember
    token = owner.token;
    const project = await seedTestProject(ws.id);
    projectKey = project.key;
    projectId = project.id;
    seq = 0;
  });

  async function seedIssue(type: "task" | "incident"): Promise<string> {
    seq += 1;
    const issue = await prisma.issue.create({
      data: { key: `${projectKey}-${seq}`, title: `i${seq}`, type, state: "backlog", projectId, sequenceNum: seq },
      select: { key: true },
    });
    return issue.key;
  }

  const startWork = (key: string) =>
    app.inject({
      method: "POST",
      url: `/api/issues/${key}/work-sessions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { source: "test" },
    });
  const stopWork = (key: string) =>
    app.inject({
      method: "DELETE",
      url: `/api/issues/${key}/work-sessions`,
      headers: { authorization: `Bearer ${token}` },
    });

  it("starting an incident stops the active session on A (WorkLog) and opens an Interruption", async () => {
    const a = await seedIssue("task");
    const inc = await seedIssue("incident");

    const startA = await startWork(a);
    expect(startA.statusCode).toBe(201);
    await backdateSession(startA.json().session.id, 120); // ≥60s → WorkLog on stop

    expect((await startWork(inc)).statusCode).toBe(201);

    // A's session stopped + WorkLog written; incident session active
    expect(await prisma.workSession.count({ where: { issue: { key: a } } })).toBe(0);
    expect(await prisma.workLog.count({ where: { issue: { key: a } } })).toBe(1);
    expect(await prisma.workSession.count({ where: { issue: { key: inc } } })).toBe(1);

    // Interruption opened, linking incident → A
    const interruption = await prisma.interruption.findFirst({
      where: { incidentIssue: { key: inc } },
      include: { interruptedIssue: { select: { key: true } } },
    });
    expect(interruption).not.toBeNull();
    expect(interruption!.via).toBe("session_switch");
    expect(interruption!.endedAt).toBeNull();
    expect(interruption!.interruptedIssue.key).toBe(a);
  });

  it("closing the incident session stamps the Interruption's endedAt", async () => {
    const a = await seedIssue("task");
    const inc = await seedIssue("incident");
    await startWork(a);
    await startWork(inc);

    expect((await stopWork(inc)).statusCode).toBe(200);

    const interruption = await prisma.interruption.findFirst({ where: { incidentIssue: { key: inc } } });
    expect(interruption!.endedAt).not.toBeNull();
  });

  it("resuming work on the interrupted issue stamps the Interruption's endedAt", async () => {
    const a = await seedIssue("task");
    const inc = await seedIssue("incident");
    await startWork(a);
    await startWork(inc); // interruption opens
    await startWork(a); // resume A

    const interruption = await prisma.interruption.findFirst({ where: { incidentIssue: { key: inc } } });
    expect(interruption!.endedAt).not.toBeNull();
  });

  it("manual endpoint records an Interruption (via=manual) and rejects non-incidents / unknown issues", async () => {
    const a = await seedIssue("task");
    const inc = await seedIssue("incident");

    const ok = await app.inject({
      method: "POST",
      url: `/api/issues/${inc}/interruptions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { interruptedIssueKey: a },
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().via).toBe("manual");
    expect(ok.json().endedAt).toBeNull();

    // :key must be an incident
    const notIncident = await app.inject({
      method: "POST",
      url: `/api/issues/${a}/interruptions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { interruptedIssueKey: inc },
    });
    expect(notIncident.statusCode).toBe(400);
    expect(notIncident.json().code).toBe("NOT_AN_INCIDENT");

    // unknown interrupted issue
    const unknown = await app.inject({
      method: "POST",
      url: `/api/issues/${inc}/interruptions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { interruptedIssueKey: `${projectKey}-999` },
    });
    expect(unknown.statusCode).toBe(404);
  });

  it("manual interruption rejects an interrupted issue in another workspace (404, no cross-scope probing)", async () => {
    const inc = await seedIssue("incident");
    // A separate workspace + issue, outside the caller's scope.
    const ws2 = await seedTestWorkspace();
    await seedTestMemberWithRole(ws2.id, "owner");
    const project2 = await seedTestProject(ws2.id);
    const other = await prisma.issue.create({
      data: { key: `${project2.key}-1`, title: "other-ws", type: "task", state: "backlog", projectId: project2.id, sequenceNum: 1 },
      select: { key: true },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/issues/${inc}/interruptions`,
      headers: { authorization: `Bearer ${token}` },
      payload: { interruptedIssueKey: other.key },
    });
    expect(res.statusCode).toBe(404);
  });
});
