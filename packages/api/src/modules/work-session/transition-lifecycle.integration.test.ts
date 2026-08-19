import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { drainDomainEventOutbox, enqueueDomainEventTx } from "../../services/event-bus/outbox.js";
import type { DomainEvent } from "../../services/event-bus/types.js";
import {
  captureTransitionClose,
  captureTransitionInterval,
  heartbeat,
  stageTransitionStart,
  startWork,
  stopWork,
} from "./service.js";

async function seedContext(
  issueState: "analysis" | "review" = "review",
  issueType: "task" | "incident" = "task"
) {
  const workspace = await seedTestWorkspace();
  const member = await seedTestMemberWithRole(workspace.id, "member");
  const project = await seedTestProject(workspace.id);
  await seedTestProjectMember(member.userId, project.id, "member");
  const issue = await prisma.issue.create({
    data: {
      key: `${project.key}-1`,
      title: "Durable transition lifecycle",
      type: issueType,
      state: issueState,
      projectId: project.id,
      sequenceNum: 1,
    },
  });
  return { workspace, member, project, issue };
}

describe("durable work-transition lifecycle", () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it("retains one pending start row after failure and acknowledges the same key on heartbeat retry", async () => {
    const { member, issue } = await seedContext("analysis");
    const unsubscribeFailure = eventBus.subscribe(async (event) => {
      if (event.type === "work_session.started") {
        throw new Error("started subscriber unavailable");
      }
    });

    await expect(heartbeat(issue.key, member.id, member.userId, "codex")).rejects.toThrow(
      "subscriber delivery failed"
    );
    unsubscribeFailure();

    const session = await prisma.workSession.findFirstOrThrow({
      where: { issueId: issue.id, userId: member.userId },
    });
    const deliveryKey = `work-session.started:v1:${session.id}`;
    expect(
      await prisma.domainEventOutbox.findMany({
        where: { deliveryKey },
        select: { deliveryKey: true, acknowledgedAt: true },
      })
    ).toEqual([{ deliveryKey, acknowledgedAt: null }]);

    await prisma.domainEventOutbox.updateMany({
      where: { deliveryKey },
      data: { availableAt: new Date(0) },
    });
    await heartbeat(issue.key, member.id, member.userId, "codex");

    expect(
      await prisma.domainEventOutbox.findMany({
        where: { deliveryKey },
        select: { deliveryKey: true, acknowledgedAt: true },
      })
    ).toEqual([{ deliveryKey, acknowledgedAt: expect.any(Date) }]);
  });

  it("rolls back a session and its start row together", async () => {
    const { member, issue, workspace } = await seedContext("analysis");
    let attemptedDeliveryKey = "";

    await expect(
      prisma.$transaction(async (tx) => {
        const session = await tx.workSession.create({
          data: {
            issueId: issue.id,
            userId: member.userId,
            memberId: member.id,
            source: "codex",
          },
        });
        attemptedDeliveryKey = `work-session.started:v1:${session.id}`;
        await enqueueDomainEventTx(tx, {
          deliveryKey: attemptedDeliveryKey,
          laneKey: `work-session:${issue.id}:${member.userId}`,
          event: {
            type: "work_session.started",
            workspaceId: workspace.id,
            actorId: member.id,
            payload: { issueId: issue.id },
          },
        });
        throw new Error("forced transaction rollback");
      })
    ).rejects.toThrow("forced transaction rollback");

    expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
    expect(
      await prisma.domainEventOutbox.count({
        where: { deliveryKey: attemptedDeliveryKey },
      })
    ).toBe(0);
  });

  it("keeps an existing pending start ahead of lifecycle close effects", async () => {
    const { member, issue } = await seedContext("analysis");
    const unsubscribeFailure = eventBus.subscribe(async (event) => {
      if (event.type === "work_session.started") {
        throw new Error("started subscriber unavailable");
      }
    });

    await expect(heartbeat(issue.key, member.id, member.userId, "codex")).rejects.toThrow(
      "subscriber delivery failed"
    );
    unsubscribeFailure();

    const session = await prisma.workSession.findFirstOrThrow({
      where: { issueId: issue.id, userId: member.userId },
    });
    await prisma.domainEventOutbox.update({
      where: { deliveryKey: `work-session.started:v1:${session.id}` },
      data: { availableAt: new Date("2999-01-01T00:00:00.000Z") },
    });

    const startedAt = new Date();
    const staged = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
    await startWork(issue.key, member.id, member.userId, "transition-listener", null, undefined, {
      autoAssign: false,
      transitionObservedAt: startedAt,
      transitionLifecycleIdentity: staged.lifecycle.startIdentity!,
    });
    await stopWork(
      issue.key,
      member.userId,
      member.id,
      null,
      new Date(startedAt.getTime() + 60_000),
      session.id
    );

    const rows = await prisma.domainEventOutbox.findMany({
      where: {
        eventType: {
          in: ["work_session.started", "worklog.created", "work_session.ended"],
        },
      },
      orderBy: { position: "asc" },
      select: { eventType: true, laneKey: true, acknowledgedAt: true },
    });
    const laneKey = `work-session:${issue.id}:${member.userId}`;
    expect(rows).toEqual([
      { eventType: "work_session.started", laneKey, acknowledgedAt: null },
      { eventType: "worklog.created", laneKey, acknowledgedAt: null },
      { eventType: "work_session.ended", laneKey, acknowledgedAt: null },
    ]);
  });

  it("pairs a close persisted before its delayed start into one exact interval and one event pair", async () => {
    const { member, issue } = await seedContext("review");
    const startedAt = new Date("2026-08-11T10:00:00.000Z");
    const endedAt = new Date("2026-08-11T10:01:00.000Z");
    const observed: DomainEvent[] = [];
    const unsubscribe = eventBus.subscribe((event) => observed.push(event));

    try {
      const closed = await captureTransitionClose(issue.key, endedAt);
      expect(closed.workLog).toBeNull();

      const start = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
      expect(start.lifecycle.completed).toBe(true);

      const lifecycle = await prisma.workTransitionLifecycle.findMany({
        where: { issueId: issue.id },
      });
      const workLogs = await prisma.workLog.findMany({
        where: { issueId: issue.id },
      });
      expect(lifecycle).toHaveLength(1);
      expect(lifecycle[0]).toMatchObject({
        startedAt,
        endedAt,
        memberId: member.id,
        userId: member.userId,
        workLogId: workLogs[0]!.id,
      });
      expect(workLogs).toHaveLength(1);
      expect(workLogs[0]).toMatchObject({
        startedAt,
        endedAt,
        durationS: 60,
      });
      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
      expect(observed.map((event) => event.type)).toEqual([
        "worklog.created",
        "work_session.ended",
      ]);
      console.info("KAN243_DB_TOTALS", {
        scenario: "E1-close-before-start",
        lifecycles: 1,
        workSessions: 0,
        workLogs: 1,
        lifecycleEvents: observed.length,
      });

      await captureTransitionClose(issue.key, endedAt);
      await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
      expect(
        await prisma.workTransitionLifecycle.count({
          where: { issueId: issue.id },
        })
      ).toBe(1);
      expect(await prisma.workLog.count({ where: { issueId: issue.id } })).toBe(1);
      expect(observed).toHaveLength(2);
    } finally {
      unsubscribe();
    }
  });

  it("makes an exact completed-start replay a no-op before a later close", async () => {
    const { member, issue } = await seedContext("review");
    const startedAt = new Date("2026-08-11T11:00:00.000Z");
    const endedAt = new Date("2026-08-11T11:02:00.000Z");
    const laterCloseAt = new Date("2026-08-11T11:04:00.000Z");
    const observed: DomainEvent[] = [];
    const unsubscribe = eventBus.subscribe((event) => observed.push(event));

    try {
      await captureTransitionInterval(issue.key, member.userId, member.id, startedAt, endedAt);
      const beforeReplay = {
        lifecycles: await prisma.workTransitionLifecycle.count({
          where: { issueId: issue.id },
        }),
        sessions: await prisma.workSession.count({ where: { issueId: issue.id } }),
        workLogs: await prisma.workLog.count({ where: { issueId: issue.id } }),
        events: observed.length,
      };

      await stageTransitionStart(issue.key, member.userId, member.id, startedAt);

      expect({
        lifecycles: await prisma.workTransitionLifecycle.count({
          where: { issueId: issue.id },
        }),
        sessions: await prisma.workSession.count({ where: { issueId: issue.id } }),
        workLogs: await prisma.workLog.count({ where: { issueId: issue.id } }),
        events: observed.length,
      }).toEqual(beforeReplay);

      await captureTransitionClose(issue.key, laterCloseAt);
      const workLogs = await prisma.workLog.findMany({ where: { issueId: issue.id } });
      expect(workLogs).toHaveLength(1);
      expect(workLogs[0]).toMatchObject({
        startedAt,
        endedAt,
        durationS: 120,
      });
      expect(observed.map((event) => event.type)).toEqual([
        "worklog.created",
        "work_session.ended",
      ]);
      console.info("KAN243_DB_TOTALS", {
        scenario: "E2-completed-start-replay",
        lifecyclesAfterReplay: beforeReplay.lifecycles,
        workSessionsAfterReplay: beforeReplay.sessions,
        workLogsAfterLaterClose: workLogs.length,
        lifecycleEvents: observed.length,
      });
    } finally {
      unsubscribe();
    }
  });

  it("uses database uniqueness to converge concurrent pair replays", async () => {
    const { member, issue } = await seedContext("review");
    const startedAt = new Date("2026-08-11T12:00:00.000Z");
    const endedAt = new Date("2026-08-11T12:02:00.000Z");

    await Promise.all([
      captureTransitionInterval(issue.key, member.userId, member.id, startedAt, endedAt),
      captureTransitionInterval(issue.key, member.userId, member.id, startedAt, endedAt),
    ]);

    expect(
      await prisma.workTransitionLifecycle.count({
        where: { issueId: issue.id },
      })
    ).toBe(1);
    expect(await prisma.workLog.count({ where: { issueId: issue.id } })).toBe(1);
  });

  it("converges a durable close with a lease already finalized by stopWork", async () => {
    const { member, issue } = await seedContext("analysis");
    const startedAt = new Date("2026-08-11T12:00:00.000Z");
    const stoppedAt = new Date("2026-08-11T12:03:00.000Z");
    const closedAt = new Date("2026-08-11T12:04:00.000Z");
    const staged = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
    await prisma.workLog.create({
      data: {
        issueId: issue.id,
        memberId: member.id,
        startedAt: new Date("2026-08-11T11:59:00.000Z"),
        endedAt: new Date("2026-08-11T12:01:00.000Z"),
        durationS: 120,
        reason: "stopped",
        via: "test",
      },
    });
    const session = await prisma.workSession.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "transition-listener",
        startedAt,
        lastHeartbeat: stoppedAt,
        transitionLifecycleId: staged.lifecycle.id,
      },
    });

    const stopped = await stopWork(
      issue.key,
      member.userId,
      member.id,
      null,
      stoppedAt,
      session.id
    );
    const closed = await captureTransitionClose(issue.key, closedAt);

    expect(stopped.workLog).not.toBeNull();
    expect(closed.workLog?.id).toBe(stopped.workLog?.id);
    expect(await prisma.workLog.count({ where: { issueId: issue.id } })).toBe(2);
    expect(
      await prisma.workTransitionLifecycle.findFirst({
        where: { issueId: issue.id },
        select: { workLogId: true, effectRevision: true },
      })
    ).toMatchObject({
      workLogId: stopped.workLog?.id,
      effectRevision: 0,
    });
  });

  it("corrects a provisionally published heartbeat finalization to the authoritative close boundary", async () => {
    const { member, issue } = await seedContext("review");
    const startedAt = new Date("2026-08-11T12:00:00.000Z");
    const closedAt = new Date("2026-08-11T12:02:00.000Z");
    const heartbeatAt = new Date("2026-08-11T12:04:00.000Z");
    const staged = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
    await prisma.workSession.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "transition-listener",
        startedAt,
        lastHeartbeat: startedAt,
        transitionLifecycleId: staged.lifecycle.id,
      },
    });
    const observed: DomainEvent[] = [];
    const unsubscribe = eventBus.subscribe((event) => observed.push(event));

    try {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(heartbeatAt);
      expect(await heartbeat(issue.key, member.userId)).toBeNull();
      vi.useRealTimers();

      await captureTransitionClose(issue.key, closedAt);

      const lifecycles = await prisma.workTransitionLifecycle.findMany({
        where: { issueId: issue.id },
      });
      const workLogs = await prisma.workLog.findMany({
        where: { issueId: issue.id },
      });
      expect(lifecycles).toHaveLength(1);
      expect(workLogs).toHaveLength(1);
      expect(lifecycles[0]).toMatchObject({
        id: staged.lifecycle.id,
        startedAt,
        endedAt: closedAt,
        workLogId: workLogs[0]!.id,
        effectRevision: 1,
      });
      expect(workLogs[0]).toMatchObject({
        startedAt,
        endedAt: closedAt,
        durationS: 120,
        reason: "stopped",
      });
      expect(
        observed
          .filter((event) => event.type === "work_session.ended")
          .map((event) => event.payload)
      ).toEqual([
        expect.objectContaining({
          workLogId: workLogs[0]!.id,
          durationS: 240,
        }),
        expect.objectContaining({
          workLogId: workLogs[0]!.id,
          durationS: 120,
        }),
      ]);

      await captureTransitionClose(issue.key, closedAt);
      expect(
        await prisma.workTransitionLifecycle.count({
          where: { issueId: issue.id },
        })
      ).toBe(1);
      expect(await prisma.workLog.count({ where: { issueId: issue.id } })).toBe(1);
      expect(observed).toHaveLength(4);
    } finally {
      vi.useRealTimers();
      unsubscribe();
    }
  });

  it("atomically finalizes an incident lease and its interruption at the observed boundary", async () => {
    const { workspace, member, project, issue } = await seedContext("analysis", "incident");
    const interruptedIssue = await prisma.issue.create({
      data: {
        key: `${project.key}-2`,
        title: "Interrupted task",
        type: "task",
        state: "analysis",
        projectId: project.id,
        sequenceNum: 2,
      },
    });
    const startedAt = new Date("2026-08-11T13:00:00.000Z");
    const closedAt = new Date("2026-08-11T13:02:00.000Z");
    const staged = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
    await prisma.workSession.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "transition-listener",
        startedAt,
        lastHeartbeat: closedAt,
        transitionLifecycleId: staged.lifecycle.id,
      },
    });
    const interruption = await prisma.interruption.create({
      data: {
        incidentIssueId: issue.id,
        interruptedIssueId: interruptedIssue.id,
        memberId: member.id,
        via: "session_switch",
        startedAt,
      },
    });
    const observed: DomainEvent[] = [];
    const unsubscribe = eventBus.subscribe((event) => observed.push(event));

    try {
      await captureTransitionClose(issue.key, closedAt);

      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
      expect(
        await prisma.interruption.findUnique({ where: { id: interruption.id } })
      ).toMatchObject({ endedAt: closedAt });
      expect(observed.map((event) => event.type)).toEqual([
        "worklog.created",
        "work_session.ended",
        "interruption.closed",
      ]);
      expect(observed[0]?.workspaceId).toBe(workspace.id);
    } finally {
      unsubscribe();
    }
  });

  it("persists lifecycle effects when an incident displaces a transition-owned session", async () => {
    const { member, project, issue } = await seedContext("analysis");
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
    const startedAt = new Date("2026-08-11T13:00:00.000Z");
    const displacedAt = new Date("2026-08-11T13:02:00.000Z");
    const staged = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
    await prisma.workSession.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "transition-listener",
        startedAt,
        lastHeartbeat: displacedAt,
        transitionLifecycleId: staged.lifecycle.id,
      },
    });

    await startWork(incident.key, member.id, member.userId, "mcp", null, undefined, {
      autoAssign: false,
      transitionObservedAt: displacedAt,
    });

    expect(
      await prisma.domainEventOutbox.findMany({
        where: { laneKey: `work-session:${issue.id}:${member.userId}` },
        orderBy: { position: "asc" },
        select: { eventType: true },
      })
    ).toEqual([{ eventType: "worklog.created" }, { eventType: "work_session.ended" }]);
    expect(
      await prisma.interruption.findFirst({
        where: {
          incidentIssueId: incident.id,
          interruptedIssueId: issue.id,
          memberId: member.id,
          endedAt: null,
        },
      })
    ).not.toBeNull();
  });

  it("enqueues an incident lifecycle close only after its interruption is closed", async () => {
    const { member, project, issue } = await seedContext("analysis", "incident");
    const interruptedIssue = await prisma.issue.create({
      data: {
        key: `${project.key}-2`,
        title: "Interrupted task",
        type: "task",
        state: "analysis",
        projectId: project.id,
        sequenceNum: 2,
      },
    });
    const startedAt = new Date("2026-08-11T14:00:00.000Z");
    const heartbeatAt = new Date("2026-08-11T14:01:00.000Z");
    const restartedAt = new Date("2026-08-11T14:10:00.000Z");
    const staged = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
    await prisma.workSession.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "transition-listener",
        startedAt,
        lastHeartbeat: heartbeatAt,
        transitionLifecycleId: staged.lifecycle.id,
      },
    });
    await prisma.interruption.create({
      data: {
        incidentIssueId: issue.id,
        interruptedIssueId: interruptedIssue.id,
        memberId: member.id,
        via: "session_switch",
        startedAt,
      },
    });

    await startWork(issue.key, member.id, member.userId, "mcp", null, undefined, {
      autoAssign: false,
      transitionObservedAt: restartedAt,
    });

    expect(
      await prisma.domainEventOutbox.findMany({
        where: { laneKey: `work-session:${issue.id}:${member.userId}` },
        orderBy: { position: "asc" },
        select: { eventType: true },
      })
    ).toEqual([
      { eventType: "worklog.created" },
      { eventType: "work_session.ended" },
      { eventType: "interruption.closed" },
      { eventType: "work_session.started" },
    ]);
  });

  it("preserves a refreshed later generation while finalizing the older close", async () => {
    const { member, issue } = await seedContext("analysis");
    const startedAt = new Date("2026-08-11T14:00:00.000Z");
    const closedAt = new Date("2026-08-11T14:04:00.000Z");
    const refreshedAt = new Date("2026-08-11T14:05:00.000Z");
    const staged = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
    const session = await prisma.workSession.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "transition-listener",
        startedAt,
        lastHeartbeat: refreshedAt,
        transitionLifecycleId: staged.lifecycle.id,
      },
    });

    await captureTransitionClose(issue.key, closedAt);

    expect(await prisma.workSession.findUnique({ where: { id: session.id } })).toMatchObject({
      id: session.id,
      startedAt: refreshedAt,
      lastHeartbeat: refreshedAt,
    });
    expect(await prisma.workLog.findMany({ where: { issueId: issue.id } })).toMatchObject([
      { startedAt, endedAt: closedAt, durationS: 240 },
    ]);
  });

  it("keeps later explicit work adjacent to an older lifecycle interval", async () => {
    const { member, issue } = await seedContext("analysis");
    const lifecycleStartedAt = new Date("2026-08-11T14:00:00.000Z");
    const explicitStartedAt = new Date("2026-08-11T14:02:00.000Z");
    const stoppedAt = new Date("2026-08-11T14:05:00.000Z");
    await stageTransitionStart(issue.key, member.userId, member.id, lifecycleStartedAt);
    const explicitSession = await prisma.workSession.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "mcp",
        startedAt: explicitStartedAt,
        lastHeartbeat: stoppedAt,
      },
    });

    await captureTransitionClose(issue.key, stoppedAt);
    expect(
      await prisma.workSession.findUnique({
        where: { id: explicitSession.id },
      })
    ).toMatchObject({
      id: explicitSession.id,
      startedAt: explicitStartedAt,
    });

    await stopWork(issue.key, member.userId, member.id, null, stoppedAt, explicitSession.id);

    const workLogs = await prisma.workLog.findMany({
      where: { issueId: issue.id },
      orderBy: { startedAt: "asc" },
    });
    expect(workLogs).toMatchObject([
      {
        startedAt: lifecycleStartedAt,
        endedAt: explicitStartedAt,
        durationS: 120,
      },
      {
        startedAt: explicitStartedAt,
        endedAt: stoppedAt,
        durationS: 180,
      },
    ]);
    expect(workLogs.reduce((total, row) => total + row.durationS, 0)).toBe(300);
  });

  it("keeps a delayed lifecycle adjacent after later explicit work already stopped", async () => {
    const { member, issue } = await seedContext("analysis");
    const lifecycleStartedAt = new Date("2026-08-11T15:00:00.000Z");
    const explicitStartedAt = new Date("2026-08-11T15:02:00.000Z");
    const stoppedAt = new Date("2026-08-11T15:05:00.000Z");
    await stageTransitionStart(issue.key, member.userId, member.id, lifecycleStartedAt);
    const explicitSession = await prisma.workSession.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "mcp",
        startedAt: explicitStartedAt,
        lastHeartbeat: stoppedAt,
      },
    });

    await stopWork(issue.key, member.userId, member.id, null, stoppedAt, explicitSession.id);
    await captureTransitionClose(issue.key, stoppedAt);

    const workLogs = await prisma.workLog.findMany({
      where: { issueId: issue.id },
      orderBy: { startedAt: "asc" },
    });
    expect(workLogs).toMatchObject([
      {
        startedAt: lifecycleStartedAt,
        endedAt: explicitStartedAt,
        durationS: 120,
      },
      {
        startedAt: explicitStartedAt,
        endedAt: stoppedAt,
        durationS: 180,
      },
    ]);
    expect(workLogs[0]!.endedAt.getTime()).toBeLessThanOrEqual(workLogs[1]!.startedAt.getTime());
    expect(workLogs.reduce((total, row) => total + row.durationS, 0)).toBe(300);
  });

  it("recovers committed lifecycle effects that were not acknowledged", async () => {
    const { member, issue } = await seedContext("analysis");
    const startedAt = new Date("2026-08-11T15:00:00.000Z");
    const endedAt = new Date("2026-08-11T15:01:00.000Z");
    const staged = await stageTransitionStart(issue.key, member.userId, member.id, startedAt);
    const session = await prisma.workSession.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "transition-listener",
        startedAt,
        lastHeartbeat: endedAt,
        transitionLifecycleId: staged.lifecycle.id,
      },
    });
    const unsubscribeFailure = eventBus.subscribe(async () => {
      throw new Error("subscriber unavailable");
    });
    const stopped = await stopWork(issue.key, member.userId, member.id, null, endedAt, session.id);
    unsubscribeFailure();
    const lifecycle = await prisma.workTransitionLifecycle.findUniqueOrThrow({
      where: { id: staged.lifecycle.id },
    });
    expect(lifecycle).toMatchObject({
      workLogId: stopped.workLog?.id,
      effectRevision: 0,
    });
    const laneKey = `work-session:${issue.id}:${member.userId}`;
    expect(
      await prisma.domainEventOutbox.count({
        where: { laneKey, acknowledgedAt: null },
      })
    ).toBe(2);
    await prisma.domainEventOutbox.updateMany({
      where: { laneKey, acknowledgedAt: null },
      data: { availableAt: new Date(0) },
    });
    const observed: DomainEvent[] = [];
    const unsubscribe = eventBus.subscribe((event) => observed.push(event));

    try {
      await drainDomainEventOutbox();

      expect(observed.map((event) => event.type)).toEqual([
        "worklog.created",
        "work_session.ended",
      ]);
      expect(
        await prisma.domainEventOutbox.count({
          where: { laneKey, acknowledgedAt: null },
        })
      ).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it("blocks a lifecycle interval that overlaps foreign ownership", async () => {
    const { workspace, member, project, issue } = await seedContext("review");
    const foreign = await seedTestMemberWithRole(workspace.id, "member");
    await seedTestProjectMember(foreign.userId, project.id, "member");
    const startedAt = new Date("2026-08-11T14:00:00.000Z");
    const endedAt = new Date("2026-08-11T14:02:00.000Z");
    await prisma.workLog.create({
      data: {
        issueId: issue.id,
        memberId: foreign.id,
        startedAt: new Date("2026-08-11T14:01:00.000Z"),
        endedAt: new Date("2026-08-11T14:03:00.000Z"),
        durationS: 120,
        reason: "stopped",
        via: "test",
      },
    });

    const blocked = await captureTransitionInterval(
      issue.key,
      member.userId,
      member.id,
      startedAt,
      endedAt
    );
    expect(blocked.workLog).toBeNull();
    expect(await prisma.workLog.count({ where: { issueId: issue.id } })).toBe(1);
  });

  it("allows adjacent half-open foreign ownership at the interval boundary", async () => {
    const boundary = await seedContext("review");
    const boundaryForeign = await seedTestMemberWithRole(boundary.workspace.id, "member");
    await seedTestProjectMember(boundaryForeign.userId, boundary.project.id, "member");
    const startedAt = new Date("2026-08-11T15:00:00.000Z");
    const endedAt = new Date("2026-08-11T15:02:00.000Z");
    await prisma.workLog.create({
      data: {
        issueId: boundary.issue.id,
        memberId: boundaryForeign.id,
        startedAt: endedAt,
        endedAt: new Date("2026-08-11T15:04:00.000Z"),
        durationS: 120,
        reason: "stopped",
        via: "test",
      },
    });

    const allowed = await captureTransitionInterval(
      boundary.issue.key,
      boundary.member.userId,
      boundary.member.id,
      startedAt,
      endedAt
    );
    expect(allowed.workLog).not.toBeNull();
    const intervals = await prisma.workLog.findMany({
      where: { issueId: boundary.issue.id },
      orderBy: { startedAt: "asc" },
    });
    expect(intervals).toHaveLength(2);
    expect(intervals[0]).toMatchObject({ startedAt, endedAt });
    expect(intervals[1]!.startedAt).toEqual(endedAt);
  });

  it("rolls back lifecycle and WorkLog together when completion cannot commit", async () => {
    const { member, issue } = await seedContext("review");
    const startedAt = new Date("2026-08-11T13:00:00.000Z");
    const endedAt = new Date("2026-08-11T13:02:00.000Z");
    await prisma.$executeRawUnsafe(
      "DROP TRIGGER IF EXISTS kan243_reject_lifecycle_completion ON work_transition_lifecycles"
    );
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION kan243_reject_lifecycle_completion() RETURNS trigger AS $$
      BEGIN
        IF NEW.work_log_id IS NOT NULL THEN
          RAISE EXCEPTION 'KAN243 forced lifecycle completion rollback';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER kan243_reject_lifecycle_completion
      BEFORE INSERT OR UPDATE ON work_transition_lifecycles
      FOR EACH ROW EXECUTE FUNCTION kan243_reject_lifecycle_completion();
    `);

    try {
      await expect(
        captureTransitionInterval(issue.key, member.userId, member.id, startedAt, endedAt)
      ).rejects.toThrow("KAN243 forced lifecycle completion rollback");
      expect(await prisma.workLog.count({ where: { issueId: issue.id } })).toBe(0);
      expect(
        await prisma.workTransitionLifecycle.count({
          where: { issueId: issue.id },
        })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        "DROP TRIGGER IF EXISTS kan243_reject_lifecycle_completion ON work_transition_lifecycles"
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS kan243_reject_lifecycle_completion()"
      );
    }
  });
});
