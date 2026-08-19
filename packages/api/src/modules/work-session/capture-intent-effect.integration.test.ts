import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import {
  drainDomainEventOutbox,
  publishDomainEventByDeliveryKey,
} from "../../services/event-bus/outbox.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  seedTestWorkspace,
} from "../../test/helpers.js";
import {
  closeCaptureIntentTx,
  pauseCaptureIntentTx,
  rebaseCaptureIntentTx,
} from "./capture-intent.js";
import { requestWorkCaptureIntentEffect } from "./capture-intent-effect.js";
import { registerCaptureIntentListener } from "./capture-intent-listener.js";
import { recordInterruption } from "./service.js";
import { registerTransitionListener } from "./transition-listener.js";
import { transitionIssue } from "../issue/service.js";

async function seedContext(
  options: {
    keySuffix?: number;
    state?: "adopted" | "capturing" | "paused" | "closed";
    withSession?: boolean;
    startedAt?: Date;
    issueType?: "task" | "incident";
  } = {}
) {
  const workspace = await seedTestWorkspace();
  const member = await seedTestMemberWithRole(workspace.id, "member");
  const project = await seedTestProject(workspace.id);
  await seedTestProjectMember(member.userId, project.id, "member");
  const issue = await prisma.issue.create({
    data: {
      key: `${project.key}-${options.keySuffix ?? 1}`,
      title: "Capture intent effect",
      type: options.issueType ?? "task",
      state: "analysis",
      projectId: project.id,
      sequenceNum: options.keySuffix ?? 1,
    },
  });
  const intent = await prisma.workCaptureIntent.create({
    data: {
      userId: member.userId,
      issueId: issue.id,
      memberId: member.id,
      source: "codex",
      state: options.state ?? "adopted",
      ...(options.state === "closed" ? { closedAt: new Date() } : {}),
    },
  });
  const session = options.withSession
    ? await prisma.workSession.create({
        data: {
          userId: member.userId,
          issueId: issue.id,
          memberId: member.id,
          source: "codex",
          startedAt: options.startedAt ?? new Date(Date.now() - 60_000),
          lastHeartbeat: options.startedAt ?? new Date(Date.now() - 60_000),
        },
      })
    : null;
  return { workspace, member, project, issue, intent, session };
}

function requestFor(
  intent: { id: string; epoch: string; leaseGeneration: number },
  kind: "activity" | "release" | "close",
  commandId = randomUUID()
) {
  return {
    commandId,
    intentId: intent.id,
    epoch: intent.epoch,
    leaseGeneration: intent.leaseGeneration,
    kind,
  } as const;
}

function jsonWithoutBigInt(value: unknown): string {
  return JSON.stringify(value, (_key, candidate) =>
    typeof candidate === "bigint" ? candidate.toString() : candidate
  );
}

const RAW_FAILURE_MARKER = "KAN243_RAW_CAPTURE_EFFECT_MARKER";

async function installApplyFailure(table: "work_sessions" | "work_logs"): Promise<void> {
  await prisma.$executeRawUnsafe(`
    CREATE OR REPLACE FUNCTION reject_capture_effect_apply()
    RETURNS trigger AS $$ BEGIN
      RAISE EXCEPTION '${RAW_FAILURE_MARKER}';
    END; $$ LANGUAGE plpgsql
  `);
  await prisma.$executeRawUnsafe(`
    CREATE TRIGGER reject_capture_effect_apply_trigger
    BEFORE INSERT ON "${table}"
    FOR EACH ROW EXECUTE FUNCTION reject_capture_effect_apply()
  `);
}

async function removeApplyFailure(table: "work_sessions" | "work_logs"): Promise<void> {
  await prisma.$executeRawUnsafe(
    `DROP TRIGGER IF EXISTS reject_capture_effect_apply_trigger ON "${table}"`
  );
  await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_capture_effect_apply()");
}

async function makeDeliveryDue(deliveryKey: string): Promise<void> {
  await prisma.domainEventOutbox.update({
    where: { deliveryKey },
    data: { availableAt: new Date(0), claimToken: null, claimedAt: null },
  });
}

describe("durable WorkCaptureIntent effects", () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  afterAll(async () => {
    await disconnectTestDb();
  });

  it("derives the accepted effect timestamp from PostgreSQL instead of command input", async () => {
    const { intent } = await seedContext();
    const before = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
    const requested = await requestWorkCaptureIntentEffect({
      commandId: randomUUID(),
      intentId: intent.id,
      epoch: intent.epoch,
      leaseGeneration: intent.leaseGeneration,
      kind: "activity",
    });
    const after = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT CURRENT_TIMESTAMP AS now`;
    const row = await prisma.domainEventOutbox.findUniqueOrThrow({
      where: { deliveryKey: requested.deliveryKey },
    });
    const payload = row.payload as { observedAt: string };
    const observedAt = new Date(payload.observedAt);

    expect(observedAt.getTime()).toBeGreaterThanOrEqual(before[0]!.now.getTime());
    expect(observedAt.getTime()).toBeLessThanOrEqual(after[0]!.now.getTime());
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
    ).toMatchObject({ pendingEffectAt: observedAt });
  });

  it("keeps a server-timed activity closeable by a subsequent terminal transition", async () => {
    const { intent, issue, member } = await seedContext();
    const unsubscribeCapture = registerCaptureIntentListener(eventBus);
    const unsubscribeTransition = registerTransitionListener(eventBus, {
      error: () => undefined,
    });
    try {
      const requested = await requestWorkCaptureIntentEffect(requestFor(intent, "activity"));
      expect(await publishDomainEventByDeliveryKey(requested.deliveryKey)).toBe(true);

      await transitionIssue(issue.key, "review", member.id, "mcp");

      expect(
        await prisma.workSession.findUnique({
          where: { userId_issueId: { userId: member.userId, issueId: issue.id } },
        })
      ).toBeNull();
      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
      ).toMatchObject({ state: "closed", closedAt: expect.any(Date) });
    } finally {
      unsubscribeTransition();
      unsubscribeCapture();
    }
  });

  it("rolls back the pending effect when its outbox enqueue fails", async () => {
    const { intent } = await seedContext();
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_capture_intent_effect_enqueue()
      RETURNS trigger AS $$
      BEGIN
        IF NEW.event_type = 'work_capture.intent_effect_requested' THEN
          RAISE EXCEPTION 'KAN243 forced intent effect enqueue rollback';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_capture_intent_effect_enqueue_trigger
      BEFORE INSERT ON "domain_event_outbox"
      FOR EACH ROW EXECUTE FUNCTION reject_capture_intent_effect_enqueue()
    `);

    try {
      await expect(requestWorkCaptureIntentEffect(requestFor(intent, "activity"))).rejects.toThrow(
        "KAN243 forced intent effect enqueue rollback"
      );
      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
      ).toMatchObject({
        state: "adopted",
        effectRevision: 0,
        pendingEffectKind: null,
        pendingEffectAt: null,
        pendingEffectCommandId: null,
      });
      expect(
        await prisma.domainEventOutbox.count({
          where: { eventType: "work_capture.intent_effect_requested" },
        })
      ).toBe(0);
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS reject_capture_intent_effect_enqueue_trigger ON "domain_event_outbox"'
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS reject_capture_intent_effect_enqueue()"
      );
    }
  });

  it("deduplicates an identical command and rejects command-id semantic drift", async () => {
    const { intent } = await seedContext();
    const commandId = randomUUID();
    const request = requestFor(intent, "activity", commandId);

    const first = await requestWorkCaptureIntentEffect(request);
    const replay = await requestWorkCaptureIntentEffect(request);
    expect(replay).toEqual(first);
    expect(
      await prisma.domainEventOutbox.count({ where: { deliveryKey: first.deliveryKey } })
    ).toBe(1);
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
    ).toMatchObject({ effectRevision: 1, pendingEffectCommandId: commandId });

    await expect(
      requestWorkCaptureIntentEffect({ ...request, kind: "release" })
    ).rejects.toMatchObject({ code: "CAPTURE_EFFECT_COMMAND_CONFLICT" });
    await expect(
      requestWorkCaptureIntentEffect({
        ...request,
        leaseGeneration: request.leaseGeneration + 1,
      })
    ).rejects.toMatchObject({ code: "CAPTURE_EFFECT_COMMAND_CONFLICT" });
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
    ).toMatchObject({ effectRevision: 1, pendingEffectKind: "activity" });
  });

  it("supersedes older activity/release commands, blocks activity after close, and invalidates activity on pause", async () => {
    const { intent } = await seedContext();
    const first = await requestWorkCaptureIntentEffect(requestFor(intent, "release"));
    const second = await requestWorkCaptureIntentEffect(requestFor(intent, "activity"));
    expect(second.effectRevision).toBe(first.effectRevision + 1);
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
    ).toMatchObject({
      state: "adopted",
      pendingEffectKind: "activity",
      pendingEffectCommandId: second.commandId,
    });

    await prisma.$transaction((tx) =>
      pauseCaptureIntentTx(tx, {
        userId: (intent as { userId: string }).userId,
        issueId: (intent as { issueId: string }).issueId,
        memberId: (intent as { memberId: string }).memberId,
      })
    );
    expect(
      await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
    ).toMatchObject({ state: "paused", pendingEffectKind: null });

    const closeContext = await seedContext({ keySuffix: 2 });
    await requestWorkCaptureIntentEffect(requestFor(closeContext.intent, "close"));
    await expect(
      requestWorkCaptureIntentEffect(requestFor(closeContext.intent, "activity"))
    ).rejects.toMatchObject({ code: "CAPTURE_EFFECT_BLOCKED" });
  });

  it("recovers activity once, and crash-after-apply replay does not duplicate its lease or started event", async () => {
    const { intent, issue } = await seedContext();
    const request = requestFor(intent, "activity");
    const requested = await requestWorkCaptureIntentEffect(request);
    const unsubscribe = registerCaptureIntentListener(eventBus);
    try {
      expect(await drainDomainEventOutbox()).toBeGreaterThanOrEqual(1);
      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(1);
      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
      ).toMatchObject({ state: "capturing", pendingEffectKind: null });
      expect(
        await prisma.domainEventOutbox.count({
          where: { laneKey: requested.laneKey, eventType: "work_session.started" },
        })
      ).toBe(1);
      expect(await requestWorkCaptureIntentEffect(request)).toEqual(requested);

      await prisma.domainEventOutbox.update({
        where: { deliveryKey: requested.deliveryKey },
        data: { acknowledgedAt: null, availableAt: new Date(), claimToken: null, claimedAt: null },
      });
      await drainDomainEventOutbox();
      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(1);
      expect(await prisma.workLog.count({ where: { issueId: issue.id } })).toBe(0);
      expect(
        await prisma.domainEventOutbox.count({
          where: { laneKey: requested.laneKey, eventType: "work_session.started" },
        })
      ).toBe(1);
    } finally {
      unsubscribe();
    }
  });

  it("displaces a sibling session when adopted incident activity opens its lease", async () => {
    const { intent, issue, member, project } = await seedContext({ issueType: "incident" });
    const sibling = await prisma.issue.create({
      data: {
        key: `${project.key}-2`,
        title: "Sibling task",
        type: "task",
        state: "analysis",
        projectId: project.id,
        sequenceNum: 2,
      },
    });
    const siblingSession = await prisma.workSession.create({
      data: {
        userId: member.userId,
        issueId: sibling.id,
        memberId: member.id,
        source: "codex",
        startedAt: new Date(Date.now() - 60_000),
        lastHeartbeat: new Date(Date.now() - 60_000),
      },
    });
    const requested = await requestWorkCaptureIntentEffect(requestFor(intent, "activity"));
    const unsubscribe = registerCaptureIntentListener(eventBus);

    try {
      expect(await publishDomainEventByDeliveryKey(requested.deliveryKey)).toBe(true);
      expect(await prisma.workSession.findUnique({ where: { id: siblingSession.id } })).toBeNull();
      expect(
        await prisma.workSession.findUnique({
          where: { userId_issueId: { userId: member.userId, issueId: issue.id } },
        })
      ).not.toBeNull();
      expect(
        await prisma.interruption.findFirst({
          where: {
            incidentIssueId: issue.id,
            interruptedIssueId: sibling.id,
            memberId: member.id,
            endedAt: null,
          },
        })
      ).not.toBeNull();
    } finally {
      unsubscribe();
    }
  });

  it("acknowledges a stale epoch without applying the cleared command", async () => {
    const { intent, issue } = await seedContext();
    const requested = await requestWorkCaptureIntentEffect(requestFor(intent, "activity"));
    await prisma.workCaptureIntent.update({
      where: { id: intent.id },
      data: {
        epoch: randomUUID(),
        effectRevision: { increment: 1 },
        pendingEffectKind: null,
        pendingEffectAt: null,
        pendingEffectCommandId: null,
      },
    });
    const unsubscribe = registerCaptureIntentListener(eventBus);
    try {
      await drainDomainEventOutbox();
      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
      expect(
        await prisma.domainEventOutbox.findUniqueOrThrow({
          where: { deliveryKey: requested.deliveryKey },
        })
      ).toMatchObject({ acknowledgedAt: expect.any(Date) });
    } finally {
      unsubscribe();
    }
  });

  it("concurrent recovery workers and a stale superseded revision converge once", async () => {
    const { intent, issue } = await seedContext();
    const stale = await requestWorkCaptureIntentEffect(requestFor(intent, "activity"));
    const currentIntent = await prisma.workCaptureIntent.findUniqueOrThrow({
      where: { id: intent.id },
    });
    const current = await requestWorkCaptureIntentEffect(requestFor(currentIntent, "activity"));
    const unsubscribe = registerCaptureIntentListener(eventBus);
    try {
      await Promise.all([drainDomainEventOutbox(), drainDomainEventOutbox()]);
      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(1);
      expect(
        await prisma.domainEventOutbox.findUniqueOrThrow({
          where: { deliveryKey: stale.deliveryKey },
        })
      ).toMatchObject({ acknowledgedAt: expect.any(Date) });
      expect(
        await prisma.domainEventOutbox.findUniqueOrThrow({
          where: { deliveryKey: current.deliveryKey },
        })
      ).toMatchObject({ acknowledgedAt: expect.any(Date) });
    } finally {
      unsubscribe();
    }
  });

  it("keeps transient failures pending and later converges with the original database time", async () => {
    const { intent, issue } = await seedContext();
    const requested = await requestWorkCaptureIntentEffect(requestFor(intent, "activity"));
    const queued = await prisma.domainEventOutbox.findUniqueOrThrow({
      where: { deliveryKey: requested.deliveryKey },
    });
    const observedAt = new Date((queued.payload as { observedAt: string }).observedAt);
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_capture_effect_session()
      RETURNS trigger AS $$ BEGIN RAISE EXCEPTION 'transient capture effect failure'; END;
      $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_capture_effect_session_trigger
      BEFORE INSERT ON "work_sessions"
      FOR EACH ROW EXECUTE FUNCTION reject_capture_effect_session()
    `);
    const unsubscribe = registerCaptureIntentListener(eventBus);
    try {
      await drainDomainEventOutbox();
      expect(
        await prisma.domainEventOutbox.findUniqueOrThrow({
          where: { deliveryKey: requested.deliveryKey },
        })
      ).toMatchObject({ acknowledgedAt: null, lastError: expect.any(String) });
      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER reject_capture_effect_session_trigger ON "work_sessions"'
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION reject_capture_effect_session()");
      await prisma.domainEventOutbox.update({
        where: { deliveryKey: requested.deliveryKey },
        data: { availableAt: new Date() },
      });
      await drainDomainEventOutbox();
      expect(
        await prisma.workSession.findFirstOrThrow({ where: { issueId: issue.id } })
      ).toMatchObject({ startedAt: observedAt, lastHeartbeat: observedAt });
    } finally {
      unsubscribe();
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS reject_capture_effect_session_trigger ON "work_sessions"'
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION IF EXISTS reject_capture_effect_session()");
    }
  });

  it("supersedes a failed activity when retry finds the issue inactive without a session", async () => {
    const context = await seedContext();
    const requested = await requestWorkCaptureIntentEffect(requestFor(context.intent, "activity"));
    await installApplyFailure("work_sessions");
    const unsubscribe = registerCaptureIntentListener(eventBus);

    try {
      await drainDomainEventOutbox();
      const failed = await prisma.workCaptureIntent.findUniqueOrThrow({
        where: { id: context.intent.id },
      });
      expect(failed).toMatchObject({
        failureEpisodeId: expect.any(String),
        failureCount: 1,
        failureResolution: null,
        pendingEffectKind: "activity",
        pendingEffectCommandId: requested.commandId,
      });
      expect(await prisma.workSession.count({ where: { issueId: context.issue.id } })).toBe(0);

      await removeApplyFailure("work_sessions");
      await prisma.issue.update({
        where: { id: context.issue.id },
        data: { state: "review" },
      });
      await makeDeliveryDue(requested.deliveryKey);
      await drainDomainEventOutbox();

      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: context.intent.id } })
      ).toMatchObject({
        failureEpisodeId: failed.failureEpisodeId,
        failureCount: 1,
        failureResolvedAt: expect.any(Date),
        failureResolution: "superseded",
        pendingEffectKind: null,
        pendingEffectAt: null,
        pendingEffectCommandId: null,
      });
      expect(await prisma.workSession.count({ where: { issueId: context.issue.id } })).toBe(0);
      expect(await prisma.workLog.count({ where: { issueId: context.issue.id } })).toBe(0);
      expect(
        await prisma.domainEventOutbox.findUniqueOrThrow({
          where: { deliveryKey: requested.deliveryKey },
        })
      ).toMatchObject({ acknowledgedAt: expect.any(Date), lastError: null });
    } finally {
      unsubscribe();
      await removeApplyFailure("work_sessions");
    }
  });

  it.each([
    { kind: "activity" as const, table: "work_sessions" as const, withSession: false },
    { kind: "release" as const, table: "work_logs" as const, withSession: true },
    { kind: "close" as const, table: "work_logs" as const, withSession: true },
  ])(
    "records one owner-visible $kind failure episode across retries and resolves it on success",
    async ({ kind, table, withSession }) => {
      const startedAt = new Date(Date.now() - 60_000);
      const context = await seedContext({
        state: withSession ? "capturing" : "adopted",
        withSession,
        startedAt,
      });
      const requested = await requestWorkCaptureIntentEffect(requestFor(context.intent, kind));
      const queued = await prisma.domainEventOutbox.findUniqueOrThrow({
        where: { deliveryKey: requested.deliveryKey },
      });
      const observedAt = new Date((queued.payload as { observedAt: string }).observedAt);
      await installApplyFailure(table);
      const emitSpy = vi.spyOn(eventBus, "emit");
      const unsubscribe = registerCaptureIntentListener(eventBus);

      try {
        await drainDomainEventOutbox();

        const first = (await prisma.workCaptureIntent.findUniqueOrThrow({
          where: { id: context.intent.id },
        })) as typeof context.intent & {
          failureEpisodeId: string;
          failureCommandId: string;
          failureEpoch: string;
          failureLeaseGeneration: number;
          failureEffectRevision: number;
          failureEffectKind: typeof kind;
          failureEffectAt: Date;
          failureStage: "effect_apply";
          failureCode: "WORK_CAPTURE_RETRYABLE";
          failureCount: number;
          failureFirstAt: Date;
          failureLastAt: Date;
          failureResolvedAt: Date | null;
          failureResolution: string | null;
        };
        expect(first).toMatchObject({
          failureEpisodeId: expect.any(String),
          failureCommandId: requested.commandId,
          failureEpoch: context.intent.epoch,
          failureLeaseGeneration: context.intent.leaseGeneration,
          failureEffectRevision: requested.effectRevision,
          failureEffectKind: kind,
          failureEffectAt: observedAt,
          failureStage: "effect_apply",
          failureCode: "WORK_CAPTURE_RETRYABLE",
          failureCount: 1,
          failureFirstAt: expect.any(Date),
          failureLastAt: expect.any(Date),
          failureResolvedAt: null,
          failureResolution: null,
          pendingEffectKind: kind,
          pendingEffectCommandId: requested.commandId,
          pendingEffectAt: observedAt,
        });

        const notifications = await prisma.notification.findMany({
          where: { kind: "work_capture_failure" as never },
        });
        expect(notifications).toHaveLength(1);
        expect(notifications[0]).toMatchObject({
          workspaceId: context.workspace.id,
          recipientId: context.member.id,
          actorId: null,
          issueId: context.issue.id,
          via: "codex",
          workCaptureFailureEpisodeId: first.failureEpisodeId,
          payload: {
            issueKey: context.issue.key,
            stage: "effect_apply",
            code: "WORK_CAPTURE_RETRYABLE",
            message: "Work capture was delayed. Kanon retries automatically.",
            details: { retryable: true, effectKind: kind },
          },
        });
        const createdEvents = emitSpy.mock.calls.filter(
          ([event]) => event.type === "notification.created"
        );
        expect(createdEvents).toHaveLength(1);
        expect(createdEvents[0]?.[0]).toMatchObject({
          workspaceId: context.workspace.id,
          actorId: context.member.id,
          payload: {},
        });

        const failedOutbox = await prisma.domainEventOutbox.findUniqueOrThrow({
          where: { deliveryKey: requested.deliveryKey },
        });
        expect(failedOutbox).toMatchObject({ acknowledgedAt: null, lastError: expect.any(String) });
        expect(failedOutbox.lastError).not.toContain(RAW_FAILURE_MARKER);
        expect(JSON.stringify(first)).not.toContain(RAW_FAILURE_MARKER);
        expect(JSON.stringify(notifications)).not.toContain(RAW_FAILURE_MARKER);

        await makeDeliveryDue(requested.deliveryKey);
        await drainDomainEventOutbox();
        const second = (await prisma.workCaptureIntent.findUniqueOrThrow({
          where: { id: context.intent.id },
        })) as typeof first;
        expect(second.failureEpisodeId).toBe(first.failureEpisodeId);
        expect(second.failureCount).toBe(2);
        expect(second.failureFirstAt).toEqual(first.failureFirstAt);
        expect(second.failureLastAt.getTime()).toBeGreaterThanOrEqual(
          first.failureLastAt.getTime()
        );
        expect(await prisma.notification.count({ where: { recipientId: context.member.id } })).toBe(
          1
        );
        expect(
          emitSpy.mock.calls.filter(([event]) => event.type === "notification.created")
        ).toHaveLength(1);

        await removeApplyFailure(table);
        await makeDeliveryDue(requested.deliveryKey);
        await drainDomainEventOutbox();

        const resolved = (await prisma.workCaptureIntent.findUniqueOrThrow({
          where: { id: context.intent.id },
        })) as typeof first;
        expect(resolved).toMatchObject({
          failureEpisodeId: first.failureEpisodeId,
          failureCount: 2,
          failureResolvedAt: expect.any(Date),
          failureResolution: "succeeded",
          pendingEffectKind: null,
          pendingEffectAt: null,
          pendingEffectCommandId: null,
        });
        const acknowledged = await prisma.domainEventOutbox.findUniqueOrThrow({
          where: { deliveryKey: requested.deliveryKey },
        });
        expect(acknowledged).toMatchObject({
          acknowledgedAt: expect.any(Date),
          lastError: null,
        });
        expect(jsonWithoutBigInt(acknowledged)).not.toContain(RAW_FAILURE_MARKER);

        if (kind === "activity") {
          expect(
            await prisma.workSession.findFirstOrThrow({ where: { issueId: context.issue.id } })
          ).toMatchObject({ startedAt: observedAt, lastHeartbeat: observedAt });
        } else {
          expect(
            await prisma.workLog.findFirstOrThrow({ where: { issueId: context.issue.id } })
          ).toMatchObject({ endedAt: observedAt });
          expect(resolved.state).toBe(kind === "close" ? "closed" : "adopted");
        }
      } finally {
        unsubscribe();
        emitSpy.mockRestore();
        await removeApplyFailure(table);
      }
    }
  );

  it("rolls back both halves when the first notification insert fails, then converges once", async () => {
    const context = await seedContext();
    const requested = await requestWorkCaptureIntentEffect(requestFor(context.intent, "activity"));
    await installApplyFailure("work_sessions");
    await prisma.$executeRawUnsafe(`
      CREATE OR REPLACE FUNCTION reject_capture_failure_notification()
      RETURNS trigger AS $$ BEGIN
        IF NEW.kind::text = 'work_capture_failure' THEN
          RAISE EXCEPTION 'KAN243_RAW_NOTIFICATION_INSERT_MARKER';
        END IF;
        RETURN NEW;
      END; $$ LANGUAGE plpgsql
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER reject_capture_failure_notification_trigger
      BEFORE INSERT ON "notifications"
      FOR EACH ROW EXECUTE FUNCTION reject_capture_failure_notification()
    `);
    const emitSpy = vi.spyOn(eventBus, "emit");
    const unsubscribe = registerCaptureIntentListener(eventBus);

    try {
      await drainDomainEventOutbox();
      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: context.intent.id } })
      ).toMatchObject({ failureCount: 0, failureEpisodeId: null });
      expect(await prisma.notification.count()).toBe(0);
      expect(
        emitSpy.mock.calls.filter(([event]) => event.type === "notification.created")
      ).toHaveLength(0);

      await prisma.$executeRawUnsafe(
        'DROP TRIGGER reject_capture_failure_notification_trigger ON "notifications"'
      );
      await prisma.$executeRawUnsafe("DROP FUNCTION reject_capture_failure_notification()");
      await makeDeliveryDue(requested.deliveryKey);
      await drainDomainEventOutbox();

      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: context.intent.id } })
      ).toMatchObject({ failureCount: 1, failureEpisodeId: expect.any(String) });
      expect(await prisma.notification.count()).toBe(1);
      expect(
        emitSpy.mock.calls.filter(([event]) => event.type === "notification.created")
      ).toHaveLength(1);
    } finally {
      unsubscribe();
      emitSpy.mockRestore();
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS reject_capture_failure_notification_trigger ON "notifications"'
      );
      await prisma.$executeRawUnsafe(
        "DROP FUNCTION IF EXISTS reject_capture_failure_notification()"
      );
      await removeApplyFailure("work_sessions");
    }
  });

  it("supersedes the old episode before a newer revision and leaves stale delivery harmless", async () => {
    const context = await seedContext();
    const firstRequest = await requestWorkCaptureIntentEffect(
      requestFor(context.intent, "activity")
    );
    await installApplyFailure("work_sessions");
    const unsubscribe = registerCaptureIntentListener(eventBus);

    try {
      await drainDomainEventOutbox();
      const firstFailure = await prisma.workCaptureIntent.findUniqueOrThrow({
        where: { id: context.intent.id },
      });
      expect(firstFailure).toMatchObject({
        failureEpisodeId: expect.any(String),
        failureResolution: null,
        failureCount: 1,
      });

      const secondRequest = await requestWorkCaptureIntentEffect(
        requestFor(firstFailure, "activity")
      );
      const superseded = await prisma.workCaptureIntent.findUniqueOrThrow({
        where: { id: context.intent.id },
      });
      expect(superseded).toMatchObject({
        failureEpisodeId: firstFailure.failureEpisodeId,
        failureResolution: "superseded",
        failureResolvedAt: expect.any(Date),
        pendingEffectCommandId: secondRequest.commandId,
        effectRevision: secondRequest.effectRevision,
      });

      await makeDeliveryDue(firstRequest.deliveryKey);
      expect(await publishDomainEventByDeliveryKey(firstRequest.deliveryKey)).toBe(true);
      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: context.intent.id } })
      ).toMatchObject({
        failureEpisodeId: firstFailure.failureEpisodeId,
        failureResolution: "superseded",
        pendingEffectCommandId: secondRequest.commandId,
      });

      await expect(publishDomainEventByDeliveryKey(secondRequest.deliveryKey)).rejects.toThrow(
        "event-bus subscriber delivery failed"
      );
      const laterFailure = await prisma.workCaptureIntent.findUniqueOrThrow({
        where: { id: context.intent.id },
      });
      expect(laterFailure.failureEpisodeId).not.toBe(firstFailure.failureEpisodeId);
      expect(laterFailure).toMatchObject({ failureCount: 1, failureResolution: null });
      expect(await prisma.notification.count({ where: { recipientId: context.member.id } })).toBe(
        2
      );
    } finally {
      unsubscribe();
      await removeApplyFailure("work_sessions");
    }
  });

  it.each(["pause", "rebase", "close"] as const)(
    "%s resolves an unresolved episode as superseded before clearing the pending tuple",
    async (mutation) => {
      const context = await seedContext({ state: mutation === "rebase" ? "capturing" : "adopted" });
      const requested = await requestWorkCaptureIntentEffect(
        requestFor(context.intent, "activity")
      );
      await installApplyFailure("work_sessions");
      const unsubscribe = registerCaptureIntentListener(eventBus);

      try {
        await drainDomainEventOutbox();
        expect(
          await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: context.intent.id } })
        ).toMatchObject({ failureResolution: null, failureCount: 1 });

        await prisma.$transaction(async (tx) => {
          if (mutation === "pause") {
            await pauseCaptureIntentTx(tx, {
              userId: context.member.userId,
              issueId: context.issue.id,
              memberId: context.member.id,
            });
          } else if (mutation === "rebase") {
            await rebaseCaptureIntentTx(tx, {
              userId: context.member.userId,
              issueId: context.issue.id,
            });
          } else {
            await closeCaptureIntentTx(tx, {
              userId: context.member.userId,
              issueId: context.issue.id,
              closedAt: new Date("2026-08-19T14:30:00.000Z"),
            });
          }
        });

        expect(
          await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: context.intent.id } })
        ).toMatchObject({
          failureResolution: "superseded",
          failureResolvedAt: expect.any(Date),
          pendingEffectKind: null,
          pendingEffectAt: null,
          pendingEffectCommandId: null,
        });
        expect(
          await prisma.domainEventOutbox.findUniqueOrThrow({
            where: { deliveryKey: requested.deliveryKey },
          })
        ).toMatchObject({ acknowledgedAt: null });
      } finally {
        unsubscribe();
        await removeApplyFailure("work_sessions");
      }
    }
  );

  it("applies release and close terminal states with exact lease finalization", async () => {
    const startedAt = new Date("2026-08-18T15:00:00.000Z");
    const releaseContext = await seedContext({
      state: "capturing",
      withSession: true,
      startedAt,
    });
    const closeContext = await seedContext({
      keySuffix: 2,
      state: "capturing",
      withSession: true,
      startedAt,
    });
    await requestWorkCaptureIntentEffect(requestFor(releaseContext.intent, "release"));
    const closeRequest = await requestWorkCaptureIntentEffect(
      requestFor(closeContext.intent, "close")
    );
    const closeRow = await prisma.domainEventOutbox.findUniqueOrThrow({
      where: { deliveryKey: closeRequest.deliveryKey },
    });
    const closeAt = new Date((closeRow.payload as { observedAt: string }).observedAt);
    const unsubscribe = registerCaptureIntentListener(eventBus);
    try {
      await drainDomainEventOutbox();
      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({
          where: { id: releaseContext.intent.id },
        })
      ).toMatchObject({ state: "adopted", closedAt: null, pendingEffectKind: null });
      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: closeContext.intent.id } })
      ).toMatchObject({ state: "closed", closedAt: closeAt, pendingEffectKind: null });
      expect(await prisma.workSession.count()).toBe(0);
      expect(await prisma.workLog.count()).toBe(2);
    } finally {
      unsubscribe();
    }
  });

  it("releases the lease without overwriting a pause established after the request", async () => {
    const startedAt = new Date(Date.now() - 60_000);
    const { intent, issue, member, project } = await seedContext({
      state: "capturing",
      withSession: true,
      startedAt,
    });
    const incident = await prisma.issue.create({
      data: {
        key: `${project.key}-2`,
        title: "Pause after release request",
        type: "incident",
        state: "analysis",
        projectId: project.id,
        sequenceNum: 2,
      },
    });
    await requestWorkCaptureIntentEffect(requestFor(intent, "release"));
    const interruption = await recordInterruption(incident.key, issue.key, member.id);
    const unsubscribe = registerCaptureIntentListener(eventBus);
    try {
      await drainDomainEventOutbox();
      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
      expect(
        await prisma.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })
      ).toMatchObject({
        state: "paused",
        pendingEffectKind: null,
        pendingEffectAt: null,
        pendingEffectCommandId: null,
      });
      expect(
        await prisma.interruption.findUniqueOrThrow({ where: { id: interruption.id } })
      ).toMatchObject({ endedAt: null });
    } finally {
      unsubscribe();
    }
  });

  it("enqueues lifecycle terminal effects behind the command without recursively draining its lane", async () => {
    const startedAt = new Date("2026-08-18T15:00:00.000Z");
    const { intent, issue, member, session } = await seedContext({
      state: "capturing",
      withSession: true,
      startedAt,
    });
    const lifecycle = await prisma.workTransitionLifecycle.create({
      data: {
        issueId: issue.id,
        userId: member.userId,
        memberId: member.id,
        source: "transition-listener",
        startIdentity: `effect-test:${randomUUID()}`,
        startedAt,
      },
    });
    await prisma.workSession.update({
      where: { id: session!.id },
      data: { transitionLifecycleId: lifecycle.id },
    });
    const requested = await requestWorkCaptureIntentEffect(requestFor(intent, "close"));
    const unsubscribe = registerCaptureIntentListener(eventBus);
    try {
      expect(await publishDomainEventByDeliveryKey(requested.deliveryKey)).toBe(true);
      const rows = await prisma.domainEventOutbox.findMany({
        where: { laneKey: requested.laneKey },
        orderBy: { position: "asc" },
      });
      expect(rows[0]).toMatchObject({
        deliveryKey: requested.deliveryKey,
        acknowledgedAt: expect.any(Date),
      });
      expect(rows.slice(1).map((row) => row.eventType)).toEqual([
        "worklog.created",
        "work_session.ended",
      ]);
      expect(rows.slice(1).every((row) => row.acknowledgedAt === null)).toBe(true);
    } finally {
      unsubscribe();
    }
  });

  it("orders an expired lease terminal pair before the replacement start behind its activity command", async () => {
    const startedAt = new Date(Date.now() - 10 * 60_000);
    const { intent } = await seedContext({
      state: "capturing",
      withSession: true,
      startedAt,
    });
    const requested = await requestWorkCaptureIntentEffect(requestFor(intent, "activity"));
    const unsubscribe = registerCaptureIntentListener(eventBus);
    try {
      expect(await publishDomainEventByDeliveryKey(requested.deliveryKey)).toBe(true);
      const rows = await prisma.domainEventOutbox.findMany({
        where: { laneKey: requested.laneKey },
        orderBy: { position: "asc" },
      });
      expect(rows.map((row) => row.eventType)).toEqual([
        "work_capture.intent_effect_requested",
        "worklog.created",
        "work_session.ended",
        "work_session.started",
      ]);
      expect(rows[0]?.acknowledgedAt).toEqual(expect.any(Date));
      expect(rows.slice(1).every((row) => row.acknowledgedAt === null)).toBe(true);
    } finally {
      unsubscribe();
    }
  });
});
