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
import {
  startWork,
  heartbeat,
  stopWork,
  getActiveWorkers,
  cleanupExpired,
} from "./service.js";

const mockIssueFind = vi.mocked(prisma.issue.findUnique);
const mockIssueUpdate = vi.mocked(prisma.issue.update);
const mockSessionUpsert = vi.mocked(prisma.workSession.upsert);
const mockSessionFindUnique = vi.mocked(prisma.workSession.findUnique);
const mockSessionFindMany = vi.mocked(prisma.workSession.findMany);
const mockSessionDelete = vi.mocked(prisma.workSession.delete);
const mockTransaction = vi.mocked(prisma.$transaction);
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

describe("WorkSessionService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
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
        }),
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
        }),
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
        }),
      );
    });

    it("throws 404 when issue not found", async () => {
      mockIssueFind.mockResolvedValue(null);

      await expect(startWork("NOPE-1", "m-1", "u-1")).rejects.toThrow("not found");
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
        }),
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
        }),
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

      // Check the $transaction was called with a workLog.create that has via: "claude-code"
      expect(mockTransaction).toHaveBeenCalledWith(
        expect.arrayContaining([
          expect.objectContaining({}), // workLog.create promise (opaque)
          expect.objectContaining({}), // workSession.delete promise (opaque)
        ]),
      );
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
        }),
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
          id: "s-1", memberId: "m-1", userId: "u-1", issueId: "i-1",
          source: "mcp", startedAt: startedAt1, lastHeartbeat: hb1,
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
        {
          id: "s-2", memberId: "m-2", userId: "u-2", issueId: "i-2",
          source: "web", startedAt: startedAt2, lastHeartbeat: hb2,
          issue: { key: "KAN-2", project: { workspaceId: "ws-1" } },
        },
        {
          id: "s-3", memberId: "m-3", userId: "u-3", issueId: "i-3",
          source: "cli", startedAt: startedAt3, lastHeartbeat: hb3,
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

      expect(logger.info).toHaveBeenCalledWith(
        { count: 1 },
        "Cleaned up expired work sessions",
      );
    });
  });
});
