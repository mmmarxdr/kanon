import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import {
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../../test/helpers.js";
import { prisma } from "../../../config/prisma.js";
import { issueTypeSchema } from "@kanon/shared";

/**
 * KAN-103 PR1 (ADR-0005 D6): data model only — the `incident` issue type and the
 * `Interruption` edge. Behaviour (work-session switch, forecast) lands in PR2/PR3.
 */
describe("KAN-103 PR1: incident issue type + Interruption model", () => {
  let memberId: string;
  let projectId: string;
  let seq = 0;

  beforeAll(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await cleanDatabase();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace(`k103${Math.random().toString(36).slice(2, 7)}`);
    const member = await seedTestMember(ws.id);
    memberId = member.id;
    const project = await seedTestProject(ws.id);
    projectId = project.id;
    seq = 0;
  });

  async function seedIssue(type: "incident" | "task"): Promise<{ id: string; type: string }> {
    seq += 1;
    return prisma.issue.create({
      data: {
        key: `K103-${seq}-${Math.random().toString(36).slice(2, 6)}`,
        sequenceNum: seq,
        title: `issue ${seq}`,
        projectId,
        type,
      },
      select: { id: true, type: true },
    });
  }

  it("the shared issueTypeSchema accepts 'incident'", () => {
    expect(issueTypeSchema.parse("incident")).toBe("incident");
  });

  it("an issue can be created with type=incident (enum migration applied)", async () => {
    const incident = await seedIssue("incident");
    expect(incident.type).toBe("incident");
  });

  it("an Interruption links incident → interrupted + member; endedAt is nullable and stampable", async () => {
    const incident = await seedIssue("incident");
    const interrupted = await seedIssue("task");

    const row = await prisma.interruption.create({
      data: {
        incidentIssueId: incident.id,
        interruptedIssueId: interrupted.id,
        memberId,
        via: "session_switch",
      },
    });
    expect(row.endedAt).toBeNull();
    expect(row.via).toBe("session_switch");
    expect(row.startedAt).toBeInstanceOf(Date);

    const ended = await prisma.interruption.update({
      where: { id: row.id },
      data: { endedAt: new Date() },
    });
    expect(ended.endedAt).toBeInstanceOf(Date);
  });

  it("deleting the incident issue cascades to its Interruption rows", async () => {
    const incident = await seedIssue("incident");
    const interrupted = await seedIssue("task");
    await prisma.interruption.create({
      data: {
        incidentIssueId: incident.id,
        interruptedIssueId: interrupted.id,
        memberId,
        via: "manual",
      },
    });

    await prisma.issue.delete({ where: { id: incident.id } });

    const remaining = await prisma.interruption.count({
      where: { interruptedIssueId: interrupted.id },
    });
    expect(remaining).toBe(0);
  });
});
