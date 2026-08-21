import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { drainDomainEventOutbox } from "../../services/event-bus/outbox.js";
import type {
  DomainEvent,
  WorkCaptureTransitionObservedPayload,
} from "../../services/event-bus/types.js";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestProjectMember,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { transitionIssue } from "../issue/service.js";
import { startWork } from "./service.js";

async function seedContext(state: "backlog" | "analysis" = "backlog") {
  const workspace = await seedTestWorkspace();
  const member = await seedTestMemberWithRole(workspace.id, "member");
  const project = await seedTestProject(workspace.id);
  await seedTestProjectMember(member.userId, project.id, "member");
  const issue = await prisma.issue.create({
    data: {
      key: `${project.key}-1`,
      title: "Durable transition observation",
      type: "task",
      state,
      projectId: project.id,
      sequenceNum: 1,
    },
  });
  return { workspace, member, project, issue };
}

describe("durable work-capture transition observations", () => {
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
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS "kan243_fail_transition_observation" ON "domain_event_outbox"'
    );
    await prisma.$executeRawUnsafe(
      'DROP TRIGGER IF EXISTS "kan243_fail_transition_listener" ON "work_transition_lifecycles"'
    );
    await prisma.$executeRawUnsafe(
      'DROP FUNCTION IF EXISTS "kan243_fail_transition_observation"()'
    );
    await prisma.$executeRawUnsafe('DROP FUNCTION IF EXISTS "kan243_fail_transition_listener"()');
  });

  it("rolls back the issue state when observation enqueue fails", async () => {
    const { member, issue } = await seedContext();
    await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "kan243_fail_transition_observation"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'KAN243 forced transition observation rollback';
      END;
      $$
    `);
    await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "kan243_fail_transition_observation"
      BEFORE INSERT ON "domain_event_outbox"
      FOR EACH ROW EXECUTE FUNCTION "kan243_fail_transition_observation"()
    `);

    try {
      await expect(transitionIssue(issue.key, "analysis", member.id)).rejects.toThrow(
        "KAN243 forced transition observation rollback"
      );
    } finally {
      await prisma.$executeRawUnsafe(
        'DROP TRIGGER IF EXISTS "kan243_fail_transition_observation" ON "domain_event_outbox"'
      );
      await prisma.$executeRawUnsafe(
        'DROP FUNCTION IF EXISTS "kan243_fail_transition_observation"()'
      );
    }

    expect(await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).toMatchObject({
      state: "backlog",
    });
    expect(
      await prisma.domainEventOutbox.count({
        where: { eventType: "work_capture.transition_observed" },
      })
    ).toBe(0);
  });

  it("keeps start and close ordered after listener failure and retries the original observation", async () => {
    const { member, issue } = await seedContext();
    const observed: Array<{
      deliveryKey: string | undefined;
      payload: WorkCaptureTransitionObservedPayload;
    }> = [];
    const unsubscribe = eventBus.subscribe((event: DomainEvent) => {
      if (event.type !== "work_capture.transition_observed") return;
      observed.push({
        deliveryKey: event.deliveryKey,
        payload: event.payload as WorkCaptureTransitionObservedPayload,
      });
    });
    try {
      await prisma.$executeRawUnsafe(`
      CREATE FUNCTION "kan243_fail_transition_listener"()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'KAN243 forced transition listener failure';
      END;
      $$
    `);
      await prisma.$executeRawUnsafe(`
      CREATE TRIGGER "kan243_fail_transition_listener"
      BEFORE INSERT ON "work_transition_lifecycles"
      FOR EACH ROW EXECUTE FUNCTION "kan243_fail_transition_listener"()
    `);

      try {
        await expect(transitionIssue(issue.key, "analysis", member.id)).resolves.toMatchObject({
          state: "analysis",
        });

        const startRow = await prisma.domainEventOutbox.findFirstOrThrow({
          where: {
            eventType: "work_capture.transition_observed",
            acknowledgedAt: null,
          },
        });
        expect(observed).toHaveLength(1);
        expect(observed[0]!.deliveryKey).toBe(startRow.deliveryKey);
        expect(observed[0]!.payload.observedAt).not.toBe("2099-01-01T00:00:00.000Z");
        expect(Number.isNaN(Date.parse(observed[0]!.payload.observedAt))).toBe(false);
        await prisma.domainEventOutbox.update({
          where: { id: startRow.id },
          data: { availableAt: new Date("2999-01-01T00:00:00.000Z") },
        });
      } finally {
        await prisma.$executeRawUnsafe(
          'DROP TRIGGER IF EXISTS "kan243_fail_transition_listener" ON "work_transition_lifecycles"'
        );
        await prisma.$executeRawUnsafe(
          'DROP FUNCTION IF EXISTS "kan243_fail_transition_listener"()'
        );
      }

      await new Promise((resolve) => setTimeout(resolve, 1_100));
      await expect(transitionIssue(issue.key, "review", member.id)).resolves.toMatchObject({
        state: "review",
      });

      const pending = await prisma.domainEventOutbox.findMany({
        where: {
          eventType: "work_capture.transition_observed",
          acknowledgedAt: null,
        },
        orderBy: { position: "asc" },
      });
      expect(pending).toHaveLength(2);
      expect(new Set(pending.map((row) => row.laneKey))).toEqual(
        new Set([`work-capture-transition:${issue.id}`])
      );
      expect(
        pending.map((row) => (row.payload as unknown as WorkCaptureTransitionObservedPayload).to)
      ).toEqual(["analysis", "review"]);
      expect(observed).toHaveLength(1);

      await prisma.domainEventOutbox.updateMany({
        where: { id: { in: pending.map((row) => row.id) } },
        data: { availableAt: new Date(0) },
      });
      await expect(drainDomainEventOutbox()).resolves.toBe(2);

      expect(observed.map(({ payload }) => payload.to)).toEqual(["analysis", "analysis", "review"]);
      expect(observed[1]!.deliveryKey).toBe(observed[0]!.deliveryKey);
      expect(observed[1]!.payload.observedAt).toBe(observed[0]!.payload.observedAt);
      expect(
        await prisma.workTransitionLifecycle.count({
          where: { issueId: issue.id },
        })
      ).toBe(1);
      expect(await prisma.workLog.count({ where: { issueId: issue.id } })).toBe(1);
      expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(0);
    } finally {
      unsubscribe();
    }
  });

  it("does not duplicate lifecycle capture for a start_work transition", async () => {
    const { member, issue } = await seedContext();

    await startWork(issue.key, member.id, member.userId, "codex");

    expect(await prisma.issue.findUniqueOrThrow({ where: { id: issue.id } })).toMatchObject({
      state: "in_progress",
    });
    expect(await prisma.workSession.count({ where: { issueId: issue.id } })).toBe(1);
    expect(
      await prisma.workTransitionLifecycle.count({
        where: { issueId: issue.id },
      })
    ).toBe(0);
    expect(
      await prisma.domainEventOutbox.count({
        where: { eventType: "work_capture.transition_observed" },
      })
    ).toBe(0);
  });
});
