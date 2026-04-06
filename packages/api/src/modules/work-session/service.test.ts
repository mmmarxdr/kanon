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
const mockSessionDeleteMany = vi.mocked(prisma.workSession.deleteMany);
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

  describe("stopWork", () => {
    it("deletes the session and returns deleted: true", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(fakeSession);
      mockSessionDelete.mockResolvedValue(fakeSession);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.ok).toBe(true);
      expect(result.deleted).toBe(true);
      expect(mockSessionDelete).toHaveBeenCalledWith({ where: { id: "session-1" } });
    });

    it("returns deleted: false when no session exists", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(null);

      const result = await stopWork("KAN-42", "user-1", "member-1");

      expect(result.ok).toBe(true);
      expect(result.deleted).toBe(false);
    });

    it("emits work_session.ended event on deletion", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockSessionFindUnique.mockResolvedValue(fakeSession);
      mockSessionDelete.mockResolvedValue(fakeSession);

      await stopWork("KAN-42", "user-1", "member-1");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.ended",
          workspaceId: "ws-1",
        }),
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
          member: { username: "alice" },
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

  describe("cleanupExpired", () => {
    it("deletes expired sessions and returns count", async () => {
      const expiredSessions = [
        {
          id: "s-1",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
        {
          id: "s-2",
          memberId: "m-2",
          userId: "u-2",
          issueId: "i-2",
          issue: { key: "KAN-2", project: { workspaceId: "ws-1" } },
        },
      ] as any;

      mockSessionFindMany.mockResolvedValue(expiredSessions);
      mockSessionDeleteMany.mockResolvedValue({ count: 2 } as any);

      const count = await cleanupExpired();

      expect(count).toBe(2);
      expect(mockSessionDeleteMany).toHaveBeenCalledWith({
        where: { id: { in: ["s-1", "s-2"] } },
      });
    });

    it("emits work_session.ended for each expired session", async () => {
      mockSessionFindMany.mockResolvedValue([
        {
          id: "s-1",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
      ] as any);
      mockSessionDeleteMany.mockResolvedValue({ count: 1 } as any);

      await cleanupExpired();

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "work_session.ended",
          payload: expect.objectContaining({ reason: "expired" }),
        }),
      );
    });

    it("returns 0 when no expired sessions", async () => {
      mockSessionFindMany.mockResolvedValue([]);

      const count = await cleanupExpired();

      expect(count).toBe(0);
      expect(mockSessionDeleteMany).not.toHaveBeenCalled();
    });

    it("logs when logger is provided", async () => {
      mockSessionFindMany.mockResolvedValue([
        {
          id: "s-1",
          memberId: "m-1",
          userId: "u-1",
          issueId: "i-1",
          issue: { key: "KAN-1", project: { workspaceId: "ws-1" } },
        },
      ] as any);
      mockSessionDeleteMany.mockResolvedValue({ count: 1 } as any);

      const logger = { info: vi.fn() };
      await cleanupExpired(logger);

      expect(logger.info).toHaveBeenCalledWith(
        { count: 1 },
        "Cleaned up expired work sessions",
      );
    });
  });
});
