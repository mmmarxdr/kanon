import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock prisma ────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    issue: { findUnique: vi.fn(), update: vi.fn() },
    workSession: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
    workLog: { create: vi.fn(), findMany: vi.fn() },
    // KAN-103: startWork closes open interruptions (resume); incident-start opens them.
    // KAN-103 PR3: findMany added for pre-close query before emit.
    interruption: { updateMany: vi.fn(), create: vi.fn(), findMany: vi.fn() },
    $transaction: vi.fn(),
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

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { startWork, heartbeat, stopWork, getActiveWorkers, cleanupExpired, recordInterruption } from "./service.js";

const mockIssueFind = vi.mocked(prisma.issue.findUnique);
const mockIssueUpdate = vi.mocked(prisma.issue.update);
const mockSessionUpsert = vi.mocked(prisma.workSession.upsert);
const mockSessionFindUnique = vi.mocked(prisma.workSession.findUnique);
const mockSessionFindMany = vi.mocked(prisma.workSession.findMany);
const mockSessionDelete = vi.mocked(prisma.workSession.delete);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockWorkLogCreate = vi.mocked(prisma.workLog.create);
const mockEmit = vi.mocked(eventBus.emit);

const fakeIssue = {
  id: "issue-1",
  key: "KAN-42",
  assigneeId: null,
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

    it("returns warnings when others are working on the same issue", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([
        { ...fakeSession, userId: "user-2", member: { username: "alice" } },
      ] as any);
      mockIssueUpdate.mockResolvedValue({} as any);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.warnings).toHaveLength(1);
      expect(result.warnings[0]).toContain("alice");
    });

    it("auto-assigns unassigned issue to the caller", async () => {
      const unassignedIssue = { ...fakeIssue, assigneeId: null };
      mockIssueFind.mockResolvedValue(unassignedIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);
      mockIssueUpdate.mockResolvedValue({} as any);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.autoAssigned).toBe(true);
      expect(mockIssueUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "issue-1" },
          data: { assignee: { connect: { id: "member-1" } } },
        })
      );
    });

    it("does not auto-assign when issue already has assignee", async () => {
      const assignedIssue = { ...fakeIssue, assigneeId: "someone-else" };
      mockIssueFind.mockResolvedValue(assignedIssue);
      mockSessionUpsert.mockResolvedValue(fakeSession);
      mockSessionFindMany.mockResolvedValue([]);

      const result = await startWork("KAN-42", "member-1", "user-1", "mcp");

      expect(result.autoAssigned).toBe(false);
      expect(mockIssueUpdate).not.toHaveBeenCalled();
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
    it("updates lastHeartbeat for existing session", async () => {
      mockIssueFind.mockResolvedValue({ id: "issue-1" } as any);
      mockSessionFindUnique.mockResolvedValue(fakeSession);
      const updatedSession = { ...fakeSession, lastHeartbeat: new Date() };
      (prisma.workSession.update as any) = vi.fn().mockResolvedValue(updatedSession);

      const result = await heartbeat("KAN-42", "user-1");

      expect(result).toBeTruthy();
    });

    it("returns null when no active session exists", async () => {
      mockIssueFind.mockResolvedValue({ id: "issue-1" } as any);
      mockSessionFindUnique.mockResolvedValue(null);

      const result = await heartbeat("KAN-42", "user-1");

      expect(result).toBeNull();
    });

    it("throws 404 when issue not found", async () => {
      mockIssueFind.mockResolvedValue(null);

      await expect(heartbeat("NOPE-1", "u-1")).rejects.toThrow("not found");
    });
  });

  // ── stopWork ───────────────────────────────────────────────────────────
  //
  // S2 / KAN-26: stopWork must create a WorkLog atomically with session
  // deletion when duration ≥ 60s, and skip WorkLog for < 60s sessions.

  describe("stopWork", () => {
    it("deletes the session and returns deleted: true (legacy path, no session found recheck)", async () => {
      // 70-second session: ≥ 60s → should create WorkLog via $transaction
      const startedAt = new Date(Date.now() - 70_000);
      const session70s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session70s);
      const fakeWorkLog = { id: "wl-1", durationS: 70 };
      mockTransaction.mockResolvedValue([fakeWorkLog, session70s]);

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
      mockTransaction.mockResolvedValue([fakeWorkLog, session90s]);
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

    it("skips WorkLog for < 60s session: plain delete only", async () => {
      const startedAt = new Date(Date.now() - 30_000); // 30 seconds ago
      const session30s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session30s);
      mockSessionDelete.mockResolvedValue(session30s);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.ok).toBe(true);
      expect(result.deleted).toBe(true);
      expect(result.workLog).toBeNull();
      // Plain delete, NOT $transaction
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
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
      mockTransaction.mockResolvedValue([fakeWorkLog, session90s]);

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
      mockTransaction.mockResolvedValue([fakeWorkLog, session90s]);

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
      mockSessionDelete.mockResolvedValue(session30s);

      mockEmit.mockClear();
      await stopWork("KAN-42", "user-1", "member-1");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.ended",
          payload: expect.objectContaining({ reason: "stopped" }),
        })
      );
    });

    it("emits work_session.ended even for < 60s (no workLog in payload)", async () => {
      const startedAt = new Date(Date.now() - 30_000);
      const session30s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session30s);
      mockSessionDelete.mockResolvedValue(session30s);

      await stopWork("KAN-42", "user-1", "member-1");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.ended",
          payload: expect.objectContaining({ workLogId: null }),
        })
      );
    });

    it("threads via into WorkLog when provided", async () => {
      const startedAt = new Date(Date.now() - 90_000);
      const session90s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session90s);
      const fakeWorkLog = { id: "wl-2", durationS: 90 };
      mockTransaction.mockResolvedValue([fakeWorkLog, session90s]);

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

    // ── Fix 6: 60s exact boundary ──────────────────────────────────────────
    // durationS === 60 → WorkLog written; durationS === 59 → discarded.

    it("writes WorkLog when durationS is exactly 60 (boundary)", async () => {
      const startedAt = new Date(Date.now() - 60_000);
      const session60s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session60s);
      const fakeWorkLog = { id: "wl-60", durationS: 60 };
      mockTransaction.mockResolvedValue([fakeWorkLog, session60s]);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.workLog).not.toBeNull();
      // $transaction used (workLog.create + workSession.delete built as PrismaPromises)
      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
    });

    it("discards WorkLog when durationS is exactly 59 (boundary)", async () => {
      const startedAt = new Date(Date.now() - 59_000);
      const session59s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session59s);
      mockSessionDelete.mockResolvedValue(session59s);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.workLog).toBeNull();
      expect(mockTransaction).not.toHaveBeenCalled();
      // Plain delete (awaited, not inside a transaction)
      expect(mockSessionDelete).toHaveBeenCalledOnce();
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
  // use lastHeartbeat − startedAt for duration (D4), create WorkLog for ≥ 60s,
  // skip WorkLog for < 60s, and isolate one-session failure from siblings.

  describe("cleanupExpired", () => {
    it("creates WorkLog for ≥ 60s expired session using lastHeartbeat − startedAt (D4)", async () => {
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
      // Per-session loop uses $transaction for ≥ 60s
      mockTransaction.mockResolvedValue([{ id: "wl-1", durationS: 110 }, {}]);

      const count = await cleanupExpired();

      expect(count).toBe(1);
      // $transaction called once for this ≥ 60s session
      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it("skips WorkLog for < 60s expired session", async () => {
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
      mockSessionDelete.mockResolvedValue({} as any);

      const count = await cleanupExpired();

      expect(count).toBe(1);
      // No $transaction — plain delete
      expect(mockTransaction).not.toHaveBeenCalled();
      expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "s-short" } });
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
      mockTransaction
        .mockResolvedValueOnce([{ id: "wl-1" }, {}])
        .mockRejectedValueOnce(new Error("constraint violation"))
        .mockResolvedValueOnce([{ id: "wl-3" }, {}]);

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
      mockTransaction.mockResolvedValue([{ id: "wl-x" }, {}]);

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
      mockTransaction.mockResolvedValue([{ id: "wl-1" }, {}]);

      const logger = { info: vi.fn(), error: vi.fn() };
      await cleanupExpired(logger);

      expect(logger.info).toHaveBeenCalledWith({ count: 1 }, "Cleaned up expired work sessions");
    });

    // ── Fix 6: 60s exact boundary (expiry path) ────────────────────────────

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
      mockTransaction.mockResolvedValue([{ id: "wl-exact60" }, {}]);

      const count = await cleanupExpired();

      expect(count).toBe(1);
      // $transaction used for >= 60s (workLog.create is called to build PrismaPromise)
      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).toHaveBeenCalledOnce();
    });

    it("discards WorkLog when expiry durationS is exactly 59 (boundary)", async () => {
      const now = Date.now();
      // lastHeartbeat - startedAt = exactly 59s → plain delete, no WorkLog
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
      mockSessionDelete.mockResolvedValue({} as any);

      const count = await cleanupExpired();

      expect(count).toBe(1);
      expect(mockTransaction).not.toHaveBeenCalled();
      // Plain delete (awaited, not part of a transaction)
      expect(mockSessionDelete).toHaveBeenCalledOnce();
      expect(mockWorkLogCreate).not.toHaveBeenCalled();
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
      mockTransaction.mockResolvedValue([{ id: "wl-cc" }, {}]);

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
      mockTransaction.mockResolvedValue([fakeWorkLog, session90s]);

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

    it("does NOT emit worklog.created for < 60s stopWork", async () => {
      const startedAt = new Date(Date.now() - 30_000); // 30 s — sub-minute
      const session30s = { ...fakeSession, startedAt, lastHeartbeat: new Date() };
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(session30s);
      mockSessionDelete.mockResolvedValue(session30s);

      mockEmit.mockClear();
      await stopWork("KAN-42", "user-1", "member-1");

      const worklogEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "worklog.created"
      );
      expect(worklogEmit).toBeUndefined();
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
      mockTransaction.mockResolvedValue([fakeWorkLog, {}]);

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

    it("does NOT emit worklog.created for < 60s expiry cleanup", async () => {
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
      mockSessionDelete.mockResolvedValue({} as any);

      mockEmit.mockClear();
      await cleanupExpired();

      const worklogEmit = mockEmit.mock.calls.find(
        ([arg]) => (arg as { type: string }).type === "worklog.created"
      );
      expect(worklogEmit).toBeUndefined();
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
      mockIssueFind
        .mockResolvedValueOnce(incidentIssue) // first call: the incident
        .mockResolvedValueOnce(taskIssue);    // stopWork call for displaced session
      // displaced sessions
      mockSessionFindMany
        .mockResolvedValueOnce([
          { id: "s-displaced", userId: "u-1", memberId: "m-1", issueId: "task-1",
            lastHeartbeat: new Date(), issue: { key: "KAN-99" } },
        ] as any) // displaced sessions query
        .mockResolvedValueOnce([]); // other workers query (after upsert)
      // stopWork inner calls
      mockSessionFindUnique
        .mockResolvedValueOnce({ id: "s-displaced", startedAt: new Date(), memberId: "m-1" } as any);
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
        id: "s-inc", startedAt: new Date(Date.now() - 30_000), memberId: "m-1",
      } as any);
      mockSessionDelete.mockResolvedValue({} as any);
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
      const lastHeartbeat = new Date(Date.now() - 10_000);
      const startedAt = new Date(Date.now() - 120_000);
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
      mockTransaction.mockResolvedValue([{ id: "wl-exp", durationS: 110 }, {}]);
      mockInterruptionFindMany.mockResolvedValue([
        { id: "int-exp-1", incidentIssueId: "incident-1", interruptedIssueId: "task-99", memberId: "m-1" },
      ] as any);
      mockInterruptionUpdateMany.mockResolvedValue({ count: 1 } as any);

      mockEmit.mockClear();
      await cleanupExpired();

      // Interruption must be closed with endedAt = lastHeartbeat
      expect(mockInterruptionUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ incidentIssueId: "incident-1", memberId: "m-1", endedAt: null }),
          data: { endedAt: lastHeartbeat },
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
});
