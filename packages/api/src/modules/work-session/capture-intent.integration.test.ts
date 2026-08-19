import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  seedTestWorkspace,
} from "../../test/helpers.js";
import {
  captureTransitionClose,
  cleanupExpired,
  heartbeat,
  recordInterruption,
  stageTransitionStart,
  startWork,
  stopActiveWorkSessions,
  stopWork,
} from "./service.js";

async function seedContext(state: "backlog" | "analysis" | "review" = "analysis") {
  const workspace = await seedTestWorkspace();
  const member = await seedTestMemberWithRole(workspace.id, "member");
  const project = await seedTestProject(workspace.id);
  await seedTestProjectMember(member.userId, project.id, "member");
  const issue = await prisma.issue.create({
    data: {
      key: `${project.key}-1`,
      title: "Durable capture intent",
      state,
      projectId: project.id,
      sequenceNum: 1,
    },
  });
  return { workspace, member, project, issue };
}

describe("durable WorkCaptureIntent coupling", () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it("rolls back issue, session, and intent when durable start enqueue fails", async () => {
    const { member, issue } = await seedContext("backlog");
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_capture_intent_start_enqueue()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.event_type = 'work_session.started' THEN
          RAISE EXCEPTION 'KAN243 forced start enqueue rollback';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_capture_intent_start_enqueue_trigger
      BEFORE INSERT ON "domain_event_outbox"
      FOR EACH ROW EXECUTE FUNCTION reject_capture_intent_start_enqueue()
    `);

    try {
      await expect(startWork(issue.key, member.id, member.userId, "codex")).rejects.toThrow(
        "KAN243 forced start enqueue rollback"
      );
      expect(await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).toMatchObject({
        state: "backlog",
      });
      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
      expect(await prisma.workCaptureIntent.count({ where: { issueId: issue.id } })).toBe(0);
      expect(
        await prisma.domainEventOutbox.count({ where: { eventType: "work_session.started" } })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS reject_capture_intent_start_enqueue_trigger ON "domain_event_outbox"'
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS reject_capture_intent_start_enqueue()"
      );
    }
  });

  it("preserves a refresh generation, advances a replacement, and rotates a closed lifecycle", async () => {
    const { member, issue } = await seedContext();

    await startWork(issue.key, member.id, member.userId, "codex");
    const first = await prisma.workCaptureIntent.findUniqueOrThrow({
      where: { userId_issueId: { userId: member.userId, issueId: issue.id } },
    });
    expect(first).toMatchObject({ state: "capturing", leaseGeneration: 1, source: "codex" });

    await heartbeat(issue.key, member.id, member.userId, "codex");
    const refreshed = await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: first.id } });
    expect(refreshed).toMatchObject({ epoch: first.epoch, leaseGeneration: 1 });

    const stale = new Date(Date.now() - 10 * 60 * 1000);
    await prisma.workSession.updateMany({
      where: { userId: member.userId, issueId: issue.id },
      data: { startedAt: stale, lastHeartbeat: stale },
    });
    await cleanupExpired();
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: first.id } })
    ).toMatchObject({ state: "adopted", epoch: first.epoch, leaseGeneration: 1 });

    await startWork(issue.key, member.id, member.userId, "codex");
    const replacement = await prisma.workCaptureIntent.findUniqueOrThrow({
      where: { id: first.id },
    });
    expect(replacement).toMatchObject({
      state: "capturing",
      epoch: first.epoch,
      leaseGeneration: 2,
    });

    await stopWork(issue.key, member.userId, member.id);
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: first.id } })
    ).toMatchObject({
      state: "closed",
      epoch: first.epoch,
      leaseGeneration: 2,
      closedAt: expect.any(Date),
    });

    await expect(heartbeat(issue.key, member.id, member.userId, "codex")).rejects.toMatchObject({
      code: "CAPTURE_CLOSED",
    });
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: first.id } })
    ).toMatchObject({ state: "closed", epoch: first.epoch, leaseGeneration: 2 });

    await startWork(issue.key, member.id, member.userId, "codex");
    const rotated = await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: first.id } });
    expect(rotated.state).toBe("capturing");
    expect(rotated.leaseGeneration).toBe(1);
    expect(rotated.epoch).not.toBe(first.epoch);
    expect(rotated.closedAt).toBeNull();
  });

  it("pauses with an interruption, rejects heartbeat renewal, and resumes atomically on start", async () => {
    const { member, project, issue } = await seedContext();
    const incident = await prisma.issue.create({
      data: {
        key: `${project.key}-2`,
        title: "Incident",
        type: "incident",
        state: "analysis",
        projectId: project.id,
        sequenceNum: 2,
      },
    });
    await startWork(issue.key, member.id, member.userId, "codex");
    const before = await prisma.workSession.findFirstOrThrow({ where: { issueId: issue.id } });

    const interruption = await recordInterruption(incident.key, issue.key, member.id);
    expect(
      await prisma.workCaptureIntent.findFirstOrThrow({ where: { issueId: issue.id } })
    ).toMatchObject({ state: "paused" });
    await expect(heartbeat(issue.key, member.id, member.userId, "codex")).rejects.toMatchObject({
      code: "CAPTURE_PAUSED",
    });
    expect(await prisma.workSession.findUniqueOrThrow({ where: { id: before.id } })).toMatchObject({
      lastHeartbeat: before.lastHeartbeat,
    });

    await startWork(issue.key, member.id, member.userId, "codex");
    expect(
      await prisma.workCaptureIntent.findFirstOrThrow({ where: { issueId: issue.id } })
    ).toMatchObject({ state: "capturing", leaseGeneration: 1 });
    expect(
      await prisma.interruption.findUniqueOrThrow({ where: { id: interruption.id } })
    ).toMatchObject({ endedAt: expect.any(Date) });
  });

  it("does not infer an intent from interruption-only evidence", async () => {
    const { member, project, issue } = await seedContext();
    const incident = await prisma.issue.create({
      data: {
        key: `${project.key}-2`,
        title: "Interruption without capture",
        type: "incident",
        state: "analysis",
        projectId: project.id,
        sequenceNum: 2,
      },
    });

    await recordInterruption(incident.key, issue.key, member.id);

    expect(await prisma.workCaptureIntent.count({ where: { issueId: issue.id } })).toBe(0);
  });

  it("closes a no-session intent and ignores a stale fence after lifecycle rotation", async () => {
    const { member, issue } = await seedContext();
    const intent = await prisma.workCaptureIntent.create({
      data: {
        userId: member.userId,
        issueId: issue.id,
        memberId: member.id,
        source: "codex",
        state: "adopted",
      },
    });

    expect(await stopActiveWorkSessions(issue.key)).toHaveLength(1);
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
    ).toMatchObject({ state: "closed", closedAt: expect.any(Date) });

    await startWork(issue.key, member.id, member.userId, "codex");
    const replacement = await prisma.workCaptureIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    await stopWork(issue.key, member.userId, member.id, null, new Date(), undefined, {
      epoch: intent.epoch,
      leaseGeneration: intent.leaseGeneration,
    });
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
    ).toMatchObject({
      state: "capturing",
      epoch: replacement.epoch,
      leaseGeneration: replacement.leaseGeneration,
      closedAt: null,
    });
  });

  it("atomically pauses a displaced sibling intent when an incident session starts", async () => {
    const { member, project, issue } = await seedContext();
    const incident = await prisma.issue.create({
      data: {
        key: `${project.key}-2`,
        title: "Displacing incident",
        type: "incident",
        state: "analysis",
        projectId: project.id,
        sequenceNum: 2,
      },
    });
    await startWork(issue.key, member.id, member.userId, "codex");

    await startWork(incident.key, member.id, member.userId, "codex");

    expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
    expect(
      await prisma.workCaptureIntent.findFirstOrThrow({ where: { issueId: issue.id } })
    ).toMatchObject({ state: "paused", closedAt: null });
    expect(
      await prisma.interruption.count({
        where: {
          incidentIssueId: incident.id,
          interruptedIssueId: issue.id,
          memberId: member.id,
          endedAt: null,
        },
      })
    ).toBe(1);
  });

  it("enforces positive generation and closedAt iff closed", async () => {
    const { member, issue } = await seedContext();
    const base = {
      userId: member.userId,
      issueId: issue.id,
      memberId: member.id,
      source: "codex",
    };

    await expect(
      prisma.workCaptureIntent.create({ data: { ...base, leaseGeneration: 0 } })
    ).rejects.toThrow();
    await expect(
      prisma.workCaptureIntent.create({ data: { ...base, state: "closed", closedAt: null } })
    ).rejects.toThrow();
    await expect(
      prisma.workCaptureIntent.create({
        data: { ...base, state: "capturing", closedAt: new Date() },
      })
    ).rejects.toThrow();
  });

  it("applies cleanup state with the successful session CAS and leaves paused intent paused", async () => {
    const { member, project, issue: activeIssue } = await seedContext();
    const pausedIssue = await prisma.issue.create({
      data: {
        key: `${project.key}-2`,
        title: "Paused",
        state: "analysis",
        projectId: project.id,
        sequenceNum: 2,
      },
    });
    const closedIssue = await prisma.issue.create({
      data: {
        key: `${project.key}-3`,
        title: "Closed",
        state: "review",
        projectId: project.id,
        sequenceNum: 3,
      },
    });
    const stale = new Date(Date.now() - 10 * 60 * 1000);
    for (const [candidate, state] of [
      [activeIssue, "capturing"],
      [pausedIssue, "paused"],
      [closedIssue, "capturing"],
    ] as const) {
      await prisma.workCaptureIntent.create({
        data: {
          userId: member.userId,
          issueId: candidate.id,
          memberId: member.id,
          source: "codex",
          state,
        },
      });
      await prisma.workSession.create({
        data: {
          userId: member.userId,
          issueId: candidate.id,
          memberId: member.id,
          source: "codex",
          startedAt: stale,
          lastHeartbeat: stale,
        },
      });
    }

    expect(await cleanupExpired()).toBe(3);
    expect(
      await prisma.workCaptureIntent.findFirstOrThrow({ where: { issueId: activeIssue.id } })
    ).toMatchObject({ state: "adopted", closedAt: null });
    expect(
      await prisma.workCaptureIntent.findFirstOrThrow({ where: { issueId: pausedIssue.id } })
    ).toMatchObject({ state: "paused", closedAt: null });
    expect(
      await prisma.workCaptureIntent.findFirstOrThrow({ where: { issueId: closedIssue.id } })
    ).toMatchObject({ state: "closed", closedAt: expect.any(Date) });
  });

  it("closes intent when an exact lifecycle deletes a sub-second session without a WorkLog", async () => {
    const { member, issue } = await seedContext();
    const startedAt = new Date("2026-08-18T12:00:00.000Z");
    const staged = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
    await startWork(issue.key, member.id, member.userId, "transition-listener", null, undefined, {
      autoAssign: false,
      onConflict: "skip",
      transitionObservedAt: startedAt,
      transitionLifecycleIdentity: staged.lifecycle.startIdentity ?? undefined,
    });

    await captureTransitionClose(issue.key, new Date(startedAt.getTime() + 500));

    expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
    expect(await prisma.workLog.count({ where: { issueId: issue.id } })).toBe(0);
    expect(
      await prisma.workCaptureIntent.findFirstOrThrow({ where: { issueId: issue.id } })
    ).toMatchObject({ state: "closed", closedAt: new Date(startedAt.getTime() + 500) });
  });
});
