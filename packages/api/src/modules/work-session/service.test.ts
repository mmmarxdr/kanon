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
    workLog: { create: vi.fn(), findMany: vi.fn() },
    // KAN-103: startWork closes open interruptions (resume); incident-start opens them.
    // KAN-103 PR3: findMany added for pre-close query before emit.
    interruption: { updateMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
    $queryRaw: vi.fn(),
  },
}));

// ── Mock eventBus ──────────────────────────────────────────────────────────
vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: { emit: vi.fn() },
}));

// ── Mock activity log ──────────────────────────────────────────────────────
vi.mock("../activity/service.js", () => ({
  createActivityLog: vi.fn(),
}));

// ── Mock issue service (for Fix B: auto-transition) ────────────────────────
vi.mock("../issue/service.js", () => ({
  transitionIssue: vi.fn(),
  updateIssue: vi.fn(),
}));

vi.mock("../schedule/service.js", () => ({
  upsertPlan: vi.fn(),
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import {
  captureTransitionInterval,
  stageTransitionStart,
  startWork,
  heartbeat,
  stopWork,
  getActiveWorkers,
  cleanupExpired,
  recordInterruption,
} from "./service.js";
import { transitionIssue, updateIssue } from "../issue/service.js";
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
const mockTransaction = vi.mocked(prisma.$transaction);
const mockQueryRaw = vi.mocked(prisma.$queryRaw);
const mockWorkLogCreate = vi.mocked(prisma.workLog.create);
const mockEmit = vi.mocked(eventBus.emit);
const mockUpdateIssue = vi.mocked(updateIssue);
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

const mockInterruptionFindManyGlobal = vi.mocked(prisma.interruption.findMany);
const mockInterruptionUpdateManyGlobal = vi.mocked(prisma.interruption.updateMany);
const mockInterruptionCreateGlobal = vi.mocked(prisma.interruption.create);

describe("WorkSessionService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    // KAN-103 PR3: safe default — no open interruptions unless a test explicitly overrides.
    mockInterruptionFindManyGlobal.mockResolvedValue([]);
    mockInterruptionUpdateManyGlobal.mockResolvedValue({ count: 0 } as any);
    // KAN-160: default — no other active worker on the issue unless a test sets one.
    mockSessionFindFirst.mockResolvedValue(null as any);
    mockSessionFindMany.mockResolvedValue([] as any);
    mockSessionDeleteMany.mockResolvedValue({ count: 1 } as any);
    mockSessionCreate.mockResolvedValue(fakeSession);
    mockWorkLogCreate.mockResolvedValue({ id: "wl-default" } as any);
    mockQueryRaw.mockResolvedValue([{ state: "in_progress" }] as any);
    mockTransaction.mockImplementation(async (operation: any) => {
      if (typeof operation === "function") return operation(prisma);
      return Promise.all(operation);
    });
    mockUpdateIssue.mockResolvedValue({} as any);
    mockUpsertPlan.mockResolvedValue({} as any);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ── startWork ──────────────────────────────────────────────────────────

  describe("startWork", () => {
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

    it("does not regress a newer heartbeat when a delayed transition start arrives", async () => {
      const transitionAt = new Date("2026-08-11T12:00:00.000Z");
      const existing = {
        ...fakeSession,
        startedAt: new Date("2026-08-11T12:01:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:04:00.000Z"),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(existing);
      mockSessionUpsert.mockResolvedValue(existing);

      await startWork(
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
        },
      );

      expect(mockSessionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastHeartbeat: existing.lastHeartbeat }),
        }),
      );
      expect(mockSessionUpsert).not.toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastHeartbeat: transitionAt }),
        }),
      );
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
        $queryRaw: vi.fn().mockResolvedValue([{ state: "in_progress" }]),
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

      await expect(
        startWork("KAN-42", "member-1", "user-1", "mcp"),
      ).rejects.toThrow("replacement failed");

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
        $queryRaw: vi.fn().mockResolvedValue([{ state: "in_progress" }]),
        workSession: {
          findUnique: vi.fn()
            .mockResolvedValueOnce(stale)
            .mockResolvedValueOnce(newer),
          deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
          create: vi.fn(),
          upsert: vi.fn().mockResolvedValue(adopted),
        },
        workLog: { create: vi.fn() },
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
        { autoAssign: false, onConflict: "skip" },
      );

      // No throw, no second session opened.
      expect(result.session).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("auto-assigns unassigned issue to the caller", async () => {
      const unassignedIssue = { ...fakeIssue, assigneeId: null };
      mockIssueFind.mockResolvedValue(unassignedIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.autoAssigned).toBe(true);
      expect(mockUpdateIssue).toHaveBeenCalledWith(
        "KAN-42",
        { assigneeId: "member-1" },
        "member-1",
        null,
      );
    });

    it("does not auto-assign when issue already has assignee", async () => {
      const assignedIssue = { ...fakeIssue, assigneeId: "someone-else" };
      mockIssueFind.mockResolvedValue(assignedIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.autoAssigned).toBe(false);
      expect(mockUpdateIssue).not.toHaveBeenCalled();
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
        { startDateIfMissing: true },
      );
      vi.useRealTimers();
    });

    it("emits work_session.started event", async () => {
      mockIssueFind.mockResolvedValue({ ...fakeIssue, assigneeId: "existing" });
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.started",
          workspaceId: "ws-1",
          actorId: "member-1",
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

      const result = await heartbeat("INC-1", "user-1");

      expect(result).toEqual(refreshed);
      expect(mockSessionFindMany).not.toHaveBeenCalled();
      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockInterruptionCreateGlobal).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
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

      const result = await heartbeat("KAN-42", "user-1");

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
        workSession: {
          findUnique: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(null),
          deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
          create: vi.fn(),
          upsert: vi.fn().mockResolvedValue(replacement),
        },
        workLog: { create: vi.fn() },
        interruption: { findMany: vi.fn(), updateMany: vi.fn() },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockTransaction.mockImplementation(async (operation: any) => operation(tx));

      const result = await heartbeat("KAN-42", "user-1");

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
      };
      mockIssueFind
        .mockResolvedValueOnce(fakeIssue)
        .mockResolvedValueOnce({ ...fakeIssue, state: "review" });
      mockSessionFindUnique.mockResolvedValue(null);
      mockTransaction.mockImplementation(async (operation: any) => operation(tx));

      // The close handler has already snapshotted session A. Its identity-aware
      // stop will no-op after heartbeat claims A, so heartbeat must not leave B.
      const heartbeatResult = await heartbeat("KAN-42", "user-1");
      const closeResult = await stopWork(
        "KAN-42",
        "user-1",
        "member-1",
        null,
        new Date("2026-08-11T12:09:00.000Z"),
        stale.id,
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
      const tx = {
        $queryRaw: vi.fn()
          .mockResolvedValueOnce([{ state: "in_progress" }])
          .mockResolvedValueOnce([{ state: "review" }]),
        workSession: {
          findUnique: vi.fn()
            .mockResolvedValueOnce(stale)
            .mockResolvedValueOnce(null),
          deleteMany: vi.fn().mockResolvedValueOnce({ count: 0 }),
          create: vi.fn(),
          upsert: vi.fn().mockResolvedValue(replacement),
        },
        workLog: { create: vi.fn() },
        interruption: { findMany: vi.fn(), updateMany: vi.fn() },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockTransaction.mockImplementation(async (operation: any) => operation(tx));

      const result = await heartbeat("KAN-42", "user-1");

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
        workSession: {
          findUnique: vi.fn().mockResolvedValueOnce(stale).mockResolvedValueOnce(null),
          deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
          create: vi.fn().mockResolvedValue(replacement),
          updateMany: vi.fn(),
        },
        workLog: {
          create: vi.fn().mockResolvedValue({ id: "wl-heartbeat", durationS: 300 }),
        },
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(stale);
      mockTransaction.mockImplementation(async (operation: any) => {
        expect(typeof operation).toBe("function");
        return operation(tx);
      });

      const result = await heartbeat("KAN-42", "user-1");

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
    });

    it("updates lastHeartbeat for existing session", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(fakeSession);
      const updatedSession = { ...fakeSession, lastHeartbeat: new Date() };
      mockSessionUpsert.mockResolvedValue(updatedSession);

      const result = await heartbeat("KAN-42", "user-1");

      expect(result).toBe(updatedSession);
      expect(mockSessionUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          update: expect.objectContaining({ lastHeartbeat: expect.any(Date) }),
        }),
      );
    });

    it("returns null when no active session exists", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(null);

      const result = await heartbeat("KAN-42", "user-1");

      expect(result).toBeNull();
    });

    it("throws 404 when issue not found", async () => {
      mockIssueFind.mockResolvedValue(null);

      await expect(heartbeat("NOPE-1", "u-1")).rejects.toThrow("not found");
    });
  });

  describe("captureTransitionInterval", () => {
    it("writes exactly one positive WorkLog bounded by the active-entry and close timestamps", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const observedAt = new Date("2026-08-11T12:02:00.000Z");
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-historical-transition" } as any);

      const result = await captureTransitionInterval(
        "KAN-42",
        "user-1",
        "member-1",
        startedAt,
        observedAt,
        "transition-listener",
      );

      expect(result.workLog).toEqual({ id: "wl-historical-transition", durationS: 120 });
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: {
          startedAt,
          endedAt: observedAt,
          durationS: 120,
          reason: "stopped",
          via: null,
          issueId: "issue-1",
          memberId: "member-1",
        },
      });
    });
  });

  describe("stageTransitionStart", () => {
    it("does not let expired or historical rows hide active foreign ownership", async () => {
      const startedAt = new Date("2026-08-11T12:10:00.000Z");
      const historical = {
        ...fakeSession,
        id: "historical-session-worker-c",
        userId: "user-c",
        memberId: "member-c",
        source: "historical-transition:transition-listener",
        startedAt: new Date("2026-08-11T11:55:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T11:55:00.000Z"),
      };
      const expiredForeign = {
        ...fakeSession,
        id: "expired-session-worker-b",
        userId: "user-b",
        memberId: "member-b",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:04:00.000Z"),
      };
      const activeForeign = {
        ...fakeSession,
        id: "active-session-worker-d",
        userId: "user-d",
        memberId: "member-d",
        startedAt: new Date("2026-08-11T12:02:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:09:00.000Z"),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindFirst.mockResolvedValue(expiredForeign as any);
      mockSessionFindMany.mockResolvedValue([
        historical,
        expiredForeign,
        activeForeign,
      ] as any);

      const result = await stageTransitionStart(
        "KAN-42",
        "user-a",
        "member-a",
        startedAt,
      );

      expect(result.session).toBeNull();
      expect(mockSessionFindMany).toHaveBeenCalledWith({
        where: { issueId: "issue-1" },
        orderBy: [{ startedAt: "asc" }, { id: "asc" }],
      });
      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
      expect(mockSessionCreate).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalled();
    });

    it("persists exact historical start evidence without overlapping another worker", async () => {
      mockIssueFind.mockResolvedValue({ id: "issue-1" } as any);
      mockSessionFindMany.mockResolvedValue([{
        ...fakeSession,
        id: "session-worker-b",
        userId: "user-b",
        memberId: "member-b",
      }] as any);

      const result = await stageTransitionStart(
        "KAN-42",
        "user-a",
        "member-a",
        new Date("2026-08-11T12:00:00.000Z"),
      );

      expect(result.session).toBeNull();
      expect(mockSessionCreate).not.toHaveBeenCalled();
    });

    it("finalizes an expired foreign lease before staging a distinct historical marker", async () => {
      const startedAt = new Date("2026-08-11T12:10:00.000Z");
      const expiredForeign = {
        ...fakeSession,
        id: "session-worker-b",
        userId: "user-b",
        memberId: "member-b",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:04:00.000Z"),
      };
      const staged = {
        ...fakeSession,
        id: "historical-session-worker-a",
        userId: "user-a",
        memberId: "member-a",
        source: "historical-transition:transition-listener",
        startedAt,
        lastHeartbeat: startedAt,
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindMany.mockResolvedValue([expiredForeign] as any);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-worker-b" } as any);
      mockSessionCreate.mockResolvedValue(staged);

      const result = await stageTransitionStart(
        "KAN-42",
        "user-a",
        "member-a",
        startedAt,
      );

      expect(result.session).toEqual(staged);
      expect(mockSessionDeleteMany).toHaveBeenCalledOnce();
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: {
          id: expiredForeign.id,
          lastHeartbeat: expiredForeign.lastHeartbeat,
        },
      });
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: {
          startedAt: expiredForeign.startedAt,
          endedAt: new Date("2026-08-11T12:09:00.000Z"),
          durationS: 540,
          reason: "expired",
          via: null,
          issueId: "issue-1",
          memberId: "member-b",
        },
      });
      expect(mockSessionCreate).toHaveBeenCalledOnce();
      expect(mockSessionCreate).toHaveBeenCalledWith({
        data: {
          userId: "user-a",
          issueId: "issue-1",
          memberId: "member-a",
          source: "historical-transition:transition-listener",
          startedAt,
          lastHeartbeat: startedAt,
        },
      });
    });

    it("marks staged transition evidence as historical rather than renewable work", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      mockIssueFind.mockResolvedValue({ id: "issue-1" } as any);
      mockSessionFindMany.mockResolvedValue([]);
      mockSessionCreate.mockResolvedValue({
        ...fakeSession,
        source: "historical-transition:transition-listener",
        startedAt,
        lastHeartbeat: startedAt,
      });

      await stageTransitionStart("KAN-42", "user-1", "member-1", startedAt);

      expect(mockSessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          source: "historical-transition:transition-listener",
          startedAt,
          lastHeartbeat: startedAt,
        }),
      });
    });

    it("keeps a later same-user start in a distinct generation", async () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-11T12:02:00.000Z"));
      const historical = {
        ...fakeSession,
        id: "historical-session",
        source: "historical-transition:transition-listener",
        startedAt: new Date("2026-08-11T12:00:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:00:00.000Z"),
      };
      const live = {
        ...fakeSession,
        id: "live-session",
        source: "mcp",
        startedAt: new Date("2026-08-11T12:02:00.000Z"),
        lastHeartbeat: new Date("2026-08-11T12:02:00.000Z"),
      };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(historical);
      mockSessionCreate.mockResolvedValue(live);
      mockWorkLogCreate.mockResolvedValue({ id: "wl-historical" } as any);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.session).toEqual(live);
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: { id: historical.id, lastHeartbeat: historical.lastHeartbeat },
      });
      expect(mockWorkLogCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt: historical.startedAt,
          endedAt: new Date("2026-08-11T12:02:00.000Z"),
          durationS: 120,
        }),
      });
      expect(mockSessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({
          startedAt: new Date("2026-08-11T12:02:00.000Z"),
          lastHeartbeat: new Date("2026-08-11T12:02:00.000Z"),
        }),
      });
    });

    it("does not let historical evidence block another worker", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindMany.mockResolvedValue([]);
      mockSessionUpsert.mockResolvedValue(fakeSession);

      await startWork("KAN-42", "member-2", "user-2", "mcp");

      expect(mockSessionFindFirst).toHaveBeenCalledWith({
        where: expect.objectContaining({
          issueId: "issue-1",
          userId: { not: "user-2" },
          NOT: {
            source: { startsWith: "historical-transition:" },
          },
        }),
        select: { member: { select: { username: true } } },
      });
    });

    it("retries serialization failures before durably staging the exact boundary", async () => {
      const startedAt = new Date("2026-08-11T12:00:00.000Z");
      const staged = {
        ...fakeSession,
        id: "historical-session",
        startedAt,
        lastHeartbeat: startedAt,
      };
      mockIssueFind.mockResolvedValue({ id: "issue-1" } as any);
      mockSessionFindFirst.mockResolvedValue(null);
      mockSessionCreate.mockResolvedValue(staged);
      const conflict = new Error("transient storage failure");
      mockTransaction.mockRejectedValueOnce(conflict).mockRejectedValueOnce(conflict);

      const result = await stageTransitionStart(
        "KAN-42",
        "user-1",
        "member-1",
        startedAt,
      );

      expect(result.session).toEqual(staged);
      expect(mockTransaction).toHaveBeenCalledTimes(3);
      expect(mockSessionCreate).toHaveBeenCalledWith({
        data: expect.objectContaining({ startedAt, lastHeartbeat: startedAt }),
      });
    });
  });

  // ── stopWork ───────────────────────────────────────────────────────────
  //
  // stopWork persists every positive whole-second duration atomically with
  // session deletion. Zero-second windows are deleted without a WorkLog.

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

      const result = await stopWork(
        "KAN-42",
        "user-1",
        "member-1",
        null,
        observedAt,
        refreshed.id,
      );

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
        workSession: {
          deleteMany: vi.fn().mockResolvedValue({ count: 0 }),
        },
        workLog: { create: vi.fn() },
        interruption: { findMany: vi.fn(), updateMany: vi.fn() },
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
      expect(mockSessionDelete).not.toHaveBeenCalled();
      expect(mockEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "work_session.ended" }),
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
          { id: "s-displaced", userId: "u-1", memberId: "m-1", issueId: "task-1",
            startedAt: new Date(), source: "mcp",
            lastHeartbeat: new Date(), issue: { key: "KAN-99" } },
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
          { id: "s-displaced", userId: "u-1", memberId: "m-1", issueId: "task-1",
            startedAt: new Date(), source: "mcp",
            lastHeartbeat: new Date(), issue: { key: "KAN-99" } },
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
        "second interruption failed",
      );

      expect(mockTransaction).toHaveBeenCalledTimes(1);
      expect(mockSessionUpsert).toHaveBeenCalledOnce();
      expect(mockSessionDeleteMany).toHaveBeenCalledTimes(2);
      expect(mockEmit).not.toHaveBeenCalledWith(
        expect.objectContaining({ type: "interruption.opened" }),
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
          ([event]) => (event as { type: string }).type === "interruption.opened",
        ),
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
            (event as { payload?: { interruptedIssueId?: string } }).payload
              ?.interruptedIssueId === historicalSibling.issueId,
        ),
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
        expect.objectContaining({ type: "interruption.closed" }),
      );
      expect(
        mockEmit.mock.calls.filter(
          ([event]) =>
            (event as { type: string; payload?: { interruptionId?: string } }).type ===
              "interruption.closed" &&
            (event as { payload?: { interruptionId?: string } }).payload?.interruptionId ===
              openInterruption.id,
        ),
      ).toHaveLength(1);
      expect(
        mockEmit.mock.calls.filter(
          ([event]) =>
            (event as { type: string; payload?: { interruptionId?: string } }).type ===
              "interruption.opened" &&
            (event as { payload?: { interruptionId?: string } }).payload?.interruptionId ===
              "incident-a-open-interruption",
        ),
      ).toHaveLength(1);
    });

    it("startWork (resume) emits interruption.closed for each open interruption closed", async () => {
      mockIssueFind.mockResolvedValue(taskIssue);
      mockSessionUpsert.mockResolvedValue({ id: "s-1" } as any);
      mockSessionFindMany.mockResolvedValue([]); // no other workers
      mockInterruptionFindMany.mockResolvedValue([
        { id: "int-1", incidentIssueId: "incident-1", interruptedIssueId: "task-1", memberId: "m-1" },
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
        { id: "int-2", incidentIssueId: "incident-1", interruptedIssueId: "task-1", memberId: "m-1" },
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
        { id: "int-exp-1", incidentIssueId: "incident-1", interruptedIssueId: "task-99", memberId: "m-1" },
      ] as any);
      mockInterruptionUpdateMany.mockResolvedValue({ count: 1 } as any);

      mockEmit.mockClear();
      await cleanupExpired();

      // Interruption closes at the same bounded lease end as its WorkSession.
      expect(mockInterruptionUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ incidentIssueId: "incident-1", memberId: "m-1", endedAt: null }),
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
      mockIssueFind
        .mockResolvedValueOnce(incidentIssue)
        .mockResolvedValueOnce(taskIssue);
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
        }),
      );
    });
  });

  // ── Fix B (KAN-143): auto-advance issue state on startWork ─────────────────
  //
  // startWork must transition backlog/todo → in_progress when opening a session.
  // Issues already in_progress/review/done must NOT be touched (idempotent).
  // The transition must use transitionIssue (issue service) so ActivityLog +
  // issue.transitioned event fire consistently.

  describe("Fix B — auto-advance issue state on startWork", () => {
    const mockTransitionIssue = vi.mocked(transitionIssue);

    beforeEach(() => {
      mockTransitionIssue.mockResolvedValue({} as any);
    });

    it("transitions backlog issue to in_progress on startWork", async () => {
      const backlogIssue = { ...fakeIssue, state: "backlog", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(backlogIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      // via is null when source="mcp" (transport, not identity) and no explicit via passed
      // KAN-156: cause="start_work" is threaded to prevent the circular guard loop
      expect(mockTransitionIssue).toHaveBeenCalledWith(
        "KAN-42",
        "in_progress",
        "member-1",
        null,
        "start_work",
      );
    });

    it("transitions todo issue to in_progress on startWork", async () => {
      const todoIssue = { ...fakeIssue, state: "todo", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(todoIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      // KAN-156: cause="start_work" is threaded to prevent the circular guard loop
      expect(mockTransitionIssue).toHaveBeenCalledWith(
        "KAN-42",
        "in_progress",
        "member-1",
        null,
        "start_work",
      );
    });

    it("does NOT transition in_progress issue (idempotent)", async () => {
      const inProgressIssue = { ...fakeIssue, state: "in_progress", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(inProgressIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockTransitionIssue).not.toHaveBeenCalled();
    });

    it("does NOT transition review issue", async () => {
      const reviewIssue = { ...fakeIssue, state: "review", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(reviewIssue);
      mockQueryRaw.mockResolvedValue([{ state: "review" }] as any);
      mockSessionFindMany.mockResolvedValue([]);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockTransitionIssue).not.toHaveBeenCalled();
      expect(result.session).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("does NOT transition done issue", async () => {
      const doneIssue = { ...fakeIssue, state: "done", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(doneIssue);
      mockQueryRaw.mockResolvedValue([{ state: "done" }] as any);
      mockSessionFindMany.mockResolvedValue([]);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(mockTransitionIssue).not.toHaveBeenCalled();
      expect(result.session).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("swallows transition error but does not open while the issue remains backlog", async () => {
      const backlogIssue = { ...fakeIssue, state: "backlog", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(backlogIssue);
      mockQueryRaw.mockResolvedValue([{ state: "backlog" }] as any);
      mockSessionFindMany.mockResolvedValue([]);
      mockTransitionIssue.mockRejectedValueOnce(new Error("workflow guard blocked transition"));

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.session).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
    });

    it("auto-assign fires before transition (assign first, then move to in_progress)", async () => {
      const backlogUnassigned = { ...fakeIssue, state: "backlog", assigneeId: null };
      mockIssueFind.mockResolvedValue(backlogUnassigned);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      const callOrder: string[] = [];
      mockUpdateIssue.mockImplementation(async () => { callOrder.push("assign"); return {} as any; });
      mockTransitionIssue.mockImplementation(async () => { callOrder.push("transition"); return {} as any; });

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(callOrder).toEqual(["assign", "transition"]);
    });

    // ── FIX 1: generalize guard to all pre-in_progress states (ORDERED_STATES) ──

    it("transitions analysis issue to in_progress on startWork (FIX 1 generalization)", async () => {
      const analysisIssue = { ...fakeIssue, state: "analysis", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(analysisIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      await startWork("KAN-42", "member-1", "user-1", "mcp");

      // KAN-156: cause="start_work" is threaded to prevent the circular guard loop
      expect(mockTransitionIssue).toHaveBeenCalledWith(
        "KAN-42",
        "in_progress",
        "member-1",
        null,
        "start_work",
      );
    });

    // ── FIX 2: logger threading — logger?.error called on transition failure ──

    it("calls logger.error when transition fails (FIX 2: no silent swallow)", async () => {
      const backlogIssue = { ...fakeIssue, state: "backlog", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(backlogIssue);
      mockQueryRaw.mockResolvedValue([{ state: "backlog" }] as any);
      mockSessionFindMany.mockResolvedValue([]);
      mockTransitionIssue.mockRejectedValueOnce(new Error("db down"));

      const logger = { info: vi.fn(), error: vi.fn() };
      const result = await startWork("KAN-42", "member-1", "user-1", "mcp", undefined, logger);

      expect(result.session).toBeNull();
      expect(mockSessionUpsert).not.toHaveBeenCalled();
      // Error was logged
      expect(logger.error).toHaveBeenCalledOnce();
      expect(logger.error).toHaveBeenCalledWith(
        expect.objectContaining({ issueKey: "KAN-42" }),
        expect.stringContaining("auto-transition"),
      );
    });

    it("does not throw when no logger provided and transition fails (backward-compat)", async () => {
      const backlogIssue = { ...fakeIssue, state: "backlog", assigneeId: "existing" };
      mockIssueFind.mockResolvedValue(backlogIssue);
      mockQueryRaw.mockResolvedValue([{ state: "backlog" }] as any);
      mockSessionFindMany.mockResolvedValue([]);
      mockTransitionIssue.mockRejectedValueOnce(new Error("workflow guard"));

      // No logger argument — must not throw
      await expect(startWork("KAN-42", "member-1", "user-1", "mcp")).resolves.toBeTruthy();
    });
  });
});
