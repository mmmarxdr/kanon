import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Mock prisma ────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    issue: { findUnique: vi.fn(), update: vi.fn() },
    workSession: {
      upsert: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    workCaptureIntent: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    workLog: {
      create: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      findMany: vi.fn(),
      deleteMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    workTransitionLifecycle: {
      create: vi.fn(),
      delete: vi.fn(),
      findFirst: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    // KAN-103: startWork closes open interruptions (resume); incident-start opens them.
    // KAN-103 PR3: findMany added for pre-close query before emit.
    interruption: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findMany: vi.fn(),
      findFirst: vi.fn(),
    },
    activityLog: { create: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

// ── Mock eventBus ──────────────────────────────────────────────────────────
vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: { emit: vi.fn(), emitAndWait: vi.fn() },
}));

vi.mock("../../services/event-bus/outbox.js", () => ({
  enqueueDomainEventTx: vi.fn(),
  publishDomainEventByDeliveryKey: vi.fn(),
  publishDomainEventLane: vi.fn(),
}));

// ── Mock activity log ──────────────────────────────────────────────────────
vi.mock("../activity/service.js", () => ({
  createActivityLog: vi.fn(),
}));

// ── Mock issue service (for Fix B: auto-transition) ────────────────────────
vi.mock("../issue/service.js", () => ({
  transitionIssue: vi.fn(),
  updateIssue: vi.fn(),
  publishStartWorkIssueMutationEffects: vi.fn(),
}));

vi.mock("../integrations/issue-tx.js", () => ({
  resolveIssueCaptureContext: vi.fn(),
  lockIssueCaptureBindingTx: vi.fn(),
  captureIssueMutationTx: vi.fn(),
}));

vi.mock("../schedule/service.js", () => ({
  upsertPlan: vi.fn(),
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import {
  enqueueDomainEventTx,
  publishDomainEventByDeliveryKey,
  publishDomainEventLane,
} from "../../services/event-bus/outbox.js";
import {
  captureTransitionClose,
  stageTransitionStart,
  startWork,
  heartbeat,
  stopWork,
  getActiveWorkers,
  cleanupExpired,
  recordInterruption,
} from "./service.js";
import {
  publishStartWorkIssueMutationEffects,
  transitionIssue,
  updateIssue,
} from "../issue/service.js";
import {
  captureIssueMutationTx,
  lockIssueCaptureBindingTx,
  resolveIssueCaptureContext,
} from "../integrations/issue-tx.js";
import { upsertPlan } from "../schedule/service.js";

const mockIssueFind = vi.mocked(prisma.issue.findUnique);
const mockIssueUpdate = vi.mocked(prisma.issue.update);
const mockSessionUpsert = vi.mocked(prisma.workSession.upsert);
const mockSessionCreate = vi.mocked(prisma.workSession.create);
const mockSessionFindUnique = vi.mocked(prisma.workSession.findUnique);
const mockSessionFindMany = vi.mocked(prisma.workSession.findMany);
const mockSessionFindFirst = vi.mocked(prisma.workSession.findFirst);
const mockSessionUpdate = vi.mocked(prisma.workSession.update);
const mockSessionUpdateMany = vi.mocked(prisma.workSession.updateMany);
const mockSessionDelete = vi.mocked(prisma.workSession.delete);
const mockSessionDeleteMany = vi.mocked(prisma.workSession.deleteMany);
const mockCaptureIntentCreate = vi.mocked(prisma.workCaptureIntent.create);
const mockCaptureIntentFindUnique = vi.mocked(prisma.workCaptureIntent.findUnique);
const mockCaptureIntentFindMany = vi.mocked(prisma.workCaptureIntent.findMany);
const mockCaptureIntentUpdate = vi.mocked(prisma.workCaptureIntent.update);
const mockCaptureIntentUpdateMany = vi.mocked(prisma.workCaptureIntent.updateMany);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockQueryRaw = vi.mocked(prisma.$queryRaw);
const mockWorkLogCreate = vi.mocked(prisma.workLog.create);
const mockWorkLogFindUnique = vi.mocked(prisma.workLog.findUnique);
const mockWorkLogFindFirst = vi.mocked(prisma.workLog.findFirst);
const mockWorkLogUpdate = vi.mocked(prisma.workLog.update);
const mockLifecycleCreate = vi.mocked(prisma.workTransitionLifecycle.create);
const mockLifecycleFindFirst = vi.mocked(prisma.workTransitionLifecycle.findFirst);
const mockLifecycleFindUnique = vi.mocked(prisma.workTransitionLifecycle.findUnique);
const mockLifecycleUpdate = vi.mocked(prisma.workTransitionLifecycle.update);
const mockLifecycleUpdateMany = vi.mocked(prisma.workTransitionLifecycle.updateMany);
const mockEmit = vi.mocked(eventBus.emit);
const mockEmitAndWait = vi.mocked(eventBus.emitAndWait);
const mockEnqueueDomainEventTx = vi.mocked(enqueueDomainEventTx);
const mockPublishDomainEventByDeliveryKey = vi.mocked(publishDomainEventByDeliveryKey);
const mockPublishDomainEventLane = vi.mocked(publishDomainEventLane);
const mockUpdateIssue = vi.mocked(updateIssue);
const mockTransitionIssueGlobal = vi.mocked(transitionIssue);
const mockPublishStartWorkIssueMutationEffects = vi.mocked(publishStartWorkIssueMutationEffects);
const mockResolveIssueCaptureContext = vi.mocked(resolveIssueCaptureContext);
const mockLockIssueCaptureBindingTx = vi.mocked(lockIssueCaptureBindingTx);
const mockCaptureIssueMutationTx = vi.mocked(captureIssueMutationTx);
const mockUpsertPlan = vi.mocked(upsertPlan);

const fakeIssue = {
  id: "issue-1",
  key: "KAN-42",
  projectId: "project-1",
  assigneeId: "existing",
  schedule: { startDate: new Date("2026-01-01T00:00:00.000Z") },
  // state: "in_progress" so pre-existing startWork tests deterministically
  // do NOT trigger the auto-transition guard (Fix B test hygiene).
  state: "in_progress",
  project: { workspaceId: "ws-1", key: "KAN" },
} as any;

const fakeSession = {
  id: "session-1",
  userId: "user-1",
  issueId: "issue-1",
  memberId: "member-1",
  source: "mcp",
  startedAt: new Date(),
  lastHeartbeat: new Date(),
} as any;

function mockLockedIssue(
  state: string,
  assigneeId: string | null = "existing",
  owner: { username: string } | null = null
) {
  mockQueryRaw.mockImplementation(async (query: any) => {
    const sql = Array.isArray(query) ? query.join(" ") : String(query);
    if (sql.includes("pg_advisory_xact_lock")) return [] as any;
    if (sql.includes("clock_timestamp()")) return [{ now: new Date() }] as any;
    if (sql.includes('SELECT "state"')) {
      return [{ state, assigneeId }] as any;
    }
    return owner ? ([owner] as any) : ([] as any);
  });
}

const mockInterruptionFindManyGlobal = vi.mocked(prisma.interruption.findMany);
const mockInterruptionUpdateManyGlobal = vi.mocked(prisma.interruption.updateMany);
const mockInterruptionCreateGlobal = vi.mocked(prisma.interruption.create);
const mockInterruptionFindFirstGlobal = vi.mocked(prisma.interruption.findFirst);

describe("WorkSessionService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // KAN-103 PR3: safe default — no open interruptions unless a test explicitly overrides.
    mockInterruptionFindManyGlobal.mockResolvedValue([]);
    mockInterruptionUpdateManyGlobal.mockResolvedValue({ count: 0 } as any);
    mockInterruptionFindFirstGlobal.mockResolvedValue(null as any);
    // KAN-160: default — no other active worker on the issue unless a test sets one.
    mockSessionFindFirst.mockResolvedValue(null as any);
    mockSessionFindMany.mockResolvedValue([] as any);
    mockSessionUpdateMany.mockResolvedValue({ count: 1 } as any);
    mockSessionDeleteMany.mockResolvedValue({ count: 1 } as any);
    mockSessionCreate.mockResolvedValue(fakeSession);
    mockCaptureIntentFindUnique.mockResolvedValue(null as any);
    mockCaptureIntentFindMany.mockResolvedValue([] as any);
    mockCaptureIntentCreate.mockResolvedValue({
      id: "intent-1",
      epoch: "epoch-1",
      state: "capturing",
      leaseGeneration: 1,
      userId: "user-1",
      issueId: "issue-1",
      memberId: "member-1",
      source: "mcp",
      closedAt: null,
    } as any);
    mockCaptureIntentUpdate.mockResolvedValue({
      id: "intent-1",
      epoch: "epoch-1",
      state: "capturing",
      leaseGeneration: 1,
    } as any);
    mockCaptureIntentUpdateMany.mockResolvedValue({ count: 1 } as any);
    mockWorkLogCreate.mockResolvedValue({ id: "wl-default" } as any);
    mockWorkLogFindUnique.mockResolvedValue(null as any);
    mockWorkLogFindFirst.mockResolvedValue(null as any);
    mockLifecycleFindFirst.mockResolvedValue(null as any);
    mockLifecycleFindUnique.mockResolvedValue(null as any);
    mockLifecycleUpdateMany.mockResolvedValue({ count: 1 } as any);
    mockEmitAndWait.mockResolvedValue(undefined);
    mockEnqueueDomainEventTx.mockImplementation(async (_tx, input) => ({
      id: "outbox-row",
      deliveryKey: input.deliveryKey,
    }));
    mockPublishDomainEventByDeliveryKey.mockResolvedValue(true);
    mockPublishDomainEventLane.mockResolvedValue(0);
    mockLockedIssue("in_progress");
    mockTransaction.mockImplementation(async (operation: any) => {
      if (typeof operation === "function") return operation(prisma);
      return Promise.all(operation);
    });
    mockUpdateIssue.mockResolvedValue({} as any);
    mockIssueUpdate.mockResolvedValue(fakeIssue as any);
    mockPublishStartWorkIssueMutationEffects.mockResolvedValue(undefined);
    mockResolveIssueCaptureContext.mockResolvedValue(null);
    mockLockIssueCaptureBindingTx.mockResolvedValue(undefined);
    mockCaptureIssueMutationTx.mockImplementation(async (_tx, mutation) => mutation.result);
    mockUpsertPlan.mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── startWork ──────────────────────────────────────────────────────────

  describe("startWork", () => {
    it("does not auto-assign or transition when the issue-locked ownership check loses", async () => {
      mockIssueFind.mockResolvedValue({
        ...fakeIssue,
        assigneeId: null,
        state: "backlog",
      });
      // The advisory read races and sees no owner; the issue-locked transaction
      // is authoritative and sees the winner before any caller-visible mutation.
      mockSessionFindFirst.mockResolvedValue(null as any);
      mockQueryRaw.mockImplementation(async (query: any) => {
        const sql = Array.isArray(query) ? query.join(" ") : String(query);
        if (sql.includes("pg_advisory_xact_lock")) return [] as any;
        if (sql.includes('SELECT "state"')) {
          return [{ state: "backlog", assigneeId: null }] as any;
        }
        return [{ username: "winner" }] as any;
      });

      await expect(startWork("KAN-42", "member-loser", "user-loser", "mcp")).rejects.toMatchObject({
        statusCode: 409,
        code: "ISSUE_BUSY",
      });

      expect(mockUpdateIssue).not.toHaveBeenCalled();
      expect(mockTransitionIssueGlobal).not.toHaveBeenCalled();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it("writes issue side effects and the session through the same reservation transaction", async () => {
      const backlogIssue = {
        ...fakeIssue,
        assigneeId: null,
        state: "backlog",
      };
      const advancedIssue = {
        ...backlogIssue,
        assigneeId: "member-1",
        state: "in_progress",
      };
      mockIssueFind.mockResolvedValue(backlogIssue);
      mockIssueUpdate.mockResolvedValue(advancedIssue as any);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      const transactionQueryRaw = vi.fn(async (query: any) => {
        const sql = Array.isArray(query) ? query.join(" ") : String(query);
        if (sql.includes("pg_advisory_xact_lock")) return [] as any;
        if (sql.includes('SELECT "state"')) {
          return [{ state: "backlog", assigneeId: null }] as any;
        }
        return [] as any;
      });
      mockTransaction.mockImplementation(async (operation: any) =>
        operation({ ...prisma, $queryRaw: transactionQueryRaw })
      );

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.session).toEqual(fakeSession);
      expect(mockIssueUpdate).toHaveBeenCalledWith({
        where: { id: "issue-1" },
        data: {
          assigneeId: "member-1",
          state: "in_progress",
          completedAt: null,
        },
      });
      expect(mockSessionUpsert).toHaveBeenCalledOnce();
      expect(mockUpdateIssue).not.toHaveBeenCalled();
      expect(mockTransitionIssueGlobal).not.toHaveBeenCalled();
      const advisoryQuery = transactionQueryRaw.mock.calls
        .map(([query]) => (Array.isArray(query) ? query.join(" ") : String(query)))
        .find((sql) => sql.includes("pg_advisory_xact_lock"));
      expect(advisoryQuery).toContain('SELECT 1::integer AS "locked"');
      expect(advisoryQuery).toContain("FROM pg_advisory_xact_lock");
      expect(mockQueryRaw).not.toHaveBeenCalled();
    });

    it("creates a session and returns no warnings when no conflicts", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]); // no other sessions
      mockIssueUpdate.mockResolvedValue({} as any);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.session).toEqual(fakeSession);
      expect(result.warnings).toHaveLength(0);
      expect(mockSessionUpsert).toHaveBeenCalledOnce();
    });

    it("retries a Prisma raw-query P2010 carrying PostgreSQL serialization SQLSTATE 40001", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      const serializationFailure = Object.assign(new Error("Raw query failed"), {
        code: "P2010",
        meta: {
          code: "40001",
          message:
            "ERROR: could not serialize access due to read/write dependencies among transactions",
        },
      });
      mockTransaction
        .mockRejectedValueOnce(serializationFailure)
        .mockImplementationOnce(async (operation: any) => operation(prisma));

      const result = await startWork("KAN-42", "member-1", "user-1", "transition-listener");

      expect(result.session).toEqual(fakeSession);
      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });

    it("does not retry an arbitrary Prisma raw-query P2010", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      const rawQueryFailure = Object.assign(new Error("Raw query failed"), {
        code: "P2010",
        meta: { code: "23505", message: "duplicate key value violates unique constraint" },
      });
      mockTransaction.mockRejectedValueOnce(rawQueryFailure);

      await expect(startWork("KAN-42", "member-1", "user-1", "transition-listener")).rejects.toBe(
        rawQueryFailure
      );
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it("upserts when user already has a session on the issue", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);
      mockIssueUpdate.mockResolvedValue({} as any);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      // Verify upsert was called with both create and update clauses
      expect(mockSessionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId_issueId: { userId: "user-1", issueId: "issue-1" } },
          create: expect.objectContaining({ userId: "user-1", issueId: "issue-1" }),
          update: expect.objectContaining({ source: "mcp" }),
        })
      );
    });

    it("adopts a fresh session without changing its id or startedAt", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:04:00.000Z"));
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const existing = {
        ...fakeSession,
        id: "session-existing",
        startedAt,
        lastHeartbeat: new Date("2026-08-11T12:03:00.000Z"),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(existing);
      mockSessionUpsert.mockResolvedValue({
        ...existing,
        lastHeartbeat: new Date("2026-08-11T12:04:00.000Z"),
      });

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.session.id).toBe("session-existing");
      expect(result.session.startedAt).toEqual(startedAt);
      const update = mockSessionUpsert.mock.calls[0]![0].update;
      expect(update).not.toHaveProperty("startedAt");
      expect(update).toMatchObject({
        lastHeartbeat: new Date("2026-08-11T12:04:00.000Z"),
        source: "mcp",
      });
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it("does not backdate or refresh a later same-user generation without a close boundary", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const transitionAt = new Date("2026-08-11T12:00:00.000Z");
      const existing = {
        ...fakeSession,
        startedAt: new Date("2026-08-11T12:08:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:09:00.000Z"),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(existing);

      const result = await startWork(
        "KAN-42",
        "member-1",
        "user-1",
        "transition-listener",
        null,
        undefined,
        {
          autoAssign: false,
          onConflict: "skip",
          transitionObservedAt: transitionAt,
        }
      );

      expect(result.session).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockSessionUpdateMany).not.toHaveBeenCalled();
      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
    });

    it("rejects a delayed transition start when a foreign lease owned the event boundary", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const transitionAt = new Date("2026-08-11T12:04:00.000Z");
      mockIssueFind.mockResolvedValue(fakeIssue);
      // The processing-time advisory lookup no longer sees worker A, whose
      // 12:03 heartbeat expired at 12:08.
      mockSessionFindFirst.mockResolvedValue(null as any);
      mockLockedIssue("in_progress", "existing", { username: "alice" });

      const result = await startWork(
        "KAN-42",
        "member-b",
        "user-b",
        "transition-listener",
        null,
        undefined,
        {
          autoAssign: false,
          onConflict: "skip",
          transitionObservedAt: transitionAt,
        }
      );

      expect(result.session).toBeNull();
      expect(mockQueryRaw).toHaveBeenCalledTimes(3);
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
    });

    it("rejects a delayed open when foreign live or finalized evidence begins after the event boundary", async () => {
      vi.useFakeTimers();
      const processingAt = new Date("2026-08-11T12:10:00.000Z");
      vi.setSystemTime(processingAt);
      const transitionAt = new Date("2026-08-11T12:00:00.000Z");
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindFirst.mockResolvedValue(null as any);
      mockLockedIssue("in_progress", "existing", {
        username: "later-owner",
      });

      const result = await startWork(
        "KAN-42",
        "member-a",
        "user-a",
        "transition-listener",
        null,
        undefined,
        {
          autoAssign: false,
          onConflict: "skip",
          transitionObservedAt: transitionAt,
        }
      );

      expect(result.session).toBeNull();
      const ownerQuery = mockQueryRaw.mock.calls[2]!;
      expect(ownerQuery[0].join(" ")).toContain('FROM "work_sessions"');
      expect(ownerQuery[0].join(" ")).toContain('FROM "work_logs"');
      expect((ownerQuery[3] as any).strings.join(" ")).toContain("<");
      expect((ownerQuery[3] as any).values).toEqual([processingAt]);
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
    });

    it("finalizes an expired lease once before opening a distinct window", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const stale = {
        ...fakeSession,
        id: "session-stale",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:00:00.000Z"),
      };
      const reopened = {
        ...fakeSession,
        id: "session-new-window",
        startedAt: new Date("2026-08-11T12:10:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:10:00.000Z"),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(stale);
      mockSessionDeleteMany.mockResolvedValue({ count: 1 } as any);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-stale", durationS: 300 } as any);
      mockSessionCreate.mockResolvedValue(reopened);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt: new Date("2026-08-11T12:00:00.000Z"),
          endedAt: new Date("2026-08-11T12:05:00.000Z"),
          durationS: 300,
          reason: "expired",
        }),
      });
      expect(result.session.id).toBe("session-new-window");
      expect(result.session.startedAt).toEqual(new Date("2026-08-11T12:10:00.000Z"));
    });

    it("rolls back stale finalization when replacement creation fails", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const stale = {
        ...fakeSession,
        id: "session-stale",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:00:00.000Z"),
      };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ state: "in_progress", assigneeId: "existing" }]),
        workCaptureIntent: prisma.workCaptureIntent,
        workSession: {
          findUnique: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(null),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockRejectedValue(new Error("replacement failed")),
          updateMany: vi.fn(),
        },
        workLog: {
          create: vi.fn().mockResolvedValue({ id: "wl-stale", durationS: 300 }),
        },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(stale);
      mockTransaction.mockImplementation(async (operation: any) => {
        expect(typeof operation).toBe("function");
        return operation(tx);
      });

      await expect(startWork("KAN-42", "member-1", "user-1", "mcp")).rejects.toThrow(
        "replacement failed"
      );

      expect(tx.workSession.deleteMany).toHaveBeenCalledWith({
        where: { id: "session-stale", lastHeartbeat: stale.lastHeartbeat },
      });
      expect(tx.workLog.create).toHaveBeenCalledOnce();
      expect(tx.workSession.create).toHaveBeenCalledOnce();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("adopts a newer generation when stale rollover loses its compare-and-swap", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const stale = {
        ...fakeSession,
        id: "session-stale",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:00:00.000Z"),
      };
      const newer = {
        ...fakeSession,
        id: "session-newer",
        startedAt: new Date("2026-08-11T12:09:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:09:30.000Z"),
      };
      const adopted = {
        ...newer,
        lastHeartbeat: new Date("2026-08-11T12:10:00.000Z"),
      };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ state: "in_progress", assigneeId: "existing" }]),
        workCaptureIntent: prisma.workCaptureIntent,
        workSession: {
          findUnique: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(newer),
          deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
          create: vi.fn(),
          upsert: vi.fn().mockResolvedValue(adopted),
        },
        workLog: { create: vi.fn() },
        interruption: { findMany: vi.fn().mockResolvedValue([]), updateMany: vi.fn() },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(stale);
      mockTransaction.mockImplementation(async (operation: any) => {
        expect(typeof operation).toBe("function");
        return operation(tx);
      });

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.session).toMatchObject({
        id: "session-newer",
        startedAt: newer.startedAt,
        lastHeartbeat: adopted.lastHeartbeat,
      });
      expect(tx.workSession.deleteMany).toHaveBeenCalledOnce();
      expect(tx.workSession.upsert).toHaveBeenCalledOnce();
      expect(tx.workLog.create).not.toHaveBeenCalled();
      expect(tx.workSession.create).not.toHaveBeenCalled();
    });

    it("rejects a closed incident start without displacing work or opening an interruption", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const closedIncident = {
        ...fakeIssue,
        id: "incident-closed",
        key: "KAN-99",
        type: "incident",
        state: "review",
      };
      const displaced = {
        ...fakeSession,
        id: "session-task-active",
        issueId: "task-active",
        startedAt: new Date("2026-08-11T12:09:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:10:00.000Z"),
        issue: { key: "KAN-42" },
      };
      mockIssueFind.mockResolvedValue(closedIncident);
      mockQueryRaw.mockResolvedValue([{ state: "review" }] as any);
      mockSessionFindMany.mockResolvedValue([displaced] as any);
      mockInterruptionCreateGlobal.mockResolvedValue({
        id: "interruption-orphan",
        incidentIssueId: "incident-closed",
        interruptedIssueId: "task-active",
        memberId: "member-1",
      } as any);

      const result = await startWork("KAN-99", "member-1", "user-1", "mcp");

      expect(result.session).toBeNull();
      expect(mockSessionFindMany).not.toHaveBeenCalled();
      expect(mockSessionDelete).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockInterruptionCreateGlobal).not.toHaveBeenCalled();
    });

    // ── KAN-160: single active worker per ticket ──────────────────────────
    it("KAN-160: throws 409 ISSUE_BUSY when another member has an open session", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindFirst.mockResolvedValue({ member: { username: "alice" } } as any);

      await expect(startWork("KAN-42", "member-1", "user-1", "mcp")).rejects.toMatchObject({
        statusCode: 409,
        code: "ISSUE_BUSY",
      });
      // Refused before any mutation — no session opened.
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("KAN-160: error names the current worker", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindFirst.mockResolvedValue({ member: { username: "alice" } } as any);

      await expect(startWork("KAN-42", "member-1", "user-1", "mcp")).rejects.toThrow(/alice/);
    });

    it("KAN-160: caller's own session is not a conflict (findFirst excludes caller, start proceeds)", async () => {
      mockIssueFind.mockResolvedValue({ ...fakeIssue, assigneeId: "existing" });
      // findFirst is scoped to userId != caller, so the caller's own session never matches.
      mockSessionFindFirst.mockResolvedValue(null as any);
      mockSessionUpsert.mockResolvedValue(fakeSession);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.session).toEqual(fakeSession);
      expect(mockSessionUpsert).toHaveBeenCalledOnce();
    });

    it("KAN-160: transition-driven open no-ops (onConflict:skip) when another member works the issue", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindFirst.mockResolvedValue({ member: { username: "alice" } } as any);

      const result = await startWork(
        "KAN-42",
        "member-1",
        "user-1",
        "transition-listener",
        null,
        undefined,
        { autoAssign: false, onConflict: "skip" }
      );

      // No throw, no second session opened.
      expect(result.session).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("auto-assigns unassigned issue to the caller", async () => {
      const unassignedIssue = { ...fakeIssue, assigneeId: null };
      mockIssueFind.mockResolvedValue(unassignedIssue);
      mockLockedIssue("in_progress", null);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.autoAssigned).toBe(true);
      expect(mockIssueUpdate).toHaveBeenCalledWith({
        where: { id: "issue-1" },
        data: { assigneeId: "member-1" },
      });
    });

    it("does not auto-assign when issue already has assignee", async () => {
      const assignedIssue = { ...fakeIssue, assigneeId: "someone-else" };
      mockIssueFind.mockResolvedValue(assignedIssue);
      mockLockedIssue("in_progress", "someone-else");
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.autoAssigned).toBe(false);
      expect(mockIssueUpdate).not.toHaveBeenCalled();
    });

    it("sets the current start date when work begins without a plan", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-03T12:34:56.000Z"));
      mockIssueFind.mockResolvedValue({ ...fakeIssue, schedule: null });
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockUpsertPlan).toHaveBeenCalledWith(
        "KAN-42",
        { startDate: "2026-08-03T12:34:56.000Z" },
        "member-1",
        null,
        { startDateIfMissing: true }
      );
      vi.useRealTimers();
    });

    it("atomically enqueues and publishes work_session.started", async () => {
      mockIssueFind.mockResolvedValue({ ...fakeIssue, assigneeId: "existing" });
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockEnqueueDomainEventTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          deliveryKey: "work-session.started:v1:session-1",
          event: expect.objectContaining({
            type: "work_session.started",
            workspaceId: "ws-1",
            actorId: "member-1",
          }),
        })
      );
      expect(mockPublishDomainEventByDeliveryKey).toHaveBeenCalledWith(
        "work-session.started:v1:session-1"
      );
      expect(mockEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "work_session.started" })
      );
    });

    it("places a transition-driven start in the shared work-session lane", async () => {
      const transitionSession = {
        ...fakeSession,
        id: "session-transition-start",
        transitionLifecycleId: "lifecycle-start",
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique.mockResolvedValue({
        id: "lifecycle-start",
        closeIdentity: null,
        workLogId: null,
      } as any);
      mockSessionUpsert.mockResolvedValue(transitionSession);

      await startWork("KAN-42", "member-1", "user-1", "transition-listener", null, undefined, {
        autoAssign: false,
        transitionLifecycleIdentity: "start-identity",
      });

      expect(mockEnqueueDomainEventTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          deliveryKey: "work-session.started:v1:session-transition-start",
          laneKey: "work-session:issue-1:user-1",
        })
      );
    });

    it("throws 404 when issue not found", async () => {
      mockIssueFind.mockResolvedValue(null);

      await expect(startWork("NOPE-1", "m-1", "u-1")).rejects.toThrow("not found");
    });

    // ── Fix 2: startWork stores request.via as session source ──────────────
    // When via is provided (e.g. 'claude-code'), startWork must pass it as the
    // session source so that cleanupExpired can carry it to WorkLog.via.

    it("stores via as session source when via is provided", async () => {
      mockIssueFind.mockResolvedValue({ ...fakeIssue, assigneeId: "existing" });
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "claude-code");

      expect(mockSessionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          create: expect.objectContaining({ source: "claude-code" }),
          update: expect.objectContaining({ source: "claude-code" }),
        })
      );
    });
  });

  // ── heartbeat ──────────────────────────────────────────────────────────

  describe("heartbeat", () => {
    it("adopts a missing active session with authenticated identity and provenance", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-14T14:00:00.000Z"));
      const adopted = {
        ...fakeSession,
        id: "session-adopted",
        source: "claude-code",
        startedAt: new Date("2026-08-14T14:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-14T14:00:00.000Z"),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(null);
      mockSessionUpsert.mockResolvedValue(adopted);

      const result = await heartbeat("KAN-42", "member-1", "user-1", "claude-code");

      expect(result).toEqual(adopted);
      expect(mockSessionUpsert).toHaveBeenCalledWith({
        where: { userId_issueId: { userId: "user-1", issueId: "issue-1" } },
        create: expect.objectContaining({
          memberId: "member-1",
          userId: "user-1",
          issueId: "issue-1",
          source: "claude-code",
          startedAt: new Date("2026-08-14T14:00:00.000Z"),
          lastHeartbeat: new Date("2026-08-14T14:00:00.000Z"),
        }),
        update: expect.objectContaining({
          lastHeartbeat: new Date("2026-08-14T14:00:00.000Z"),
        }),
      });
    });

    it("keeps one durable start row pending when first adoption delivery fails", async () => {
      const adopted = { ...fakeSession, id: "session-adopted" };
      let transactionCommitted = false;
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(null);
      mockSessionUpsert.mockResolvedValue(adopted);
      mockTransaction.mockImplementation(async (operation: any) => {
        const result = await operation(prisma);
        transactionCommitted = true;
        return result;
      });
      mockPublishDomainEventByDeliveryKey.mockImplementation(async () => {
        expect(transactionCommitted).toBe(true);
        throw new Error("started subscriber unavailable");
      });

      await expect(heartbeat("KAN-42", "member-1", "user-1", "claude-code")).rejects.toThrow(
        "started subscriber unavailable"
      );

      expect(mockEnqueueDomainEventTx).toHaveBeenCalledOnce();
      expect(mockEnqueueDomainEventTx).toHaveBeenCalledWith(prisma, {
        deliveryKey: "work-session.started:v1:session-adopted",
        laneKey: "work-session:issue-1:user-1",
        event: {
          type: "work_session.started",
          workspaceId: "ws-1",
          actorId: "member-1",
          payload: {
            issueKey: "KAN-42",
            issueId: "issue-1",
            memberId: "member-1",
            userId: "user-1",
            source: "mcp",
            autoAssigned: false,
          },
        },
      });
      expect(mockPublishDomainEventByDeliveryKey).toHaveBeenCalledWith(
        "work-session.started:v1:session-adopted"
      );
    });

    it("retries an existing session with the same pending key and no new semantic row", async () => {
      const existing = { ...fakeSession, id: "session-existing" };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(existing);
      mockSessionUpsert.mockResolvedValue(existing);

      await heartbeat("KAN-42", "member-1", "user-1", "codex");
      await heartbeat("KAN-42", "member-1", "user-1", "codex");

      expect(mockEnqueueDomainEventTx).toHaveBeenCalledTimes(2);
      expect(mockEnqueueDomainEventTx.mock.calls.map(([, event]) => event.deliveryKey)).toEqual([
        "work-session.started:v1:session-existing",
        "work-session.started:v1:session-existing",
      ]);
      expect(mockPublishDomainEventByDeliveryKey).toHaveBeenCalledTimes(2);
      expect(mockPublishDomainEventByDeliveryKey).toHaveBeenNthCalledWith(
        1,
        "work-session.started:v1:session-existing"
      );
      expect(mockPublishDomainEventByDeliveryKey).toHaveBeenNthCalledWith(
        2,
        "work-session.started:v1:session-existing"
      );
    });

    it("does not adopt a missing session when the locked issue is not active", async () => {
      mockIssueFind.mockResolvedValue({ ...fakeIssue, state: "review" });
      mockLockedIssue("review");
      mockSessionFindUnique.mockResolvedValue(null);

      const result = await heartbeat("KAN-42", "member-1", "user-1", "codex");

      expect(result).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
      expect(mockEmitAndWait).not.toHaveBeenCalled();
    });

    it("suppresses adoption when a foreign owner starts inside the issue-lock boundary", async () => {
      vi.useFakeTimers();
      const heartbeatAt = new Date("2026-08-14T14:00:00.000Z");
      const foreignStartedAt = new Date("2026-08-14T14:00:00.500Z");
      const issueLockedAt = new Date("2026-08-14T14:00:01.000Z");
      vi.setSystemTime(heartbeatAt);
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(null);
      mockSessionUpsert.mockResolvedValue({ ...fakeSession, id: "wrong-adoption" });
      mockQueryRaw.mockImplementation(async (query: any, ...values: any[]) => {
        const sql = Array.isArray(query) ? query.join(" ") : String(query);
        if (sql.includes('SELECT "state"')) {
          vi.setSystemTime(issueLockedAt);
          return [{ state: "in_progress", assigneeId: "existing" }] as any;
        }
        const intervalEnd = values
          .flatMap((value) => (Array.isArray(value?.values) ? value.values : [value]))
          .find((value) => value instanceof Date && value.getTime() === issueLockedAt.getTime());
        return intervalEnd && foreignStartedAt < intervalEnd
          ? ([{ username: "other-worker" }] as any)
          : ([] as any);
      });

      const result = await heartbeat("KAN-42", "member-1", "user-1", "codex");

      expect(result).toBeNull();
      expect(mockQueryRaw).toHaveBeenCalledTimes(2);
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockEmitAndWait).not.toHaveBeenCalled();
    });

    it("returns CAPTURE_PAUSED without refreshing an interrupted member session", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(fakeSession);
      mockInterruptionFindFirstGlobal.mockResolvedValue({
        id: "interruption-open",
      } as any);
      mockSessionUpsert.mockResolvedValue({ ...fakeSession });

      await expect(heartbeat("KAN-42", "member-1", "user-1", "codex")).rejects.toMatchObject({
        statusCode: 409,
        code: "CAPTURE_PAUSED",
      });
      expect(mockInterruptionFindFirstGlobal).toHaveBeenCalledWith({
        where: {
          interruptedIssueId: "issue-1",
          memberId: "member-1",
          endedAt: null,
        },
        select: { id: true },
      });
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
      expect(mockEmitAndWait).not.toHaveBeenCalled();
    });

    it("does not let another member's interruption block adoption", async () => {
      const adopted = { ...fakeSession, id: "session-adopted" };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(null);
      mockInterruptionFindFirstGlobal.mockImplementation(async (query: any) =>
        query.where.memberId === "other-member"
          ? ({ id: "other-member-interruption" } as any)
          : null
      );
      mockSessionUpsert.mockResolvedValue(adopted);

      const result = await heartbeat("KAN-42", "member-1", "user-1", "codex");

      expect(result).toEqual(adopted);
      expect(mockInterruptionFindFirstGlobal).toHaveBeenCalledWith({
        where: {
          interruptedIssueId: "issue-1",
          memberId: "member-1",
          endedAt: null,
        },
        select: { id: true },
      });
    });

    it("does not adopt a missing incident or create displacement effects", async () => {
      mockIssueFind.mockResolvedValue({
        ...fakeIssue,
        id: "incident-1",
        key: "INC-1",
        type: "incident",
      });
      mockSessionFindUnique.mockResolvedValue(null);

      const result = await heartbeat("INC-1", "member-1", "user-1", "codex");

      expect(result).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
      expect(mockSessionFindMany).not.toHaveBeenCalled();
      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
      expect(mockInterruptionCreateGlobal).not.toHaveBeenCalled();
      expect(mockEmitAndWait).not.toHaveBeenCalled();
    });

    it("never lets an incident heartbeat create displacement side effects", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:05:00.000Z"));
      const incidentSession = {
        ...fakeSession,
        id: "incident-session",
        issueId: "incident-1",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:04:00.000Z"),
      };
      const refreshed = {
        ...incidentSession,
        lastHeartbeat: new Date("2026-08-11T12:05:00.000Z"),
      };
      mockIssueFind.mockResolvedValue({
        ...fakeIssue,
        id: "incident-1",
        key: "INC-1",
        type: "incident",
      });
      mockSessionFindUnique.mockResolvedValue(incidentSession);
      mockSessionUpsert.mockResolvedValue(refreshed);
      mockSessionFindMany.mockResolvedValue([
        {
          ...fakeSession,
          id: "sibling-session",
          issueId: "task-1",
          startedAt: new Date("2026-08-11T12:00:00.000Z"),
          lastHeartbeat: new Date("2026-08-11T12:04:00.000Z"),
          issue: { key: "KAN-1", type: "task" },
        },
      ] as any);

      const result = await heartbeat("INC-1", "member-1", "user-1", "codex");

      expect(result).toEqual(refreshed);
      expect(mockSessionFindMany).not.toHaveBeenCalled();
      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockInterruptionCreateGlobal).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
      expect(mockEmitAndWait).not.toHaveBeenCalled();
    });

    it("does not renew durable historical transition evidence", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue({
        ...fakeSession,
        id: "historical-session",
        source: "historical-transition:transition-listener",
        startedAt,
        lastHeartbeat: startedAt,
      });

      const result = await heartbeat("KAN-42", "member-1", "user-1", "codex");

      expect(result).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
    });

    it("does not recreate a session from retry identity after an explicit stop wins", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const stale = {
        ...fakeSession,
        id: "session-stopped-during-retry",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:00:00.000Z"),
      };
      const replacement = {
        ...stale,
        id: "session-invalid-resurrection",
        startedAt: new Date("2026-08-11T12:10:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:10:00.000Z"),
      };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ state: "in_progress" }]),
        workCaptureIntent: prisma.workCaptureIntent,
        workSession: {
          findUnique: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(null),
          deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
          create: vi.fn(),
          upsert: vi.fn().mockResolvedValue(replacement),
        },
        workLog: { create: vi.fn() },
        interruption: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn(),
          updateMany: vi.fn(),
        },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockTransaction.mockImplementation(async (operation: any) => operation(tx));

      const result = await heartbeat("KAN-42", "member-1", "user-1", "codex");

      expect(result).toBeNull();
      expect(tx.workSession.upsert).not.toHaveBeenCalled();
      expect(tx.workSession.create).not.toHaveBeenCalled();
    });
    it("does not replace the session a close already snapshotted when the issue is now review", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const stale = {
        ...fakeSession,
        id: "session-close-snapshot",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:00:00.000Z"),
      };
      const replacement = {
        ...stale,
        id: "session-heartbeat-replacement",
        startedAt: new Date("2026-08-11T12:10:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:10:00.000Z"),
      };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ state: "review" }]),
        workSession: {
          findUnique: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(null),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue(replacement),
          upsert: vi.fn(),
        },
        workLog: {
          create: vi.fn().mockResolvedValue({ id: "wl-close-race", durationS: 300 }),
        },
        interruption: { findMany: vi.fn(), updateMany: vi.fn() },
        workCaptureIntent: prisma.workCaptureIntent,
      };
      mockIssueFind
        .mockResolvedValueOnce(fakeIssue)
        .mockResolvedValueOnce({ ...fakeIssue, state: "review" });
      mockSessionFindUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (operation: any) => operation(tx));

      // The close handler has already snapshotted session A. Its identity-aware
      // stop will no-op after heartbeat claims A, so heartbeat must not leave B.
      const heartbeatResult = await heartbeat("KAN-42", "member-1", "user-1", "codex");
      const closeResult = await stopWork(
        "KAN-42",
        "user-1",
        "member-1",
        null,
        new Date("2026-08-11T12:09:00.000Z"),
        stale.id
      );

      expect(heartbeatResult).toBeNull();
      expect(closeResult.deleted).toBe(false);
      expect(tx.workSession.deleteMany).toHaveBeenCalledWith({
        where: { id: stale.id, lastHeartbeat: stale.lastHeartbeat },
      });
      expect(tx.workLog.create).toHaveBeenCalledOnce();
      expect(tx.workSession.create).not.toHaveBeenCalled();
    });

    it("does not reuse stale fallback identity after a retry observes review and no session", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const stale = {
        ...fakeSession,
        id: "session-stale-retry",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:00:00.000Z"),
      };
      const replacement = {
        ...fakeSession,
        id: "session-invalid-fallback",
        startedAt: new Date("2026-08-11T12:10:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:10:00.000Z"),
      };
      let stateRead = 0;
      const tx = {
        $queryRaw: vi.fn().mockImplementation(async (query: any) => {
          const sql = Array.isArray(query) ? query.join(" ") : String(query);
          if (sql.includes('SELECT "state"')) {
            return [{ state: stateRead++ === 0 ? "in_progress" : "review" }];
          }
          return [];
        }),
        workCaptureIntent: prisma.workCaptureIntent,
        workSession: {
          findUnique: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(null),
          deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
          create: vi.fn(),
          upsert: vi.fn().mockResolvedValue(replacement),
        },
        workLog: { create: vi.fn() },
        interruption: {
          findFirst: vi.fn().mockResolvedValue(null),
          findMany: vi.fn(),
          updateMany: vi.fn(),
        },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockTransaction.mockImplementation(async (operation: any) => operation(tx));

      const result = await heartbeat("KAN-42", "member-1", "user-1", "codex");

      expect(result).toBeNull();
      expect(tx.workSession.deleteMany).toHaveBeenCalledOnce();
      expect(tx.workSession.upsert).not.toHaveBeenCalled();
      expect(tx.workSession.create).not.toHaveBeenCalled();
    });

    it("finalizes an expired generation once and opens a distinct heartbeat window", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const stale = {
        ...fakeSession,
        id: "session-stale-heartbeat",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:00:00.000Z"),
      };
      const replacement = {
        ...stale,
        id: "session-heartbeat-window",
        startedAt: new Date("2026-08-11T12:10:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:10:00.000Z"),
      };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ state: "in_progress" }]),
        workCaptureIntent: prisma.workCaptureIntent,
        workSession: {
          findUnique: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(null),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue(replacement),
          updateMany: vi.fn(),
        },
        workLog: {
          create: vi.fn().mockResolvedValue({ id: "wl-heartbeat", durationS: 300 }),
        },
        interruption: { findFirst: vi.fn().mockResolvedValue(null) },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(stale);
      mockTransaction.mockImplementation(async (operation: any) => {
        expect(typeof operation).toBe("function");
        return operation(tx);
      });

      const result = await heartbeat("KAN-42", "member-1", "user-1", "codex");

      expect(result).toMatchObject({
        id: "session-heartbeat-window",
        startedAt: new Date("2026-08-11T12:10:00.000Z"),
      });
      expect(tx.workLog.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt: stale.startedAt,
          endedAt: new Date("2026-08-11T12:05:00.000Z"),
          durationS: 300,
          reason: "expired",
        }),
      });
      expect(tx.workLog.create).toHaveBeenCalledOnce();
      expect(tx.workSession.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: "user-1",
          issueId: "issue-1",
          memberId: "member-1",
          startedAt: new Date("2026-08-11T12:10:00.000Z"),
        }),
      });
      expect(mockEmit.mock.invocationCallOrder.at(-1)).toBeLessThan(
        mockPublishDomainEventByDeliveryKey.mock.invocationCallOrder[0]!
      );
      expect(mockPublishDomainEventByDeliveryKey).toHaveBeenCalledWith(
        "work-session.started:v1:session-heartbeat-window"
      );
    });

    it("emits terminal events when a lifecycle-linked sub-second window has no WorkLog", async () => {
      vi.useFakeTimers();
      const startedAt = new Date("2026-08-11T12:00:00.100Z");
      vi.setSystemTime(new Date("2026-08-11T12:00:00.900Z"));
      const session = {
        ...fakeSession,
        id: "session-sub-second",
        startedAt,
        lastHeartbeat: startedAt,
        transitionLifecycleId: "lifecycle-sub-second",
      };
      const interruption = {
        id: "interruption-sub-second",
        incidentIssueId: "issue-1",
        interruptedIssueId: "issue-interrupted",
        memberId: "member-1",
      };
      mockIssueFind.mockResolvedValue({
        ...fakeIssue,
        type: "incident",
        state: "review",
      });
      mockLockedIssue("review");
      mockSessionFindUnique.mockResolvedValue(session);
      mockInterruptionFindManyGlobal.mockResolvedValue([interruption] as any);

      expect(await heartbeat("KAN-42", "member-1", "user-1", "codex")).toBeNull();

      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockEnqueueDomainEventTx).not.toHaveBeenCalled();
      expect(mockPublishDomainEventByDeliveryKey).not.toHaveBeenCalled();
      expect(mockEmit.mock.calls.map(([event]) => (event as { type: string }).type)).toEqual([
        "work_session.ended",
        "interruption.closed",
      ]);
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.ended",
          payload: expect.objectContaining({
            workLogId: null,
            durationS: 0,
          }),
        })
      );
      expect(mockEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "worklog.created" })
      );
    });

    it("updates lastHeartbeat for existing session", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(fakeSession);
      const updatedSession = { ...fakeSession, lastHeartbeat: new Date() };
      mockSessionUpsert.mockResolvedValue(updatedSession);

      const result = await heartbeat("KAN-42", "member-1", "user-1", "codex");

      expect(result).toBe(updatedSession);
      expect(mockSessionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastHeartbeat: expect.any(Date) }),
        })
      );
      expect(mockEnqueueDomainEventTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          deliveryKey: "work-session.started:v1:session-1",
        })
      );
      expect(mockPublishDomainEventByDeliveryKey).toHaveBeenCalledWith(
        "work-session.started:v1:session-1"
      );
    });

    it("does not emit a false start when the adoption transaction fails", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockTransaction.mockRejectedValue(new Error("adoption transaction failed"));

      await expect(heartbeat("KAN-42", "member-1", "user-1", "codex")).rejects.toThrow(
        "adoption transaction failed"
      );

      expect(mockEnqueueDomainEventTx).not.toHaveBeenCalled();
      expect(mockPublishDomainEventByDeliveryKey).not.toHaveBeenCalled();
    });

    it("throws 404 when issue not found", async () => {
      mockIssueFind.mockResolvedValue(null);

      await expect(heartbeat("NOPE-1", "member-1", "u-1", "codex")).rejects.toThrow("not found");
    });
  });

  describe("durable transition lifecycle", () => {
    it("caps lifecycle completion at the active lease and closes incident interruptions atomically", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const lastHeartbeat = new Date("2026-08-11T12:01:00.000Z");
      const observedAt = new Date("2026-08-11T12:10:00.000Z");
      const leaseEndedAt = new Date("2026-08-11T12:06:00.000Z");
      const waitingStart = {
        id: "lifecycle-live-lease",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: "start-key",
        closeIdentity: null,
        startedAt,
        endedAt: null,
        memberId: "member-1",
        userId: "user-1",
        workLogId: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      const paired = {
        ...waitingStart,
        closeIdentity: "close-key",
        endedAt: observedAt,
      };
      const completed = { ...paired, workLogId: "wl-lease" };
      const liveSession = {
        ...fakeSession,
        id: "session-live-lease",
        startedAt,
        lastHeartbeat,
        transitionLifecycleId: waitingStart.id,
      };
      const interruption = {
        id: "interruption-1",
        incidentIssueId: "issue-1",
        interruptedIssueId: "issue-interrupted",
        memberId: "member-1",
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique.mockResolvedValueOnce(null as any).mockResolvedValueOnce({
        ...completed,
        workLog: {
          id: "wl-lease",
          durationS: 360,
          reason: "expired",
          endedAt: leaseEndedAt,
        },
        issue: {
          id: "issue-1",
          key: "KAN-42",
          project: { workspaceId: "ws-1" },
        },
      } as any);
      mockLifecycleFindFirst.mockResolvedValue(waitingStart as any);
      mockLifecycleUpdate
        .mockResolvedValueOnce(paired as any)
        .mockResolvedValueOnce(completed as any);
      mockSessionFindUnique.mockResolvedValue(liveSession);
      mockSessionDeleteMany.mockResolvedValue({ count: 1 } as any);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-lease" } as any);
      mockInterruptionFindManyGlobal.mockResolvedValue([interruption] as any);

      await captureTransitionClose("KAN-42", observedAt);

      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: {
          id: liveSession.id,
          lastHeartbeat,
        },
      });
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt,
          endedAt: leaseEndedAt,
          durationS: 360,
          reason: "expired",
        }),
      });
      expect(mockInterruptionUpdateManyGlobal).toHaveBeenCalledWith({
        where: {
          incidentIssueId: "issue-1",
          memberId: "member-1",
          endedAt: null,
          startedAt: { lte: leaseEndedAt },
        },
        data: { endedAt: leaseEndedAt },
      });
      expect(mockEnqueueDomainEventTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          deliveryKey: expect.stringContaining(
            `:revision:0:interruption.closed:${interruption.id}`
          ),
          event: expect.objectContaining({
            type: "interruption.closed",
            payload: expect.objectContaining({ interruptionId: interruption.id }),
          }),
        })
      );
      expect(mockPublishDomainEventLane).toHaveBeenCalledWith("work-session:issue-1:user-1");
    });

    it("publishes an exact WorkLog attached by an ordinary finalizer without duplicating it", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const observedAt = new Date("2026-08-11T12:04:00.000Z");
      const existingWorkLog = {
        id: "wl-existing-stop",
        startedAt,
        endedAt: new Date("2026-08-11T12:03:00.000Z"),
        durationS: 180,
        reason: "stopped",
      };
      const waitingStart = {
        id: "lifecycle-finalized-elsewhere",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: "start-key",
        closeIdentity: null,
        startedAt,
        endedAt: null,
        memberId: "member-1",
        userId: "user-1",
        workLogId: existingWorkLog.id,
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      const paired = {
        ...waitingStart,
        closeIdentity: "close-key",
        endedAt: observedAt,
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique.mockResolvedValueOnce(null as any).mockResolvedValue({
        ...paired,
        workLog: existingWorkLog,
        issue: {
          id: "issue-1",
          key: "KAN-42",
          project: { workspaceId: "ws-1" },
        },
      } as any);
      mockLifecycleFindFirst.mockResolvedValue(waitingStart as any);
      mockLifecycleUpdate.mockResolvedValueOnce(paired as any);
      mockWorkLogFindUnique.mockResolvedValue(existingWorkLog as any);
      mockSessionFindUnique.mockResolvedValue(null as any);

      const result = await captureTransitionClose("KAN-42", observedAt);

      expect(result.workLog).toEqual({ id: existingWorkLog.id });
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockEnqueueDomainEventTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          deliveryKey: expect.stringContaining(":revision:0:worklog.created"),
          event: expect.objectContaining({ type: "worklog.created" }),
        })
      );
    });

    it("corrects only the lifecycle-linked WorkLog and reopens its durable effects", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const observedAt = new Date("2026-08-11T12:02:00.000Z");
      const provisionalEndedAt = new Date("2026-08-11T12:04:00.000Z");
      const waitingStart = {
        id: "lifecycle-provisional-close",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: "start-key-provisional",
        closeIdentity: null,
        startedAt,
        endedAt: null,
        memberId: "member-1",
        userId: "user-1",
        workLogId: "wl-provisional-close",
        createdAt: startedAt,
        updatedAt: provisionalEndedAt,
      };
      const paired = {
        ...waitingStart,
        closeIdentity: "close-key-authoritative",
        endedAt: observedAt,
      };
      const corrected = {
        ...paired,
        effectRevision: 1,
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique.mockResolvedValueOnce(null as any).mockResolvedValueOnce({
        ...corrected,
        workLog: {
          id: waitingStart.workLogId,
          durationS: 120,
          reason: "stopped",
          endedAt: observedAt,
        },
        issue: {
          id: "issue-1",
          key: "KAN-42",
          project: { workspaceId: "ws-1" },
        },
      } as any);
      mockLifecycleFindFirst.mockResolvedValue(waitingStart as any);
      mockLifecycleUpdate
        .mockResolvedValueOnce(paired as any)
        .mockResolvedValueOnce(corrected as any);
      mockWorkLogFindUnique.mockResolvedValue({
        startedAt,
        endedAt: provisionalEndedAt,
      } as any);
      mockWorkLogUpdate.mockResolvedValue({ id: waitingStart.workLogId } as any);

      const result = await captureTransitionClose("KAN-42", observedAt);

      expect(result.workLog).toEqual({ id: waitingStart.workLogId });
      expect(mockWorkLogUpdate).toHaveBeenCalledOnce();
      expect(mockWorkLogUpdate).toHaveBeenCalledWith({
        where: { id: waitingStart.workLogId },
        data: {
          endedAt: observedAt,
          durationS: 120,
          reason: "stopped",
        },
      });
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockLifecycleUpdate).toHaveBeenNthCalledWith(2, {
        where: { id: waitingStart.id },
        data: {
          effectRevision: { increment: 1 },
        },
      });
      expect(mockEnqueueDomainEventTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          deliveryKey: expect.stringContaining(":revision:1:work_session.ended"),
          event: expect.objectContaining({
            type: "work_session.ended",
            payload: expect.objectContaining({
              workLogId: waitingStart.workLogId,
              durationS: 120,
            }),
          }),
        })
      );
    });

    it("does not link an unrelated same-user WorkLog that merely overlaps the lifecycle start", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const observedAt = new Date("2026-08-11T12:04:00.000Z");
      const unrelatedWorkLog = {
        id: "wl-overlapping-other-generation",
        startedAt: new Date("2026-08-11T11:59:00.000Z"),
        endedAt: new Date("2026-08-11T12:01:00.000Z"),
        durationS: 120,
        reason: "stopped",
      };
      const waitingStart = {
        id: "lifecycle-exact-generation",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: "start-key-exact",
        closeIdentity: null,
        startedAt,
        endedAt: null,
        memberId: "member-1",
        userId: "user-1",
        workLogId: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      const paired = {
        ...waitingStart,
        closeIdentity: "close-key-exact",
        endedAt: observedAt,
      };
      const completed = { ...paired, workLogId: "wl-exact-generation" };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique.mockResolvedValueOnce(null as any).mockResolvedValue({
        ...completed,
        workLog: {
          id: "wl-exact-generation",
          durationS: 240,
          reason: "stopped",
          endedAt: observedAt,
        },
        issue: {
          id: "issue-1",
          key: "KAN-42",
          project: { workspaceId: "ws-1" },
        },
      } as any);
      mockLifecycleFindFirst.mockResolvedValue(waitingStart as any);
      mockLifecycleUpdate
        .mockResolvedValueOnce(paired as any)
        .mockResolvedValueOnce(completed as any);
      mockSessionFindUnique.mockResolvedValue(null as any);
      mockWorkLogFindFirst.mockResolvedValue(unrelatedWorkLog as any);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-exact-generation" } as any);

      const result = await captureTransitionClose("KAN-42", observedAt);

      expect(result.workLog).toEqual({ id: "wl-exact-generation" });
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt,
          endedAt: observedAt,
          issueId: "issue-1",
          memberId: "member-1",
        }),
      });
    });

    it("keeps ordinary-stop effects recoverable when async delivery fails", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const stoppedAt = new Date("2026-08-11T12:02:00.000Z");
      const transitionSession = {
        ...fakeSession,
        id: "session-transition-generation",
        source: "transition-listener",
        startedAt,
        lastHeartbeat: stoppedAt,
        transitionLifecycleId: "lifecycle-transition-generation",
      };
      const lifecycle = {
        id: "lifecycle-transition-generation",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: "start-key-stop",
        closeIdentity: null,
        startedAt,
        endedAt: null,
        memberId: "member-1",
        userId: "user-1",
        workLogId: "wl-stop-durable",
        effectRevision: 0,
        createdAt: startedAt,
        updatedAt: startedAt,
        workLog: {
          id: "wl-stop-durable",
          durationS: 120,
          reason: "stopped",
          endedAt: stoppedAt,
        },
        issue: {
          id: "issue-1",
          key: "KAN-42",
          project: { workspaceId: "ws-1" },
        },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(transitionSession);
      mockWorkLogCreate.mockResolvedValue({
        id: "wl-stop-durable",
        durationS: 120,
      } as any);
      mockLifecycleFindFirst.mockResolvedValue({
        id: lifecycle.id,
      } as any);
      mockLifecycleFindUnique.mockResolvedValue(lifecycle as any);
      mockPublishDomainEventLane.mockRejectedValueOnce(new Error("subscriber failed"));

      const result = await stopWork(
        "KAN-42",
        "user-1",
        "member-1",
        null,
        stoppedAt,
        transitionSession.id
      );

      expect(result.workLog).toEqual({ id: "wl-stop-durable", durationS: 120 });
      expect(mockLifecycleUpdateMany).toHaveBeenCalledWith({
        where: {
          id: lifecycle.id,
          workLogId: null,
        },
        data: { workLogId: "wl-stop-durable" },
      });
      expect(mockEnqueueDomainEventTx).toHaveBeenCalledWith(
        prisma,
        expect.objectContaining({
          deliveryKey:
            "work-transition-lifecycle:v1:lifecycle-transition-generation:revision:0:worklog.created",
        })
      );
      expect(mockPublishDomainEventLane).toHaveBeenCalledWith("work-session:issue-1:user-1");
      expect(mockEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "worklog.created" })
      );
    });

    it("preserves and rebases a session refreshed after an older close boundary", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const observedAt = new Date("2026-08-11T12:04:00.000Z");
      const refreshedAt = new Date("2026-08-11T12:05:00.000Z");
      const waitingStart = {
        id: "lifecycle-old-close",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: "start-key",
        closeIdentity: null,
        startedAt,
        endedAt: null,
        memberId: "member-1",
        userId: "user-1",
        workLogId: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      const paired = {
        ...waitingStart,
        closeIdentity: "close-key",
        endedAt: observedAt,
      };
      const completed = { ...paired, workLogId: "wl-old-generation" };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique.mockResolvedValueOnce(null as any).mockResolvedValueOnce({
        ...completed,
        workLog: {
          id: "wl-old-generation",
          durationS: 240,
          reason: "stopped",
          endedAt: observedAt,
        },
        issue: {
          id: "issue-1",
          key: "KAN-42",
          project: { workspaceId: "ws-1" },
        },
      } as any);
      mockLifecycleFindFirst.mockResolvedValue(waitingStart as any);
      mockLifecycleUpdate
        .mockResolvedValueOnce(paired as any)
        .mockResolvedValueOnce(completed as any);
      mockSessionFindUnique.mockResolvedValue({
        ...fakeSession,
        id: "session-refreshed",
        startedAt,
        lastHeartbeat: refreshedAt,
        transitionLifecycleId: waitingStart.id,
      });
      mockWorkLogCreate.mockResolvedValue({ id: "wl-old-generation" } as any);

      await captureTransitionClose("KAN-42", observedAt);

      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
      expect(mockSessionUpdateMany).toHaveBeenCalledWith({
        where: {
          id: "session-refreshed",
          lastHeartbeat: refreshedAt,
          startedAt,
        },
        data: {
          startedAt: refreshedAt,
          transitionLifecycleId: null,
        },
      });
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt,
          endedAt: observedAt,
          durationS: 240,
        }),
      });
    });

    it("caps an older lifecycle at a later explicit same-user generation", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const laterStartedAt = new Date("2026-08-11T12:02:00.000Z");
      const observedAt = new Date("2026-08-11T12:05:00.000Z");
      const waitingStart = {
        id: "lifecycle-older-generation",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: "start-key-older-generation",
        closeIdentity: null,
        startedAt,
        endedAt: null,
        memberId: "member-1",
        userId: "user-1",
        workLogId: null,
        createdAt: startedAt,
        updatedAt: startedAt,
      };
      const paired = {
        ...waitingStart,
        closeIdentity: "close-key-older-generation",
        endedAt: observedAt,
      };
      const completed = { ...paired, workLogId: "wl-older-generation" };
      const laterSession = {
        ...fakeSession,
        id: "session-later-explicit-generation",
        source: "mcp",
        startedAt: laterStartedAt,
        lastHeartbeat: observedAt,
        transitionLifecycleId: null,
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique.mockResolvedValueOnce(null as any).mockResolvedValueOnce({
        ...completed,
        workLog: {
          id: "wl-older-generation",
          durationS: 120,
          reason: "stopped",
          endedAt: laterStartedAt,
        },
        issue: {
          id: "issue-1",
          key: "KAN-42",
          project: { workspaceId: "ws-1" },
        },
      } as any);
      mockLifecycleFindFirst.mockResolvedValue(waitingStart as any);
      mockLifecycleUpdate
        .mockResolvedValueOnce(paired as any)
        .mockResolvedValueOnce(completed as any);
      mockSessionFindUnique.mockResolvedValue(laterSession);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-older-generation" } as any);

      await captureTransitionClose("KAN-42", observedAt);

      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
      expect(mockSessionUpdateMany).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt,
          endedAt: laterStartedAt,
          durationS: 120,
        }),
      });
    });

    it("pairs a delayed start with a close boundary that was durably recorded first", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const endedAt = new Date("2026-08-11T12:01:00.000Z");
      const closeOnly = {
        id: "lifecycle-close-first",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: null,
        closeIdentity: "close-key",
        startedAt: null,
        endedAt,
        memberId: null,
        userId: null,
        workLogId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      const paired = {
        ...closeOnly,
        startIdentity: "start-key",
        startedAt,
        memberId: "member-1",
        userId: "user-1",
      };
      const completed = {
        ...paired,
        workLogId: "wl-close-first",
      };
      const publisherRow = {
        ...completed,
        workLog: { id: "wl-close-first", durationS: 60, reason: "stopped" },
        issue: {
          id: "issue-1",
          key: "KAN-42",
          project: { workspaceId: "ws-1" },
        },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique
        .mockResolvedValueOnce(null as any)
        .mockResolvedValueOnce(publisherRow as any);
      mockLifecycleFindFirst.mockResolvedValue(closeOnly as any);
      mockLifecycleUpdate
        .mockResolvedValueOnce(paired as any)
        .mockResolvedValueOnce(completed as any);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-close-first" } as any);
      mockLifecycleUpdateMany.mockResolvedValue({ count: 1 } as any);

      const result = await stageTransitionStart("KAN-42", "user-1", "member-1", startedAt);

      expect(result.lifecycle).toMatchObject({
        id: closeOnly.id,
        completed: true,
      });
      expect(result.session).toBeNull();
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          issueId: "issue-1",
          memberId: "member-1",
          startedAt,
          endedAt,
          durationS: 60,
        }),
      });
      expect(mockEnqueueDomainEventTx).toHaveBeenCalledTimes(2);
      expect(mockPublishDomainEventLane).toHaveBeenCalledWith("work-session:issue-1:user-1");
    });

    it("treats a completed start identity as an exact replay without new state or effects", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const completed = {
        id: "lifecycle-complete",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: "start-key",
        closeIdentity: "close-key",
        startedAt,
        endedAt: new Date("2026-08-11T12:02:00.000Z"),
        memberId: "member-1",
        userId: "user-1",
        workLogId: "wl-exact",
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique.mockResolvedValue(completed as any);
      mockLifecycleUpdateMany.mockResolvedValue({ count: 0 } as any);

      const result = await stageTransitionStart("KAN-42", "user-1", "member-1", startedAt);

      expect(result.lifecycle).toMatchObject({
        id: "lifecycle-complete",
        completed: true,
      });
      expect(mockLifecycleCreate).not.toHaveBeenCalled();
      expect(mockLifecycleUpdate).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
      expect(mockEmitAndWait).not.toHaveBeenCalled();
    });

    it("records an unmatched close as durable evidence without a WorkLog marker", async () => {
      const observedAt = new Date("2026-08-11T12:01:00.000Z");
      const closeOnly = {
        id: "lifecycle-close-only",
        issueId: "issue-1",
        source: "transition-listener",
        startIdentity: null,
        closeIdentity: "close-key",
        startedAt: null,
        endedAt: observedAt,
        memberId: null,
        userId: null,
        workLogId: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockLifecycleFindUnique.mockResolvedValue(null as any);
      mockLifecycleFindFirst.mockResolvedValue(null as any);
      mockLifecycleCreate.mockResolvedValue(closeOnly as any);
      mockLifecycleUpdateMany.mockResolvedValue({ count: 0 } as any);

      const result = await captureTransitionClose("KAN-42", observedAt);

      expect(result.workLog).toBeNull();
      expect(result.lifecycle).toMatchObject({
        id: closeOnly.id,
        completed: false,
      });
      expect(mockLifecycleCreate).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockEmitAndWait).not.toHaveBeenCalled();
    });
  });

  describe("stopWork", () => {
    it("does not let a delayed close delete a lifecycle refreshed after its boundary", async () => {
      const observedAt = new Date("2026-08-11T12:04:00.000Z");
      const refreshed = {
        ...fakeSession,
        id: "session-refreshed",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:05:00.000Z"),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(refreshed);

      const result = await stopWork("KAN-42", "user-1", "member-1", null, observedAt, refreshed.id);

      expect(result).toEqual({ ok: true, deleted: false, workLog: null });
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockSessionDelete).not.toHaveBeenCalled();
    });
    it("deletes the session and returns deleted: true (legacy path, no session found recheck)", async () => {
      // 70-second session: ≥ 60s → should create WorkLog via $transaction
      const startedAt = new Date(Date.now() - 70_000);
      const session70s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session70s);
      const fakeWorkLog = { id: "wl-1", durationS: 70 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.ok).toBe(true);
      expect(result.deleted).toBe(true);
    });

    it("uses $transaction for ≥ 60s session: creates WorkLog atomically", async () => {
      const startedAt = new Date(Date.now() - 90_000); // 90 seconds ago
      const session90s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session90s);
      const fakeWorkLog = { id: "wl-1", durationS: 90 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);
      // workSession.delete is called to build the PrismaPromise passed to $transaction
      mockSessionDelete.mockResolvedValue(session90s);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.ok).toBe(true);
      expect(result.deleted).toBe(true);
      expect(result.workLog).not.toBeNull();
      expect(result.workLog!.durationS).toBe(90);
      // $transaction must have been called (atomicity guaranteed by transaction)
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it.each([1, 59])("persists a positive %d-second session", async (durationS) => {
      const startedAt = new Date(Date.now() - durationS * 1000);
      const session = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session);
      mockWorkLogCreate.mockResolvedValue({ id: `wl-${durationS}`, durationS } as any);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.workLog).toEqual({ id: `wl-${durationS}`, durationS });
      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ durationS }),
      });
    });

    it("returns deleted: false when no session exists", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(null);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.ok).toBe(true);
      expect(result.deleted).toBe(false);
      expect(result.workLog).toBeNull();
    });

    it("emits work_session.ended event with workLogId on ≥ 60s stop", async () => {
      const startedAt = new Date(Date.now() - 90_000);
      const session90s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session90s);
      const fakeWorkLog = { id: "wl-99", durationS: 90 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      await stopWork("KAN-42", "user-1", "member-1");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.ended",
          workspaceId: "ws-1",
          payload: expect.objectContaining({ workLogId: "wl-99", durationS: 90 }),
        })
      );
    });

    // ── work-session-resilience (Slice A) — explicit stop emits reason: "stopped"
    // Symmetric with cleanupExpired which emits reason: "expired". Forecast and
    // other downstream listeners must be able to distinguish stop from expiry
    // on the `reason` field alone.

    it("emits work_session.ended with reason: 'stopped' on explicit stopWork", async () => {
      const startedAt = new Date(Date.now() - 90_000);
      const session90s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session90s);
      const fakeWorkLog = { id: "wl-stopped-1", durationS: 90 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      mockEmit.mockClear();
      await stopWork("KAN-42", "user-1", "member-1");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.ended",
          payload: expect.objectContaining({ reason: "stopped" }),
        })
      );
    });

    it("emits work_session.ended with reason: 'stopped' for sub-minute stopWork too", async () => {
      const startedAt = new Date(Date.now() - 30_000);
      const session30s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session30s);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-30", durationS: 30 } as any);

      mockEmit.mockClear();
      await stopWork("KAN-42", "user-1", "member-1");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.ended",
          payload: expect.objectContaining({ reason: "stopped" }),
        })
      );
    });

    it("emits work_session.ended with a WorkLog for positive sub-minute work", async () => {
      const startedAt = new Date(Date.now() - 30_000);
      const session30s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session30s);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-30", durationS: 30 } as any);

      await stopWork("KAN-42", "user-1", "member-1");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.ended",
          payload: expect.objectContaining({ workLogId: "wl-30" }),
        })
      );
    });

    it("threads via into WorkLog when provided", async () => {
      const startedAt = new Date(Date.now() - 90_000);
      const session90s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session90s);
      const fakeWorkLog = { id: "wl-2", durationS: 90 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      await stopWork("KAN-42", "user-1", "member-1", "claude-code");

      // $transaction receives opaque PrismaPromises; assert workLog.create was called
      // with data containing via: 'claude-code' (the array element at index 0).
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ via: "claude-code" }),
        })
      );
    });

    // ── Fix 1: P2025 race condition (stopWork) ─────────────────────────────
    // cleanupExpired can delete the session between findUnique and $transaction.
    // The P2025 from workSession.delete inside the transaction must be caught
    // and return the same not-found shape: { ok: true, deleted: false, workLog: null }.

    it("returns not-found shape when $transaction rejects with P2025 (race with cleanupExpired)", async () => {
      const startedAt = new Date(Date.now() - 90_000);
      const session90s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session90s);

      // Simulate P2025: Prisma throws with code P2025 when the record is gone
      const p2025 = Object.assign(new Error("Record to delete not found"), {
        code: "P2025",
      });
      mockTransaction.mockRejectedValueOnce(p2025);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.ok).toBe(true);
      expect(result.deleted).toBe(false);
      expect(result.workLog).toBeNull();
    });

    it("still propagates non-P2025 transaction errors as HTTP 500", async () => {
      const startedAt = new Date(Date.now() - 90_000);
      const session90s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session90s);

      const dbError = Object.assign(new Error("Constraint violation"), {
        code: "P2002",
      });
      mockTransaction.mockRejectedValueOnce(dbError);

      await expect(stopWork("KAN-42", "user-1", "member-1")).rejects.toThrow(
        "Constraint violation"
      );
    });

    // ── Whole-second boundary ───────────────────────────────────────────────

    it("writes WorkLog when durationS is exactly 60 (boundary)", async () => {
      const startedAt = new Date(Date.now() - 60_000);
      const session60s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session60s);
      const fakeWorkLog = { id: "wl-60", durationS: 60 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.workLog).not.toBeNull();
      // $transaction used (workLog.create + workSession.delete built as PrismaPromises)
      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
    });

    it("deletes without a WorkLog when durationS is zero", async () => {
      const startedAt = new Date();
      const session0s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session0s);
      mockSessionDelete.mockResolvedValue(session0s);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.workLog).toBeNull();
      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockSessionDeleteMany).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
    });
  });

  // ── getActiveWorkers ───────────────────────────────────────────────────

  describe("getActiveWorkers", () => {
    it("returns mapped sessions within TTL", async () => {
      mockSessionFindMany.mockResolvedValue([
        {
          userId: "u-1",
          memberId: "m-1",
          member: { username: "alice", isAgent: false },
          startedAt: new Date("2026-01-01T00:00:00Z"),
          source: "mcp",
        },
      ] as any);

      const workers = await getActiveWorkers("issue-1");

      expect(workers).toHaveLength(1);
      expect(workers[0]).toEqual({
        userId: "u-1",
        memberId: "m-1",
        username: "alice",
        isAgent: false,
        startedAt: "2026-01-01T00:00:00.000Z",
        source: "mcp",
      });
    });

    it("filters by TTL cutoff in the query", async () => {
      mockSessionFindMany.mockResolvedValue([]);

      await getActiveWorkers("issue-1");

      expect(mockSessionFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            issueId: "issue-1",
            lastHeartbeat: { gt: expect.any(Date) },
          }),
        })
      );
    });
  });

  // ── cleanupExpired ─────────────────────────────────────────────────────
  //
  // S2 / KAN-26: cleanupExpired must use per-session loop with try/catch,
  // cap duration at the activity lease, persist every positive whole second,
  // and isolate one-session failure from siblings.

  describe("cleanupExpired", () => {
    it("does not finalize a stale snapshot after the same generation was renewed", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const staleHeartbeat = new Date("2026-08-11T12:00:00.000Z");
      const staleSnapshot = {
        id: "s-renewed",
        memberId: "m-1",
        userId: "u-1",
        issueId: "i-1",
        source: "mcp",
        startedAt: staleHeartbeat,
        lastHeartbeat: staleHeartbeat,
        issue: {
          key: "KAN-1",
          type: "task",
          project: { workspaceId: "ws-1" },
        },
      };
      const tx = {
        $queryRaw: vi.fn().mockResolvedValue([{ state: "in_progress" }]),
        workSession: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        workLog: { create: vi.fn() },
        interruption: { findMany: vi.fn(), updateMany: vi.fn() },
        workCaptureIntent: { updateMany: vi.fn() },
      };
      mockSessionFindMany.mockResolvedValue([staleSnapshot] as any);
      mockTransaction.mockImplementation(async (operation: any) => {
        expect(typeof operation).toBe("function");
        return operation(tx);
      });

      const count = await cleanupExpired();

      expect(count).toBe(0);
      expect(tx.workSession.deleteMany).toHaveBeenCalledWith({
        where: { id: "s-renewed", lastHeartbeat: staleHeartbeat },
      });
      expect(tx.workLog.create).not.toHaveBeenCalled();
      expect(tx.workCaptureIntent.updateMany).not.toHaveBeenCalled();
      expect(mockSessionDelete).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "work_session.ended" })
      );
    });

    it("persists the initial lease for an automatic transition session", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:06:00.000Z"));
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const automaticSession = {
        id: "s-transition",
        memberId: "m-1",
        userId: "u-1",
        issueId: "i-1",
        source: "transition-listener",
        startedAt,
        lastHeartbeat: startedAt,
        issue: {
          key: "KAN-1",
          type: "task",
          project: { workspaceId: "ws-1" },
        },
      };
      mockSessionFindMany.mockResolvedValue([automaticSession] as any);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-transition", durationS: 300 } as any);

      const count = await cleanupExpired();

      expect(count).toBe(1);
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt,
          endedAt: new Date("2026-08-11T12:05:00.000Z"),
          durationS: 300,
          reason: "expired",
        }),
      });
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: { id: "s-transition", lastHeartbeat: startedAt },
      });
    });

    it("creates WorkLog for an expired session using the bounded activity lease", async () => {
      const startedAt = new Date(Date.now() - 120_000); // 2 min ago
      const lastHeartbeat = new Date(Date.now() - 10_000); // 10s ago (expired but was alive)
      const expiredSessions = [
        {
          id: "s-1",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          source: "web",
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);

      const count = await cleanupExpired();

      expect(count).toBe(1);
      // $transaction called once for this ≥ 60s session
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it("persists a positive sub-minute expired session", async () => {
      const startedAt = new Date(Date.now() - 30_000);
      const lastHeartbeat = new Date(Date.now() - 20_000); // duration: ~10s
      const expiredSessions = [
        {
          id: "s-short",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          source: "cli",
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);

      const count = await cleanupExpired();

      expect(count).toBe(1);
      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
    });

    it("isolates one-session failure: other sessions complete (D4)", async () => {
      const now = Date.now();
      const startedAt1 = new Date(now - 120_000);
      const hb1 = new Date(now - 10_000);
      const startedAt2 = new Date(now - 90_000);
      const hb2 = new Date(now - 8_000);
      const startedAt3 = new Date(now - 80_000);
      const hb3 = new Date(now - 6_000);

      const expiredSessions = [
        {
          id: "s-1",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          source: "mcp",
          startedAt: startedAt1,
          lastHeartbeat: hb1,
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
        {
          id: "s-2",
          memberId: "m-2",
          userId: "u-2",
          issueId: "i-2",
          source: "web",
          startedAt: startedAt2,
          lastHeartbeat: hb2,
          issue: { key: "KAN-2", project: { workspaceId: "ws-1" } },
        },
        {
          id: "s-3",
          memberId: "m-3",
          userId: "u-3",
          issueId: "i-3",
          source: "cli",
          startedAt: startedAt3,
          lastHeartbeat: hb3,
          issue: { key: "KAN-3", project: { workspaceId: "ws-1" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);
      // s-1 succeeds, s-2 throws, s-3 succeeds
      mockWorkLogCreate
        .mockResolvedValueOnce({ id: "wl-1" } as any)
        .mockRejectedValueOnce(new Error("constraint violation"))
        .mockResolvedValueOnce({ id: "wl-3" } as any);

      const logger = { info: vi.fn(), error: vi.fn() };
      const count = await cleanupExpired(logger);

      // s-1 and s-3 completed — count should be 2 (logged: s-2 skipped due to error)
      expect(count).toBe(2);
      // Error for s-2 should have been logged, not thrown
      expect(logger.error).toHaveBeenCalledOnce();
      // $transaction called 3 times (once per session; s-2 throws)
      expect(mockTransaction).toHaveBeenCalledTimes(3);
    });

    it("normalizes WorkSession.source to via for WorkLog via field", async () => {
      const startedAt = new Date(Date.now() - 120_000);
      const lastHeartbeat = new Date(Date.now() - 10_000);
      const expiredSessions = [
        {
          id: "s-web",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          source: "web", // known vocabulary → via: "web"
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
        {
          id: "s-unknown",
          memberId: "m-2",
          userId: "u-2",
          issueId: "i-2",
          source: "some-random-source", // unknown → via: null
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-2", project: { workspaceId: "ws-1" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);

      await cleanupExpired();

      // Both sessions ≥ 60s → both called $transaction
      expect(mockTransaction).toHaveBeenCalledTimes(2);
    });

    it("returns 0 when no expired sessions", async () => {
      mockSessionFindMany.mockResolvedValue([]);

      const count = await cleanupExpired();

      expect(count).toBe(0);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("logs when logger is provided", async () => {
      const startedAt = new Date(Date.now() - 120_000);
      const lastHeartbeat = new Date(Date.now() - 10_000);
      mockSessionFindMany.mockResolvedValue([
        {
          id: "s-1",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          source: "mcp",
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
      ] as any);

      const logger = { info: vi.fn(), error: vi.fn() };
      await cleanupExpired(logger);

      expect(logger.info).toHaveBeenCalledWith({ count: 1 }, "Cleaned up expired work sessions");
    });

    // ── Whole-second boundary (expiry path) ────────────────────────────────

    it("writes WorkLog when expiry durationS is exactly 60 (boundary)", async () => {
      const now = Date.now();
      // lastHeartbeat - startedAt = exactly 60s → $transaction used
      const startedAt = new Date(now - 60_000);
      const lastHeartbeat = new Date(now);
      const expiredSessions = [
        {
          id: "s-exact60",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          source: "web",
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);

      const count = await cleanupExpired();

      expect(count).toBe(1);
      // $transaction used for >= 60s (workLog.create is called to build PrismaPromise)
      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
    });

    it("persists WorkLog when expiry durationS is exactly 59", async () => {
      const now = Date.now();
      // observed close - startedAt = exactly 59s → WorkLog is preserved
      const startedAt = new Date(now - 59_000);
      const lastHeartbeat = new Date(now);
      const expiredSessions = [
        {
          id: "s-exact59",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          source: "web",
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);

      const count = await cleanupExpired();

      expect(count).toBe(1);
      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
    });

    // ── Fix 2: session started with via 'claude-code' → expires → WorkLog.via='claude-code'
    // This tests that when the session source is 'claude-code' (stored from request.via),
    // cleanupExpired correctly normalizes it to WorkLog.via = 'claude-code'.

    it("carries via from session source through expiry: claude-code → WorkLog.via=claude-code", async () => {
      const startedAt = new Date(Date.now() - 120_000);
      const lastHeartbeat = new Date(Date.now() - 10_000);
      const expiredSessions = [
        {
          id: "s-cc",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          source: "claude-code", // stored from request.via at startWork
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);

      await cleanupExpired();

      // workLog.create must be called with via: "claude-code"
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ via: "claude-code" }),
        })
      );
    });
  });

  // ── Phase 4 (KAN-102): worklog.created emission ───────────────────────────
  //
  // 4.1 stopWork path: after $transaction succeeds for a ≥ 60s session,
  //     eventBus.emit must receive EXACTLY ONE call of type "worklog.created"
  //     with payload { workLogId, issueId, workspaceId }.
  //
  // 4.2 cleanupExpired path: same guarantee for the expiry loop.

  describe("stopWork — worklog.created emission (task 4.1)", () => {
    it("emits worklog.created with correct payload after ≥ 60s stopWork", async () => {
      const startedAt = new Date(Date.now() - 90_000); // 90 s session
      const session90s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session90s);
      const fakeWorkLog = { id: "wl-created-1", durationS: 90 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      mockEmit.mockClear();
      await stopWork("KAN-42", "user-1", "member-1");

      const worklogEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "worklog.created"
      );
      expect(worklogEmit).toBeDefined();
      expect(worklogEmit![0]).toMatchObject({
        type: "worklog.created",
        payload: {
          workLogId: "wl-created-1",
          issueId: "issue-1",
          workspaceId: "ws-1",
        },
      });
    });

    it("emits worklog.created for positive sub-minute stopWork", async () => {
      const startedAt = new Date(Date.now() - 30_000); // 30 s — sub-minute
      const session30s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session30s);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-created-30", durationS: 30 } as any);

      mockEmit.mockClear();
      await stopWork("KAN-42", "user-1", "member-1");

      const worklogEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "worklog.created"
      );
      expect(worklogEmit).toBeDefined();
    });
  });

  describe("cleanupExpired — worklog.created emission (task 4.2)", () => {
    it("emits worklog.created with correct payload after ≥ 60s expiry cleanup", async () => {
      const startedAt = new Date(Date.now() - 120_000);
      const lastHeartbeat = new Date(Date.now() - 10_000); // duration ~110s
      const expiredSessions = [
        {
          id: "s-emit",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-emit",
          source: "mcp",
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-10", project: { workspaceId: "ws-emit" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);
      const fakeWorkLog = { id: "wl-expired-1", durationS: 110 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      mockEmit.mockClear();
      await cleanupExpired();

      const worklogEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "worklog.created"
      );
      expect(worklogEmit).toBeDefined();
      expect(worklogEmit![0]).toMatchObject({
        type: "worklog.created",
        payload: {
          workLogId: "wl-expired-1",
          issueId: "i-emit",
          workspaceId: "ws-emit",
        },
      });
    });

    it("emits worklog.created for positive sub-minute expiry cleanup", async () => {
      const startedAt = new Date(Date.now() - 30_000);
      const lastHeartbeat = new Date(Date.now() - 20_000); // duration ~10s
      const expiredSessions = [
        {
          id: "s-short-emit",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-short",
          source: "web",
          startedAt,
          lastHeartbeat,
          issue: { key: "KAN-11", project: { workspaceId: "ws-short" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-expired-10", durationS: 30 } as any);

      mockEmit.mockClear();
      await cleanupExpired();

      const worklogEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "worklog.created"
      );
      expect(worklogEmit).toBeDefined();
    });
  });

  // ── Fix 2: normalizeVia('mcp') → null ─────────────────────────────────────
  // Documented in via.ts: 'mcp' is deliberately excluded from the vocabulary
  // because it is a transport name, not a client identity.

  describe("normalizeVia — mcp excluded", () => {
    it("normalizeVia('mcp') returns null — mcp is transport, not client identity", async () => {
      // Import normalizeVia inline to avoid circular mock issues
      const { normalizeVia } = await import("../../shared/via.js");
      expect(normalizeVia("mcp")).toBeNull();
    });
  });

  // ── KAN-103 PR3: interruption event emission ───────────────────────────────

  describe("KAN-103 PR3 — interruption event emission", () => {
    const mockInterruptionCreate = mockInterruptionCreateGlobal;
    const mockInterruptionFindMany = mockInterruptionFindManyGlobal;
    const mockInterruptionUpdateMany = mockInterruptionUpdateManyGlobal;

    const incidentIssue = {
      id: "incident-1",
      key: "INC-1",
      type: "incident",
      assigneeId: "member-1",
      project: { workspaceId: "ws-1", key: "KAN" },
    } as any;

    const taskIssue = {
      id: "task-1",
      key: "KAN-99",
      type: "task",
      assigneeId: "member-1",
      project: { workspaceId: "ws-1", key: "KAN" },
    } as any;

    it("startWork on incident emits interruption.opened for each displaced session", async () => {
      // incident switch: displaced session on task-1
      mockIssueFind.mockResolvedValueOnce(incidentIssue); // first call: the incident
      // displaced sessions (KAN-163: startedAt/source needed for the inline tx)
      mockSessionFindMany
        .mockResolvedValueOnce([
          {
            id: "s-displaced",
            userId: "u-1",
            memberId: "m-1",
            issueId: "task-1",
            startedAt: new Date(),
            source: "mcp",
            lastHeartbeat: new Date(),
            issue: { key: "KAN-99" },
          },
        ] as any) // displaced sessions query
        .mockResolvedValueOnce([]); // other workers query (after upsert)
      // KAN-163: the displaced stop + interruption.create run in one interactive
      // transaction — execute the callback against the mocked prisma client.
      mockTransaction.mockImplementation(async (fn: any) => fn(prisma));
      mockSessionDelete.mockResolvedValue({} as any);
      mockSessionUpsert.mockResolvedValue({ id: "s-new" } as any);
      mockInterruptionFindMany.mockResolvedValue([]); // resume-close: no open interruptions
      mockInterruptionUpdateMany.mockResolvedValue({ count: 0 } as any);
      mockInterruptionCreate.mockResolvedValue({
        id: "int-auto-1",
        incidentIssueId: "incident-1",
        interruptedIssueId: "task-1",
        memberId: "m-1",
      } as any);
      mockIssueUpdate.mockResolvedValue({} as any);

      mockEmit.mockClear();
      await startWork("INC-1", "member-1", "u-1", "mcp");

      const openedEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "interruption.opened"
      );
      expect(openedEmit).toBeDefined();
      expect(openedEmit![0]).toMatchObject({
        type: "interruption.opened",
        workspaceId: "ws-1",
        payload: {
          interruptionId: "int-auto-1",
          incidentIssueId: "incident-1",
          interruptedIssueId: "task-1",
        },
      });
    });

    it("KAN-163: displaced stop + interruption.create are one atomic transaction — create failure rejects and the session delete is in the same tx scope", async () => {
      mockIssueFind.mockResolvedValueOnce(incidentIssue);
      mockSessionFindMany
        .mockResolvedValueOnce([
          {
            id: "s-displaced",
            userId: "u-1",
            memberId: "m-1",
            issueId: "task-1",
            startedAt: new Date(),
            source: "mcp",
            lastHeartbeat: new Date(),
            issue: { key: "KAN-99" },
          },
        ] as any)
        .mockResolvedValueOnce([]); // other-workers query — never reached (tx rejects first), set for robustness
      // Run the interactive transaction callback against the mocked client so a
      // create rejection propagates exactly as Postgres would (and rolls back).
      mockTransaction.mockImplementation(async (fn: any) => fn(prisma));
      mockSessionDelete.mockResolvedValue({} as any);
      mockSessionUpsert.mockResolvedValue({ id: "s-new" } as any); // safety net if reject point shifts
      mockInterruptionCreate.mockRejectedValueOnce(new Error("interruption.create failed"));

      mockEmit.mockClear();

      // The whole startWork must reject — the create is awaited INSIDE the tx,
      // not fire-and-forget. This mock verifies propagation + that delete and
      // create share the same tx callback (the atomic unit); the actual rollback
      // of the delete is a Postgres guarantee, not something the mock simulates.
      await expect(startWork("INC-1", "member-1", "u-1", "mcp")).rejects.toThrow();

      // delete + create were issued in the same transaction callback (atomic unit).
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ id: "s-displaced" }),
      });
      expect(mockInterruptionCreate).toHaveBeenCalledOnce();
      // Zero-second displaced session → no WorkLog written before the failure.
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      // No success event leaks out when the transaction fails.
      const openedEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "interruption.opened"
      );
      expect(openedEmit).toBeUndefined();
    });

    it("opens the incident and displaces every sibling in one atomic transaction", async () => {
      const displaced = [
        {
          id: "s-displaced-1",
          userId: "u-1",
          memberId: "member-1",
          issueId: "task-1",
          startedAt: new Date("2026-08-11T12:00:00.000Z"),
          lastHeartbeat: new Date("2026-08-11T12:01:00.000Z"),
          source: "mcp",
          issue: { key: "KAN-1" },
        },
        {
          id: "s-displaced-2",
          userId: "u-1",
          memberId: "member-1",
          issueId: "task-2",
          startedAt: new Date("2026-08-11T12:00:00.000Z"),
          lastHeartbeat: new Date("2026-08-11T12:01:00.000Z"),
          source: "mcp",
          issue: { key: "KAN-2" },
        },
      ];
      mockIssueFind.mockResolvedValue({ ...incidentIssue, state: "in_progress" });
      mockSessionFindUnique.mockResolvedValue(null);
      mockSessionFindMany.mockResolvedValue(displaced as any);
      mockSessionUpsert.mockResolvedValue({
        ...fakeSession,
        id: "incident-session",
        issueId: "incident-1",
      });
      mockInterruptionCreate
        .mockResolvedValueOnce({ id: "int-1" } as any)
        .mockRejectedValueOnce(new Error("second interruption failed"));
      mockTransaction.mockImplementation(async (operation: any) => operation(prisma));

      await expect(startWork("INC-1", "member-1", "u-1", "mcp")).rejects.toThrow(
        "second interruption failed"
      );

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockSessionUpsert).toHaveBeenCalledOnce();
      expect(mockSessionDeleteMany).toHaveBeenCalledTimes(2);
      expect(mockEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "interruption.opened" })
      );
    });

    it("ignores a sibling generation that began after the incident boundary", async () => {
      const boundary = new Date("2026-08-11T12:00:00.000Z");
      const futureSibling = {
        id: "future-sibling",
        userId: "u-1",
        memberId: "member-1",
        issueId: "task-future",
        startedAt: new Date("2026-08-11T12:01:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:02:00.000Z"),
        source: "mcp",
        issue: { key: "KAN-2", type: "task" },
      };
      mockIssueFind.mockResolvedValue({ ...incidentIssue, state: "in_progress" });
      mockSessionFindUnique.mockResolvedValue(null);
      mockSessionUpsert.mockResolvedValue({
        ...fakeSession,
        id: "incident-session",
        issueId: "incident-1",
        startedAt: boundary,
        lastHeartbeat: boundary,
      });
      mockSessionFindMany.mockResolvedValue([futureSibling] as any);

      await startWork("INC-1", "member-1", "u-1", "mcp", null, undefined, {
        transitionObservedAt: boundary,
      });

      expect(mockSessionFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({ startedAt: { lte: boundary } }),
        include: { issue: { select: { key: true, type: true } } },
      });
      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockInterruptionCreate).not.toHaveBeenCalled();
      expect(
        mockEmit.mock.calls.filter(
          ([event]) => (event as { type: string }).type === "interruption.opened"
        )
      ).toHaveLength(0);
    });

    it("preserves a recent historical sibling marker when an incident starts", async () => {
      const boundary = new Date("2026-08-11T12:05:00.000Z");
      const historicalSibling = {
        id: "historical-sibling",
        userId: "u-1",
        memberId: "member-1",
        issueId: "task-historical",
        startedAt: new Date("2026-08-11T12:04:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:04:00.000Z"),
        source: "historical-transition:transition-listener",
        issue: { key: "KAN-2", type: "task" },
      };
      mockIssueFind.mockResolvedValue({ ...incidentIssue, state: "in_progress" });
      mockSessionFindUnique.mockResolvedValue(null);
      mockSessionUpsert.mockResolvedValue({
        ...fakeSession,
        id: "incident-session",
        issueId: "incident-1",
        startedAt: boundary,
        lastHeartbeat: boundary,
      });
      mockSessionFindMany.mockResolvedValue([historicalSibling] as any);
      mockInterruptionCreate.mockResolvedValue({ id: "should-not-open" } as any);

      await startWork("INC-1", "member-1", "u-1", "mcp", null, undefined, {
        transitionObservedAt: boundary,
      });

      expect(mockSessionFindMany).toHaveBeenCalledWith({
        where: expect.objectContaining({
          NOT: {
            source: { startsWith: "historical-transition:" },
          },
        }),
        include: { issue: { select: { key: true, type: true } } },
      });
      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockInterruptionCreate).not.toHaveBeenCalled();
      expect(
        mockEmit.mock.calls.filter(
          ([event]) =>
            (event as { type: string }).type === "interruption.opened" &&
            (event as { payload?: { interruptedIssueId?: string } }).payload?.interruptedIssueId ===
              historicalSibling.issueId
        )
      ).toHaveLength(0);
    });

    it("closes a displaced incident's interruptions at the same boundary exactly once", async () => {
      const boundary = new Date("2026-08-11T12:05:00.000Z");
      const displacedIncident = {
        id: "incident-b-session",
        userId: "u-1",
        memberId: "member-1",
        issueId: "incident-b",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:04:00.000Z"),
        source: "mcp",
        issue: { key: "INC-2", type: "incident" },
      };
      const openInterruption = {
        id: "incident-b-open-interruption",
        incidentIssueId: "incident-b",
        interruptedIssueId: "task-1",
        memberId: "member-1",
      };
      mockIssueFind.mockResolvedValue({ ...incidentIssue, state: "in_progress" });
      mockSessionFindUnique.mockResolvedValue(null);
      mockSessionUpsert.mockResolvedValue({
        ...fakeSession,
        id: "incident-a-session",
        issueId: "incident-1",
        startedAt: boundary,
        lastHeartbeat: boundary,
      });
      mockSessionFindMany.mockResolvedValue([displacedIncident] as any);
      mockInterruptionFindMany
        .mockResolvedValueOnce([openInterruption] as any)
        .mockResolvedValueOnce([]);
      mockInterruptionCreate.mockResolvedValue({
        id: "incident-a-open-interruption",
        incidentIssueId: "incident-1",
        interruptedIssueId: "incident-b",
        memberId: "member-1",
      } as any);

      await startWork("INC-1", "member-1", "u-1", "mcp", null, undefined, {
        transitionObservedAt: boundary,
      });

      expect(mockInterruptionUpdateMany).toHaveBeenCalledWith({
        where: {
          incidentIssueId: "incident-b",
          memberId: "member-1",
          endedAt: null,
          startedAt: { lte: boundary },
        },
        data: { endedAt: boundary },
      });
      expect(mockInterruptionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          incidentIssueId: "incident-1",
          interruptedIssueId: "incident-b",
          memberId: "member-1",
          startedAt: boundary,
        }),
      });
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "interruption.closed" })
      );
      expect(
        mockEmit.mock.calls.filter(
          ([event]) =>
            (event as { type: string; payload?: { interruptionId?: string } }).type ===
              "interruption.closed" &&
            (event as { payload?: { interruptionId?: string } }).payload?.interruptionId ===
              openInterruption.id
        )
      ).toHaveLength(1);
      expect(
        mockEmit.mock.calls.filter(
          ([event]) =>
            (event as { type: string; payload?: { interruptionId?: string } }).type ===
              "interruption.opened" &&
            (event as { payload?: { interruptionId?: string } }).payload?.interruptionId ===
              "incident-a-open-interruption"
        )
      ).toHaveLength(1);
    });

    it("startWork (resume) emits interruption.closed for each open interruption closed", async () => {
      mockIssueFind.mockResolvedValue(taskIssue);
      mockSessionUpsert.mockResolvedValue({ id: "s-1" } as any);
      mockSessionFindMany.mockResolvedValue([]); // no other workers
      mockInterruptionFindMany.mockResolvedValue([
        {
          id: "int-1",
          incidentIssueId: "incident-1",
          interruptedIssueId: "task-1",
          memberId: "m-1",
        },
      ] as any);
      mockInterruptionUpdateMany.mockResolvedValue({ count: 1 } as any);
      mockIssueUpdate.mockResolvedValue({} as any);

      mockEmit.mockClear();
      await startWork("KAN-99", "member-1", "u-1", "mcp");

      const closedEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "interruption.closed"
      );
      expect(closedEmit).toBeDefined();
      expect(closedEmit![0]).toMatchObject({
        type: "interruption.closed",
        workspaceId: "ws-1",
        payload: {
          interruptionId: "int-1",
          incidentIssueId: "incident-1",
          interruptedIssueId: "task-1",
        },
      });
    });

    it("stopWork on incident emits interruption.closed for each open interruption closed", async () => {
      mockIssueFind.mockResolvedValue(incidentIssue);
      mockSessionFindUnique.mockResolvedValue({
        id: "s-inc",
        userId: "u-1",
        issueId: "incident-1",
        startedAt: new Date(Date.now() - 30_000),
        lastHeartbeat: new Date(),
        memberId: "m-1",
      } as any);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-inc", durationS: 30 } as any);
      mockInterruptionFindMany.mockResolvedValue([
        {
          id: "int-2",
          incidentIssueId: "incident-1",
          interruptedIssueId: "task-1",
          memberId: "m-1",
        },
      ] as any);
      mockInterruptionUpdateMany.mockResolvedValue({ count: 1 } as any);

      mockEmit.mockClear();
      await stopWork("INC-1", "u-1", "m-1");

      const closedEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "interruption.closed"
      );
      expect(closedEmit).toBeDefined();
      expect(closedEmit![0]).toMatchObject({
        type: "interruption.closed",
        workspaceId: "ws-1",
        payload: {
          interruptionId: "int-2",
          incidentIssueId: "incident-1",
          interruptedIssueId: "task-1",
        },
      });
    });

    it("cleanupExpired on expired incident session closes open interruptions and emits interruption.closed", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:10:00.000Z"));
      const lastHeartbeat = new Date("2026-08-11T12:00:00.000Z");
      const startedAt = new Date("2026-08-11T11:58:00.000Z");
      const leaseEndsAt = new Date("2026-08-11T12:05:00.000Z");
      const expiredIncidentSession = {
        id: "s-inc-expired",
        memberId: "m-1",
        userId: "u-1",
        issueId: "incident-1",
        source: "mcp",
        startedAt,
        lastHeartbeat,
        issue: {
          key: "INC-1",
          type: "incident",
          project: { workspaceId: "ws-1" },
        },
      } as any;

      mockSessionFindMany.mockResolvedValue([expiredIncidentSession]);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-exp", durationS: 420 } as any);
      mockInterruptionFindMany.mockResolvedValue([
        {
          id: "int-exp-1",
          incidentIssueId: "incident-1",
          interruptedIssueId: "task-99",
          memberId: "m-1",
        },
      ] as any);
      mockInterruptionUpdateMany.mockResolvedValue({ count: 1 } as any);

      mockEmit.mockClear();
      await cleanupExpired();

      // Interruption closes at the same bounded lease end as its WorkSession.
      expect(mockInterruptionUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            incidentIssueId: "incident-1",
            memberId: "m-1",
            endedAt: null,
          }),
          data: { endedAt: leaseEndsAt },
        })
      );

      // interruption.closed event must be emitted
      const closedEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "interruption.closed"
      );
      expect(closedEmit).toBeDefined();
      expect(closedEmit![0]).toMatchObject({
        type: "interruption.closed",
        workspaceId: "ws-1",
        payload: {
          interruptionId: "int-exp-1",
          incidentIssueId: "incident-1",
          interruptedIssueId: "task-99",
          memberId: "m-1",
        },
      });
    });

    it("recordInterruption emits interruption.opened", async () => {
      // recordInterruption needs to look up both issues
      mockIssueFind.mockResolvedValueOnce(incidentIssue).mockResolvedValueOnce(taskIssue);
      mockInterruptionCreate.mockResolvedValue({
        id: "int-manual-1",
        incidentIssueId: "incident-1",
        interruptedIssueId: "task-1",
        memberId: "m-1",
      } as any);

      mockEmit.mockClear();
      await recordInterruption("INC-1", "KAN-99", "m-1", "manual");

      const openedEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "interruption.opened"
      );
      expect(openedEmit).toBeDefined();
      expect(openedEmit![0]).toMatchObject({
        type: "interruption.opened",
        workspaceId: "ws-1",
        payload: {
          interruptionId: "int-manual-1",
          incidentIssueId: "incident-1",
          interruptedIssueId: "task-1",
          memberId: "m-1",
        },
      });
    });
  });

  // ── Fix A (KAN-143): stopWork provenance — via fallback from session.source ──
  //
  // When stopWork is called without an explicit via param (e.g. MCP stop),
  // the WorkLog.via must be derived from the session's source field via normalizeVia.
  // When an explicit via IS provided, it still wins.

  describe("Fix A — stopWork via fallback from session.source", () => {
    it("uses normalizeVia(session.source) for WorkLog.via when no request via passed (source=claude-code)", async () => {
      const startedAt = new Date(Date.now() - 90_000);
      const sessionWithSource = { ...fakeSession, startedAt, source: "claude-code" };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(sessionWithSource);
      const fakeWorkLog = { id: "wl-provenance-1", durationS: 90 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      // No via argument passed (simulates MCP stop call without X-Kanon-Client)
      await stopWork("KAN-42", "user-1", "member-1");

      expect(mockWorkLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ via: "claude-code" }),
        })
      );
    });

    it("WorkLog.via is null when session.source='mcp' and no request via (mcp is transport, not identity)", async () => {
      const startedAt = new Date(Date.now() - 90_000);
      const sessionMcp = { ...fakeSession, startedAt, source: "mcp" };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(sessionMcp);
      const fakeWorkLog = { id: "wl-provenance-mcp", durationS: 90 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      await stopWork("KAN-42", "user-1", "member-1");

      expect(mockWorkLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ via: null }),
        })
      );
    });

    it("explicit request via still wins over session.source", async () => {
      const startedAt = new Date(Date.now() - 90_000);
      const sessionWithSource = { ...fakeSession, startedAt, source: "cursor" };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(sessionWithSource);
      const fakeWorkLog = { id: "wl-provenance-explicit", durationS: 90 };
      mockWorkLogCreate.mockResolvedValue(fakeWorkLog as any);

      // Explicit via: "claude-code" wins over session.source "cursor"
      await stopWork("KAN-42", "user-1", "member-1", "claude-code");

      expect(mockWorkLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ via: "claude-code" }),
        })
      );
    });

    it("positive sub-minute sessions preserve WorkLog provenance", async () => {
      const startedAt = new Date(Date.now() - 30_000);
      const sessionShort = { ...fakeSession, startedAt, source: "claude-code" };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(sessionShort);
      mockWorkLogCreate.mockResolvedValue({
        id: "wl-provenance-short",
        durationS: 30,
      } as any);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.workLog).toEqual({ id: "wl-provenance-short", durationS: 30 });
      expect(mockWorkLogCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ via: "claude-code", durationS: 30 }),
        })
      );
    });
  });

  // ── Fix B (KAN-143): auto-advance issue state on startWork ─────────────────
  //
  // startWork must transition backlog/todo → in_progress when opening a session.
  // Issues already in_progress/review/done must NOT be touched (idempotent).
  // The state update, activity, capture, and session reservation share one
  // transaction; post-commit projections are published afterward.

  describe("Fix B — auto-advance issue state on startWork", () => {
    it("transitions backlog issue to in_progress on startWork", async () => {
      const backlogIssue = { ...fakeIssue, state: "backlog", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(backlogIssue);
      mockLockedIssue("backlog");
      mockIssueUpdate.mockResolvedValue({ ...backlogIssue, state: "in_progress" } as any);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockIssueUpdate).toHaveBeenCalledWith({
        where: { id: "issue-1" },
        data: { state: "in_progress", completedAt: null },
      });
      expect(mockPublishStartWorkIssueMutationEffects).toHaveBeenCalledWith(
        expect.objectContaining({ transitioned: true, fromState: "backlog" })
      );
    });

    it("transitions todo issue to in_progress on startWork", async () => {
      const todoIssue = { ...fakeIssue, state: "todo", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(todoIssue);
      mockLockedIssue("todo");
      mockIssueUpdate.mockResolvedValue({ ...todoIssue, state: "in_progress" } as any);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockIssueUpdate).toHaveBeenCalledWith({
        where: { id: "issue-1" },
        data: { state: "in_progress", completedAt: null },
      });
    });

    it("does NOT transition in_progress issue (idempotent)", async () => {
      const inProgressIssue = { ...fakeIssue, state: "in_progress", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(inProgressIssue);
      mockLockedIssue("in_progress");
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockIssueUpdate).not.toHaveBeenCalled();
    });

    it("does NOT transition review issue", async () => {
      const reviewIssue = { ...fakeIssue, state: "review", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(reviewIssue);
      mockLockedIssue("review");
      mockSessionFindMany.mockResolvedValue([]);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockIssueUpdate).not.toHaveBeenCalled();
      expect(result.session).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("does NOT transition done issue", async () => {
      const doneIssue = { ...fakeIssue, state: "done", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(doneIssue);
      mockLockedIssue("done");
      mockSessionFindMany.mockResolvedValue([]);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockIssueUpdate).not.toHaveBeenCalled();
      expect(result.session).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("rolls back the reservation when the atomic issue transition fails", async () => {
      const backlogIssue = { ...fakeIssue, state: "backlog", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(backlogIssue);
      mockLockedIssue("backlog");
      mockSessionFindMany.mockResolvedValue([]);
      mockIssueUpdate.mockRejectedValueOnce(new Error("workflow guard blocked transition"));

      await expect(startWork("KAN-42", "member-1", "user-1", "mcp")).rejects.toThrow(
        "workflow guard blocked transition"
      );

      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("commits assignment and transition in one issue update", async () => {
      const backlogUnassigned = { ...fakeIssue, state: "backlog", assigneeId: null };
      mockIssueFind.mockResolvedValue(backlogUnassigned);
      mockLockedIssue("backlog", null);
      mockIssueUpdate.mockResolvedValue({
        ...backlogUnassigned,
        assigneeId: "member-1",
        state: "in_progress",
      } as any);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockIssueUpdate).toHaveBeenCalledWith({
        where: { id: "issue-1" },
        data: {
          assigneeId: "member-1",
          state: "in_progress",
          completedAt: null,
        },
      });
    });

    // ── FIX 1: generalize guard to all pre-in_progress states (ORDERED_STATES) ──

    it("transitions analysis issue to in_progress on startWork (FIX 1 generalization)", async () => {
      const analysisIssue = { ...fakeIssue, state: "analysis", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(analysisIssue);
      mockLockedIssue("analysis");
      mockIssueUpdate.mockResolvedValue({ ...analysisIssue, state: "in_progress" } as any);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockIssueUpdate).toHaveBeenCalledWith({
        where: { id: "issue-1" },
        data: { state: "in_progress", completedAt: null },
      });
    });

    // ── FIX 2: logger threading — logger?.error called on transition failure ──

    it("calls logger.error when transition fails (FIX 2: no silent swallow)", async () => {
      const backlogIssue = { ...fakeIssue, state: "backlog", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(backlogIssue);
      mockLockedIssue("backlog");
      mockSessionFindMany.mockResolvedValue([]);
      mockIssueUpdate.mockRejectedValueOnce(new Error("db down"));

      const logger = { info: vi.fn(), error: vi.fn() };
      await expect(
        startWork("KAN-42", "member-1", "user-1", "mcp", undefined, logger)
      ).rejects.toThrow("db down");

      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: "KAN-42" }),
        expect.stringContaining("transaction")
      );
    });

    it("propagates an atomic issue-transition failure without a logger", async () => {
      const backlogIssue = { ...fakeIssue, state: "backlog", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(backlogIssue);
      mockLockedIssue("backlog");
      mockSessionFindMany.mockResolvedValue([]);
      mockIssueUpdate.mockRejectedValueOnce(new Error("workflow guard"));

      await expect(startWork("KAN-42", "member-1", "user-1", "mcp")).rejects.toThrow(
        "workflow guard"
      );
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });
  });
});
