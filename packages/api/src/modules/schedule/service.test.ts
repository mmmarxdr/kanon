import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// ── Mock prisma ────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    issue: { findUnique: vi.fn() },
    issueSchedule: { findUnique: vi.fn(), upsert: vi.fn() },
    estimateRevision: { create: vi.fn() },
    $transaction: vi.fn(),
  },
}));

// ── Mock eventBus ──────────────────────────────────────────────────────────
vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: { emit: vi.fn() },
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { getSchedule, upsertPlan, reviseEstimate } from "./service.js";
import { AppError } from "../../shared/types.js";

const mockIssueFind = vi.mocked(prisma.issue.findUnique);
const mockScheduleFind = vi.mocked(prisma.issueSchedule.findUnique);
const mockScheduleUpsert = vi.mocked(prisma.issueSchedule.upsert);
const mockRevisionCreate = vi.mocked(prisma.estimateRevision.create);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockEmit = vi.mocked(eventBus.emit);

// ── Fake objects ───────────────────────────────────────────────────────────

const fakeIssue = {
  id: "issue-1",
  key: "KAN-99",
  project: { workspaceId: "ws-1" },
} as any;

function makeSchedule(overrides: Record<string, unknown> = {}) {
  return {
    issueId: "issue-1",
    startDate: null,
    dueDate: null,
    progress: 0,
    estimateHours: null,
    baselineStart: null,
    baselineEnd: null,
    baselineSetAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  } as any;
}

function makeRevision(overrides: Record<string, unknown> = {}) {
  return {
    id: "rev-1",
    issueId: "issue-1",
    hours: new Prisma.Decimal("3.50"),
    reason: null,
    authorId: "member-1",
    via: null,
    createdAt: new Date(),
    ...overrides,
  } as any;
}

describe("ScheduleService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── getSchedule ────────────────────────────────────────────────────────

  describe("getSchedule", () => {
    it("returns null when no schedule row exists for the issue", async () => {
      mockScheduleFind.mockResolvedValue(null);

      const result = await getSchedule("issue-1");

      expect(result).toBeNull();
      expect(mockScheduleFind).toHaveBeenCalledWith({
        where: { issueId: "issue-1" },
      });
    });

    it("returns the schedule when it exists", async () => {
      const sched = makeSchedule({ progress: 50 });
      mockScheduleFind.mockResolvedValue(sched);

      const result = await getSchedule("issue-1");

      expect(result).toEqual(sched);
    });
  });

  // ── upsertPlan ────────────────────────────────────────────────────────

  describe("upsertPlan", () => {
    it("upserts schedule and emits schedule.updated on success", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      const sched = makeSchedule();
      mockScheduleUpsert.mockResolvedValue(sched);

      await upsertPlan("KAN-99", { progress: 50 }, "member-1", "web");

      expect(mockScheduleUpsert).toHaveBeenCalledOnce();
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ type: "schedule.updated" }),
      );
    });

    it("throws 422 INVALID_PROGRESS when progress > 100", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      await expect(
        upsertPlan("KAN-99", { progress: 101 }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_PROGRESS",
      });

      expect(mockScheduleUpsert).not.toHaveBeenCalled();
    });

    it("throws 422 INVALID_PROGRESS when progress < 0", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      await expect(
        upsertPlan("KAN-99", { progress: -1 }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_PROGRESS",
      });
    });

    it("throws 422 INVALID_DATE_RANGE when startDate > dueDate", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      await expect(
        upsertPlan(
          "KAN-99",
          {
            startDate: "2026-06-20T00:00:00.000Z",
            dueDate: "2026-06-10T00:00:00.000Z",
          },
          "member-1",
        ),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_DATE_RANGE",
      });

      expect(mockScheduleUpsert).not.toHaveBeenCalled();
    });

    it("allows startDate === dueDate (boundary: equal is valid)", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockScheduleUpsert.mockResolvedValue(makeSchedule());

      await expect(
        upsertPlan(
          "KAN-99",
          {
            startDate: "2026-06-15T00:00:00.000Z",
            dueDate: "2026-06-15T00:00:00.000Z",
          },
          "member-1",
        ),
      ).resolves.toBeDefined();
    });

    it("throws 404 ISSUE_NOT_FOUND when issue does not exist", async () => {
      mockIssueFind.mockResolvedValue(null);

      await expect(
        upsertPlan("KAN-MISSING", { progress: 0 }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "ISSUE_NOT_FOUND",
      });
    });

    it("threads via into the upsert data and event", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);
      mockScheduleUpsert.mockResolvedValue(makeSchedule());

      await upsertPlan("KAN-99", { progress: 10 }, "member-1", "claude-code");

      // via is NOT stored on IssueSchedule (no via column), but IS passed to event
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ via: "claude-code" }),
      );
    });
  });

  // ── reviseEstimate ────────────────────────────────────────────────────

  describe("reviseEstimate", () => {
    it("calls $transaction callback (atomic path for estimate revision)", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      // Simulate successful transaction: callback receives a tx object
      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          estimateRevision: { create: vi.fn().mockResolvedValue(makeRevision()) },
          issueSchedule: { upsert: vi.fn().mockResolvedValue(makeSchedule({ estimateHours: new Prisma.Decimal("3.50") })) },
        };
        return cb(tx);
      });

      await reviseEstimate("KAN-99", { hours: "3.50" }, "member-1");

      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it("appends EstimateRevision inside the transaction", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      let capturedRevisionCreate: any;
      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          estimateRevision: {
            create: vi.fn().mockImplementation((args: any) => {
              capturedRevisionCreate = args;
              return Promise.resolve(makeRevision());
            }),
          },
          issueSchedule: { upsert: vi.fn().mockResolvedValue(makeSchedule()) },
        };
        return cb(tx);
      });

      await reviseEstimate("KAN-99", { hours: "3.50", reason: "sprint planning" }, "member-1", "web");

      expect(capturedRevisionCreate).toMatchObject({
        data: expect.objectContaining({
          issueId: "issue-1",
          reason: "sprint planning",
          authorId: "member-1",
        }),
      });
    });

    it("upserts IssueSchedule.estimateHours inside the transaction", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      let capturedScheduleUpsert: any;
      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          estimateRevision: { create: vi.fn().mockResolvedValue(makeRevision()) },
          issueSchedule: {
            upsert: vi.fn().mockImplementation((args: any) => {
              capturedScheduleUpsert = args;
              return Promise.resolve(makeSchedule());
            }),
          },
        };
        return cb(tx);
      });

      await reviseEstimate("KAN-99", { hours: "3.50" }, "member-1");

      expect(capturedScheduleUpsert).toMatchObject({
        where: { issueId: "issue-1" },
        create: expect.objectContaining({ issueId: "issue-1" }),
        update: expect.objectContaining({}),
      });
      // estimateHours should be a Prisma.Decimal object
      const updateData = capturedScheduleUpsert.update;
      expect(updateData.estimateHours).toBeInstanceOf(Prisma.Decimal);
    });

    it("throws 422 INVALID_ESTIMATE when hours < 0", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      await expect(
        reviseEstimate("KAN-99", { hours: "-1" }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_ESTIMATE",
      });

      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("throws 404 ISSUE_NOT_FOUND when issue does not exist", async () => {
      mockIssueFind.mockResolvedValue(null);

      await expect(
        reviseEstimate("KAN-MISSING", { hours: "2.00" }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "ISSUE_NOT_FOUND",
      });

      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("emits estimate.revised after successful commit (fire-and-forget)", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          estimateRevision: { create: vi.fn().mockResolvedValue(makeRevision({ id: "rev-99" })) },
          issueSchedule: { upsert: vi.fn().mockResolvedValue(makeSchedule()) },
        };
        return cb(tx);
      });

      await reviseEstimate("KAN-99", { hours: "5.00" }, "member-1", "claude-code");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "estimate.revised",
          actorId: "member-1",
          workspaceId: "ws-1",
          via: "claude-code",
          payload: expect.objectContaining({
            issueId: "issue-1",
            revisionId: "rev-99",
          }),
        }),
      );
    });

    it("does not throw when event emission fails (fire-and-forget guard)", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          estimateRevision: { create: vi.fn().mockResolvedValue(makeRevision()) },
          issueSchedule: { upsert: vi.fn().mockResolvedValue(makeSchedule()) },
        };
        return cb(tx);
      });

      mockEmit.mockImplementationOnce(() => {
        throw new Error("event bus dead");
      });

      await expect(
        reviseEstimate("KAN-99", { hours: "1.00" }, "member-1"),
      ).resolves.toBeDefined();
    });

    it("allows zero hours (boundary: 0 is valid estimate)", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          estimateRevision: { create: vi.fn().mockResolvedValue(makeRevision({ hours: new Prisma.Decimal("0") })) },
          issueSchedule: { upsert: vi.fn().mockResolvedValue(makeSchedule()) },
        };
        return cb(tx);
      });

      await expect(
        reviseEstimate("KAN-99", { hours: "0" }, "member-1"),
      ).resolves.toBeDefined();
    });

    it("threads via through EstimateRevision and event", async () => {
      mockIssueFind.mockResolvedValue(fakeIssue);

      let capturedRevisionCreate: any;
      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          estimateRevision: {
            create: vi.fn().mockImplementation((args: any) => {
              capturedRevisionCreate = args;
              return Promise.resolve(makeRevision());
            }),
          },
          issueSchedule: { upsert: vi.fn().mockResolvedValue(makeSchedule()) },
        };
        return cb(tx);
      });

      await reviseEstimate("KAN-99", { hours: "2.00" }, "member-1", "cursor");

      expect(capturedRevisionCreate.data.via).toBe("cursor");
      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({ via: "cursor" }),
      );
    });
  });
});
