/**
 * work-session-resilience (Slice A) — Phase 5
 *
 * Duration formula: lastHeartbeat - startedAt (D4: deliberate deviation
 * from proposal's "now - startedAt" which over-counts dead time).
 *
 * If an MCP process dies after `startWork` succeeds (process crash,
 * `kill -9`, OOM, machine sleep) and a `WorkSession` row persists past
 * `SESSION_TTL_MS`, the next `cleanupExpired` run must:
 *   - treat the session as expired
 *   - write a `WorkLog` row with `reason: "expired"`
 *   - compute `durationS` from `lastHeartbeat - startedAt` (NOT from now)
 *   - thread `via` from `normalizeVia(source)`
 *
 * The resulting `WorkLog` MUST be observable via the worklog-list endpoint.
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
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { cleanupExpired } from "./service.js";

describe("Abrupt MCP Shutdown → cleanupExpired → WorkLog (Slice A, Phase 5)", () => {
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
    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        title: "Test issue",
        type: "task",
        state: "backlog",
        projectId: project.id,
        sequenceNum: 1,
      },
    });
    return { ws, member, project, issue };
  }

  it("aged session (lastHeartbeat past TTL) is cleaned up to a WorkLog with reason: 'expired' and durationS ≈ 120", async () => {
    const { member, issue } = await seedContext();

    // Write a WorkSession row directly via Prisma — simulating the
    // case where an MCP process died after startWork and the row was
    // never cleaned up.
    //
    // Duration formula (D4): lastHeartbeat - startedAt (NOT now - startedAt).
    // We anchor a 2-min session where the last heartbeat was 6 min ago:
    //   startedAt    = now - 8 min  (alive at 8 min ago)
    //   lastHeartbeat = now - 6 min  (session went silent 6 min ago — past TTL of 5 min)
    // → lastHeartbeat - startedAt = 120_000 ms → durationS = 120.
    const now = Date.now();
    const startedAt = new Date(now - 8 * 60_000);
    const lastHeartbeat = new Date(now - 6 * 60_000);
    await prisma.workSession.create({
      data: {
        userId: member.userId,
        memberId: member.id,
        issueId: issue.id,
        source: "claude-code",
        startedAt,
        lastHeartbeat,
      },
    });

    // Run the cleanup loop.
    const count = await cleanupExpired();
    expect(count).toBe(1);

    // Find the WorkLog row.
    const worklog = await prisma.workLog.findFirst({
      where: { issueId: issue.id },
    });
    expect(worklog).not.toBeNull();
    expect(worklog!.reason).toBe("expired");
    // durationS = floor((lastHeartbeat - startedAt) / 1000) = 120
    expect(worklog!.durationS).toBeGreaterThanOrEqual(120);
    expect(worklog!.durationS).toBeLessThan(130);
    // `via` is `normalizeVia('claude-code')` = 'claude-code' (known vocab)
    expect(worklog!.via).toBe("claude-code");
  });

  it("cleanup deletes the WorkSession row (no orphan session after expiry)", async () => {
    const { member, issue } = await seedContext();

    const startedAt = new Date(Date.now() - 8 * 60_000);   // 8 min ago
    const lastHeartbeat = new Date(Date.now() - 6 * 60_000); // 6 min ago (TTL = 5min, so expired)
    await prisma.workSession.create({
      data: {
        userId: member.userId,
        memberId: member.id,
        issueId: issue.id,
        source: "claude-code",
        startedAt,
        lastHeartbeat,
      },
    });

    const count = await cleanupExpired();
    expect(count).toBe(1);

    const session = await prisma.workSession.findFirst({
      where: { issueId: issue.id, userId: member.userId },
    });
    expect(session).toBeNull();
  });

  it("aged WorkLog is observable via GET /api/issues/:key/worklogs", async () => {
    const { member, issue } = await seedContext();

    const startedAt = new Date(Date.now() - 8 * 60_000);
    const lastHeartbeat = new Date(Date.now() - 6 * 60_000);
    await prisma.workSession.create({
      data: {
        userId: member.userId,
        memberId: member.id,
        issueId: issue.id,
        source: "claude-code",
        startedAt,
        lastHeartbeat,
      },
    });

    await cleanupExpired();

    const res = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/worklogs`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { worklogs: Array<{ reason: string; durationS: number; via: string }> };
    expect(body.worklogs.length).toBe(1);
    expect(body.worklogs[0]!.reason).toBe("expired");
    expect(body.worklogs[0]!.durationS).toBeGreaterThanOrEqual(120);
    expect(body.worklogs[0]!.durationS).toBeLessThan(130);
    expect(body.worklogs[0]!.via).toBe("claude-code");
  });
});
