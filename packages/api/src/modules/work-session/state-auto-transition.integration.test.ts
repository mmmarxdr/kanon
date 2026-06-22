/**
 * KAN-143 FIX 1+3 — startWork auto-transition integration test
 *
 * Exercises the REAL wiring: startWork → dynamic import → real transitionIssue
 * → DB state change + ActivityLog. No mocks of transitionIssue.
 *
 * Asserts:
 *   - backlog issue → in_progress after startWork (persisted)
 *   - analysis issue → in_progress after startWork (FIX 1 generalization)
 *   - in_progress issue → state UNCHANGED (idempotent)
 *   - done issue → state UNCHANGED (idempotent)
 *   - ActivityLog record of type "state_changed" exists for transitioned issues
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
import { startWork } from "./service.js";

describe("startWork auto-transition — real DB (KAN-143 FIX 1+3)", () => {
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

  async function seedContext(issueState: string) {
    const ws = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(ws.id, "member");
    const project = await seedTestProject(ws.id);
    await seedTestProjectMember(member.userId, project.id, "member");
    const issue = await prisma.issue.create({
      data: {
        key: `${project.key}-1`,
        title: "Auto-transition test issue",
        type: "task",
        state: issueState as any,
        projectId: project.id,
        sequenceNum: 1,
      },
    });
    return { ws, member, project, issue };
  }

  it("backlog issue → state becomes in_progress after startWork (persisted)", async () => {
    const { member, issue } = await seedContext("backlog");

    await startWork(issue.key, member.id, member.userId, "mcp");

    const updated = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(updated.state).toBe("in_progress");
  });

  it("backlog transition creates an ActivityLog state_changed record", async () => {
    const { member, issue } = await seedContext("backlog");

    await startWork(issue.key, member.id, member.userId, "mcp");

    const log = await prisma.activityLog.findFirst({
      where: { issueId: issue.id, action: "state_changed" },
    });
    expect(log).not.toBeNull();
    expect((log!.details as any).to).toBe("in_progress");
  });

  it("analysis issue → state becomes in_progress after startWork (FIX 1 generalization)", async () => {
    const { member, issue } = await seedContext("analysis");

    await startWork(issue.key, member.id, member.userId, "mcp");

    const updated = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(updated.state).toBe("in_progress");
  });

  it("analysis transition creates an ActivityLog state_changed record", async () => {
    const { member, issue } = await seedContext("analysis");

    await startWork(issue.key, member.id, member.userId, "mcp");

    const log = await prisma.activityLog.findFirst({
      where: { issueId: issue.id, action: "state_changed" },
    });
    expect(log).not.toBeNull();
    expect((log!.details as any).to).toBe("in_progress");
  });

  it("in_progress issue → state UNCHANGED after startWork (idempotent)", async () => {
    const { member, issue } = await seedContext("in_progress");

    await startWork(issue.key, member.id, member.userId, "mcp");

    const updated = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(updated.state).toBe("in_progress");

    // No spurious state_changed ActivityLog
    const logs = await prisma.activityLog.findMany({
      where: { issueId: issue.id, action: "state_changed" },
    });
    expect(logs).toHaveLength(0);
  });

  it("done issue → state UNCHANGED after startWork (idempotent)", async () => {
    const { member, issue } = await seedContext("done");

    await startWork(issue.key, member.id, member.userId, "mcp");

    const updated = await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(updated.state).toBe("done");

    // No spurious state_changed ActivityLog
    const logs = await prisma.activityLog.findMany({
      where: { issueId: issue.id, action: "state_changed" },
    });
    expect(logs).toHaveLength(0);
  });
});
