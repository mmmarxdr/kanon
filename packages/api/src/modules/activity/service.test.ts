import { describe, it, expect, vi, beforeEach } from "vitest";
import { createActivityLog, getActivityByIssue } from "./service.js";

// Mock Prisma client
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    activityLog: {
      create: vi.fn(),
      findMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../config/prisma.js";

const mockCreate = vi.mocked(prisma.activityLog.create);
const mockFindMany = vi.mocked(prisma.activityLog.findMany);

describe("Activity Service — unit tests (mocked DB)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("createActivityLog", () => {
    it("creates an activity log entry with all fields", async () => {
      const mockEntry = {
        id: "log-1",
        issueId: "issue-1",
        memberId: "member-1",
        action: "created" as const,
        details: { title: "Test issue" },
        createdAt: new Date(),
      };

      mockCreate.mockResolvedValue(mockEntry as any);

      const result = await createActivityLog({
        issueId: "issue-1",
        memberId: "member-1",
        action: "created",
        details: { title: "Test issue" },
      });

      expect(mockCreate).toHaveBeenCalledOnce();
      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          issueId: "issue-1",
          memberId: "member-1",
          action: "created",
          details: { title: "Test issue" },
        },
      });
      expect(result).toEqual(mockEntry);
    });

    it("creates an activity log entry without details", async () => {
      const mockEntry = {
        id: "log-2",
        issueId: "issue-1",
        memberId: "member-1",
        action: "state_changed" as const,
        details: null,
        createdAt: new Date(),
      };

      mockCreate.mockResolvedValue(mockEntry as any);

      await createActivityLog({
        issueId: "issue-1",
        memberId: "member-1",
        action: "state_changed",
      });

      expect(mockCreate).toHaveBeenCalledWith({
        data: {
          issueId: "issue-1",
          memberId: "member-1",
          action: "state_changed",
          details: undefined,
        },
      });
    });
  });

  describe("getActivityByIssue", () => {
    it("returns activity logs for an issue ordered by createdAt desc", async () => {
      const mockLogs = [
        {
          id: "log-2",
          action: "edited",
          createdAt: new Date("2026-03-22T02:00:00Z"),
          member: { id: "m1", username: "dev", email: "dev@test.io" },
        },
        {
          id: "log-1",
          action: "created",
          createdAt: new Date("2026-03-22T01:00:00Z"),
          member: { id: "m1", username: "dev", email: "dev@test.io" },
        },
      ];

      mockFindMany.mockResolvedValue(mockLogs as any);

      const result = await getActivityByIssue("issue-1");

      expect(mockFindMany).toHaveBeenCalledOnce();
      expect(mockFindMany).toHaveBeenCalledWith({
        where: { issueId: "issue-1" },
        orderBy: { createdAt: "desc" },
        include: {
          member: {
            select: { id: true, username: true, email: true },
          },
        },
      });
      expect(result).toHaveLength(2);
      expect(result[0]!.id).toBe("log-2");
    });

    it("returns empty array when no activity exists", async () => {
      mockFindMany.mockResolvedValue([]);

      const result = await getActivityByIssue("nonexistent-issue");

      expect(result).toEqual([]);
    });
  });
});
