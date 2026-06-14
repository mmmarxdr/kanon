import { describe, it, expect, vi, beforeEach } from "vitest";
import { Prisma } from "@prisma/client";

// ── Mock prisma ────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    workLog: { findUnique: vi.fn() },
    timeEntry: {
      findUnique: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

// ── Mock eventBus ──────────────────────────────────────────────────────────
vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: { emit: vi.fn() },
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import {
  promoteWorkLog,
  updateEntry,
  submitEntry,
  approveEntry,
  rejectEntry,
  createAdjustment,
} from "./service.js";
import { AppError } from "../../shared/types.js";

// ── Mocked fns ─────────────────────────────────────────────────────────────
const mockWorkLogFind = vi.mocked(prisma.workLog.findUnique);
const mockEntryFind = vi.mocked(prisma.timeEntry.findUnique);
const mockEntryCreate = vi.mocked(prisma.timeEntry.create);
const mockEntryUpdate = vi.mocked(prisma.timeEntry.update);
const mockTransaction = vi.mocked(prisma.$transaction);
const mockEmit = vi.mocked(eventBus.emit);

// ── Fake objects ───────────────────────────────────────────────────────────

const MEMBER_ID = "member-1";
const ISSUE_ID = "issue-1";
const WORKSPACE_ID = "ws-1";

function makeWorkLog(overrides: Record<string, unknown> = {}) {
  return {
    id: "wl-1",
    memberId: MEMBER_ID,
    issueId: ISSUE_ID,
    durationS: 7200, // 2 hours
    startedAt: new Date("2026-06-14T09:00:00.000Z"),
    endedAt: new Date("2026-06-14T11:00:00.000Z"),
    reason: "stopped",
    via: null,
    createdAt: new Date(),
    issue: { id: ISSUE_ID, project: { workspaceId: WORKSPACE_ID } },
    member: { id: MEMBER_ID },
    ...overrides,
  } as any;
}

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    id: "te-1",
    memberId: MEMBER_ID,
    issueId: ISSUE_ID,
    hours: new Prisma.Decimal("2.00"),
    workedOn: new Date("2026-06-14T00:00:00.000Z"),
    status: "draft" as const,
    sourceWorkLogId: null,
    adjustsId: null,
    costRateSnapshot: null,
    billRateSnapshot: null,
    via: null,
    approvedById: null,
    approvedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    member: { workspaceId: WORKSPACE_ID },
    issue: { id: ISSUE_ID, project: { id: "proj-1", workspaceId: WORKSPACE_ID } },
    ...overrides,
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────

describe("TimesheetService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── promoteWorkLog ─────────────────────────────────────────────────────

  describe("promoteWorkLog", () => {
    it("creates a draft TimeEntry from a WorkLog (happy path)", async () => {
      const wl = makeWorkLog();
      mockWorkLogFind.mockResolvedValue(wl);
      mockEntryCreate.mockResolvedValue(makeEntry({ sourceWorkLogId: "wl-1" }));

      await promoteWorkLog("wl-1", {}, MEMBER_ID, "web");

      expect(mockEntryCreate).toHaveBeenCalledOnce();
      // hours = durationS / 3600 = 2.00
      const createArg = mockEntryCreate.mock.calls[0]![0];
      const data = (createArg as any).data;
      expect(data.sourceWorkLogId).toBe("wl-1");
      expect(data.memberId).toBe(MEMBER_ID);
      expect(data.issueId).toBe(ISSUE_ID);
      expect(data.status).toBe("draft");
    });

    it("[GUARD] throws 404 WORKLOG_NOT_FOUND when worklog does not exist", async () => {
      mockWorkLogFind.mockResolvedValue(null);

      await expect(promoteWorkLog("wl-missing", {}, MEMBER_ID)).rejects.toMatchObject({
        statusCode: 404,
        code: "WORKLOG_NOT_FOUND",
      });

      expect(mockEntryCreate).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 403 FORBIDDEN when caller is not the WorkLog owner", async () => {
      mockWorkLogFind.mockResolvedValue(makeWorkLog({ memberId: "other-member" }));

      await expect(promoteWorkLog("wl-1", {}, MEMBER_ID)).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });

      expect(mockEntryCreate).not.toHaveBeenCalled();
    });

    it("[GUARD] IDEMPOTENT: P2002 unique-index violation returns the existing entry (not an error)", async () => {
      mockWorkLogFind.mockResolvedValue(makeWorkLog());
      // Simulate Prisma P2002 unique constraint violation
      const p2002 = Object.assign(new Error("Unique constraint"), {
        code: "P2002",
        meta: { target: ["source_work_log_id"] },
      });
      mockEntryCreate.mockRejectedValue(p2002);
      // Subsequent lookup returns the existing entry
      const existingEntry = makeEntry({ sourceWorkLogId: "wl-1" });
      mockEntryFind.mockResolvedValue(existingEntry);

      const result = await promoteWorkLog("wl-1", {}, MEMBER_ID);

      expect(result).toEqual(existingEntry);
      // No throw — idempotent
      expect(mockEntryFind).toHaveBeenCalledWith(
        expect.objectContaining({ where: { sourceWorkLogId: "wl-1" } }),
      );
    });

    it("threads via into the created TimeEntry", async () => {
      mockWorkLogFind.mockResolvedValue(makeWorkLog());
      mockEntryCreate.mockResolvedValue(makeEntry());

      await promoteWorkLog("wl-1", {}, MEMBER_ID, "claude-code");

      const createArg = mockEntryCreate.mock.calls[0]![0];
      expect((createArg as any).data.via).toBe("claude-code");
    });

    it("uses durationS / 3600 as default hours", async () => {
      mockWorkLogFind.mockResolvedValue(makeWorkLog({ durationS: 5400 })); // 1.5 hrs
      mockEntryCreate.mockResolvedValue(makeEntry());

      await promoteWorkLog("wl-1", {}, MEMBER_ID);

      const data = (mockEntryCreate.mock.calls[0]![0] as any).data;
      expect(data.hours.toString()).toBe("1.5");
    });

    it("accepts hours override from body", async () => {
      mockWorkLogFind.mockResolvedValue(makeWorkLog());
      mockEntryCreate.mockResolvedValue(makeEntry());

      await promoteWorkLog("wl-1", { hours: "3.00" }, MEMBER_ID);

      const data = (mockEntryCreate.mock.calls[0]![0] as any).data;
      expect(data.hours instanceof Prisma.Decimal).toBe(true);
      expect(data.hours.toString()).toBe("3");
    });
  });

  // ── updateEntry ────────────────────────────────────────────────────────

  describe("updateEntry", () => {
    it("updates a draft TimeEntry (happy path)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "draft" }));
      const updated = makeEntry({ status: "draft", hours: new Prisma.Decimal("3.00") });
      mockEntryUpdate.mockResolvedValue(updated);

      await updateEntry("te-1", { hours: "3.00" }, MEMBER_ID, "web");

      expect(mockEntryUpdate).toHaveBeenCalledOnce();
    });

    it("[GUARD] throws 404 TIME_ENTRY_NOT_FOUND when entry does not exist", async () => {
      mockEntryFind.mockResolvedValue(null);

      await expect(updateEntry("te-missing", { hours: "1.00" }, MEMBER_ID)).rejects.toMatchObject({
        statusCode: 404,
        code: "TIME_ENTRY_NOT_FOUND",
      });
    });

    it("[GUARD] throws 403 FORBIDDEN when caller is not the entry owner", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ memberId: "other-member" }));

      await expect(updateEntry("te-1", { hours: "1.00" }, MEMBER_ID)).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });

      expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 409 ENTRY_IMMUTABLE when status is approved", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "approved" }));

      await expect(updateEntry("te-1", { hours: "1.00" }, MEMBER_ID)).rejects.toMatchObject({
        statusCode: 409,
        code: "ENTRY_IMMUTABLE",
      });

      expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 409 ENTRY_IMMUTABLE when status is rejected", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "rejected" }));

      await expect(updateEntry("te-1", { hours: "1.00" }, MEMBER_ID)).rejects.toMatchObject({
        statusCode: 409,
        code: "ENTRY_IMMUTABLE",
      });

      expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    it("[GUARD] allows update on submitted entry (submitted is mutable)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));
      mockEntryUpdate.mockResolvedValue(makeEntry({ status: "submitted" }));

      await expect(updateEntry("te-1", { hours: "1.00" }, MEMBER_ID)).resolves.toBeDefined();
    });

    it("[GUARD] throws 422 INVALID_HOURS when hours < 0 without adjustsId", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "draft", adjustsId: null }));

      // Service must reject negative hours on a non-adjustment entry
      await expect(
        updateEntry("te-1", { hours: "-1.00" }, MEMBER_ID),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_HOURS",
      });
    });

    it("threads via into the update", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "draft" }));
      mockEntryUpdate.mockResolvedValue(makeEntry());

      await updateEntry("te-1", { hours: "2.00" }, MEMBER_ID, "cursor");

      const updateArg = mockEntryUpdate.mock.calls[0]![0] as any;
      expect(updateArg.data.via).toBe("cursor");
    });
  });

  // ── submitEntry ────────────────────────────────────────────────────────

  describe("submitEntry", () => {
    it("transitions a draft entry to submitted (happy path)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "draft" }));
      mockEntryUpdate.mockResolvedValue(makeEntry({ status: "submitted" }));

      await submitEntry("te-1", MEMBER_ID, "web");

      expect(mockEntryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "submitted" }),
        }),
      );
    });

    it("[GUARD] throws 404 TIME_ENTRY_NOT_FOUND when entry does not exist", async () => {
      mockEntryFind.mockResolvedValue(null);

      await expect(submitEntry("te-missing", MEMBER_ID)).rejects.toMatchObject({
        statusCode: 404,
        code: "TIME_ENTRY_NOT_FOUND",
      });
    });

    it("[GUARD] throws 403 FORBIDDEN when caller is not the entry owner", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ memberId: "other-member" }));

      await expect(submitEntry("te-1", MEMBER_ID)).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });

      expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 409 INVALID_STATUS when entry is not in draft", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));

      await expect(submitEntry("te-1", MEMBER_ID)).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_STATUS",
      });

      expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 409 INVALID_STATUS when entry is approved", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "approved" }));

      await expect(submitEntry("te-1", MEMBER_ID)).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_STATUS",
      });
    });
  });

  // ── approveEntry ───────────────────────────────────────────────────────

  describe("approveEntry", () => {
    it("approves a submitted entry via $transaction (happy path)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));

      const approvedEntry = makeEntry({
        status: "approved",
        approvedById: "pm-member",
        approvedAt: new Date(),
      });

      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          timeEntry: { update: vi.fn().mockResolvedValue(approvedEntry) },
        };
        return cb(tx);
      });

      const result = await approveEntry("te-1", "pm-member", "web");

      expect(mockTransaction).toHaveBeenCalledOnce();
      expect(result.status).toBe("approved");
    });

    it("[GUARD] throws 404 TIME_ENTRY_NOT_FOUND when entry does not exist", async () => {
      mockEntryFind.mockResolvedValue(null);

      await expect(approveEntry("te-missing", "pm-member")).rejects.toMatchObject({
        statusCode: 404,
        code: "TIME_ENTRY_NOT_FOUND",
      });

      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 409 INVALID_STATUS when entry is not submitted", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "draft" }));

      await expect(approveEntry("te-1", "pm-member")).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_STATUS",
      });

      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 409 INVALID_STATUS when entry is already approved", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "approved" }));

      await expect(approveEntry("te-1", "pm-member")).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_STATUS",
      });
    });

    it("calls $transaction callback form (atomic path)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));

      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          timeEntry: { update: vi.fn().mockResolvedValue(makeEntry({ status: "approved" })) },
        };
        return cb(tx);
      });

      await approveEntry("te-1", "pm-member");

      expect(mockTransaction).toHaveBeenCalledOnce();
    });

    it("sets approvedById and approvedAt inside the transaction", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));

      let capturedUpdate: any;
      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          timeEntry: {
            update: vi.fn().mockImplementation((args: any) => {
              capturedUpdate = args;
              return Promise.resolve(makeEntry({ status: "approved" }));
            }),
          },
        };
        return cb(tx);
      });

      await approveEntry("te-1", "pm-member", "web");

      expect(capturedUpdate.data).toMatchObject({
        status: "approved",
        approvedById: "pm-member",
      });
      expect(capturedUpdate.data.approvedAt).toBeInstanceOf(Date);
    });

    it("rate snapshots remain null (TODO(KAN-rate) hook present)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));

      let capturedUpdate: any;
      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          timeEntry: {
            update: vi.fn().mockImplementation((args: any) => {
              capturedUpdate = args;
              return Promise.resolve(makeEntry({ status: "approved" }));
            }),
          },
        };
        return cb(tx);
      });

      await approveEntry("te-1", "pm-member");

      // Rate snapshots NOT set in W1 — the TODO(KAN-rate) hook is a no-op
      expect(capturedUpdate.data.costRateSnapshot).toBeUndefined();
      expect(capturedUpdate.data.billRateSnapshot).toBeUndefined();
    });

    it("emits time-entry.approved after commit (fire-and-forget)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));

      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          timeEntry: { update: vi.fn().mockResolvedValue(makeEntry({ status: "approved" })) },
        };
        return cb(tx);
      });

      await approveEntry("te-1", "pm-member", "claude-code");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "time-entry.approved",
          actorId: "pm-member",
          via: "claude-code",
          payload: expect.objectContaining({ entryId: "te-1" }),
        }),
      );
    });

    it("does not throw when event emission fails (fire-and-forget guard)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));

      mockTransaction.mockImplementation(async (cb: any) => {
        const tx = {
          timeEntry: { update: vi.fn().mockResolvedValue(makeEntry({ status: "approved" })) },
        };
        return cb(tx);
      });

      mockEmit.mockImplementationOnce(() => {
        throw new Error("event bus dead");
      });

      await expect(approveEntry("te-1", "pm-member")).resolves.toBeDefined();
    });
  });

  // ── rejectEntry ────────────────────────────────────────────────────────

  describe("rejectEntry", () => {
    it("rejects a submitted entry (happy path)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));
      mockEntryUpdate.mockResolvedValue(makeEntry({ status: "rejected" }));

      await rejectEntry("te-1", "pm-member", {}, "web");

      expect(mockEntryUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "rejected" }),
        }),
      );
    });

    it("[GUARD] throws 404 TIME_ENTRY_NOT_FOUND when entry does not exist", async () => {
      mockEntryFind.mockResolvedValue(null);

      await expect(rejectEntry("te-missing", "pm-member", {})).rejects.toMatchObject({
        statusCode: 404,
        code: "TIME_ENTRY_NOT_FOUND",
      });
    });

    it("[GUARD] throws 409 INVALID_STATUS when entry is not submitted", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "draft" }));

      await expect(rejectEntry("te-1", "pm-member", {})).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_STATUS",
      });

      expect(mockEntryUpdate).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 409 INVALID_STATUS when entry is already rejected", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "rejected" }));

      await expect(rejectEntry("te-1", "pm-member", {})).rejects.toMatchObject({
        statusCode: 409,
        code: "INVALID_STATUS",
      });
    });

    it("emits time-entry.rejected after update (fire-and-forget)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));
      mockEntryUpdate.mockResolvedValue(makeEntry({ status: "rejected" }));

      await rejectEntry("te-1", "pm-member", {}, "cursor");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "time-entry.rejected",
          actorId: "pm-member",
          via: "cursor",
          payload: expect.objectContaining({ entryId: "te-1" }),
        }),
      );
    });

    it("threads via into the rejection update", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));
      mockEntryUpdate.mockResolvedValue(makeEntry({ status: "rejected" }));

      await rejectEntry("te-1", "pm-member", {}, "claude-code");

      const updateArg = mockEntryUpdate.mock.calls[0]![0] as any;
      expect(updateArg.data.via).toBe("claude-code");
    });
  });

  // ── createAdjustment ──────────────────────────────────────────────────

  describe("createAdjustment", () => {
    it("creates a draft adjustment entry on an approved original (happy path)", async () => {
      const original = makeEntry({ status: "approved", id: "te-original" });
      mockEntryFind.mockResolvedValue(original);
      const adjustment = makeEntry({
        id: "te-adjust",
        adjustsId: "te-original",
        status: "draft",
        hours: new Prisma.Decimal("-1.00"),
      });
      mockEntryCreate.mockResolvedValue(adjustment);

      const result = await createAdjustment(
        "te-original",
        { hours: "-1.00", workedOn: "2026-06-14T00:00:00.000Z" },
        MEMBER_ID,
        "web",
      );

      expect(result.adjustsId).toBe("te-original");
      expect(mockEntryCreate).toHaveBeenCalledOnce();
    });

    it("[GUARD] throws 404 TIME_ENTRY_NOT_FOUND when original does not exist", async () => {
      mockEntryFind.mockResolvedValue(null);

      await expect(
        createAdjustment("te-missing", { hours: "-1.00", workedOn: "2026-06-14T00:00:00.000Z" }, MEMBER_ID),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "TIME_ENTRY_NOT_FOUND",
      });

      expect(mockEntryCreate).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 409 NOT_APPROVED when original is not approved", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "submitted" }));

      await expect(
        createAdjustment("te-1", { hours: "-1.00", workedOn: "2026-06-14T00:00:00.000Z" }, MEMBER_ID),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "NOT_APPROVED",
      });

      expect(mockEntryCreate).not.toHaveBeenCalled();
    });

    it("[GUARD] throws 409 NOT_APPROVED when original is draft", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "draft" }));

      await expect(
        createAdjustment("te-1", { hours: "-1.00", workedOn: "2026-06-14T00:00:00.000Z" }, MEMBER_ID),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "NOT_APPROVED",
      });
    });

    it("allows negative hours when adjustsId is set (invariant #3 allows this)", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "approved", id: "te-original" }));
      mockEntryCreate.mockResolvedValue(
        makeEntry({ adjustsId: "te-original", hours: new Prisma.Decimal("-0.50") }),
      );

      await expect(
        createAdjustment(
          "te-original",
          { hours: "-0.50", workedOn: "2026-06-14T00:00:00.000Z" },
          MEMBER_ID,
        ),
      ).resolves.toBeDefined();
    });

    it("creates the adjustment with status draft", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "approved", id: "te-original" }));
      mockEntryCreate.mockResolvedValue(makeEntry({ adjustsId: "te-original" }));

      await createAdjustment(
        "te-original",
        { hours: "1.00", workedOn: "2026-06-14T00:00:00.000Z" },
        MEMBER_ID,
        "web",
      );

      const createArg = (mockEntryCreate.mock.calls[0]![0] as any).data;
      expect(createArg.adjustsId).toBe("te-original");
      expect(createArg.status).toBe("draft");
    });

    it("threads via into the adjustment row", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "approved", id: "te-original" }));
      mockEntryCreate.mockResolvedValue(makeEntry());

      await createAdjustment(
        "te-original",
        { hours: "-1.00", workedOn: "2026-06-14T00:00:00.000Z" },
        MEMBER_ID,
        "claude-code",
      );

      const createArg = (mockEntryCreate.mock.calls[0]![0] as any).data;
      expect(createArg.via).toBe("claude-code");
    });

    it("carries issueId from original entry when not overridden", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "approved", id: "te-original", issueId: ISSUE_ID }));
      mockEntryCreate.mockResolvedValue(makeEntry({ adjustsId: "te-original" }));

      await createAdjustment(
        "te-original",
        { hours: "-1.00", workedOn: "2026-06-14T00:00:00.000Z" },
        MEMBER_ID,
      );

      const createArg = (mockEntryCreate.mock.calls[0]![0] as any).data;
      expect(createArg.issueId).toBe(ISSUE_ID);
    });

    it("overrides issueId from body when provided", async () => {
      mockEntryFind.mockResolvedValue(makeEntry({ status: "approved", id: "te-original" }));
      mockEntryCreate.mockResolvedValue(makeEntry({ adjustsId: "te-original" }));

      await createAdjustment(
        "te-original",
        { hours: "-1.00", workedOn: "2026-06-14T00:00:00.000Z", issueId: "other-issue" },
        MEMBER_ID,
      );

      const createArg = (mockEntryCreate.mock.calls[0]![0] as any).data;
      expect(createArg.issueId).toBe("other-issue");
    });
  });
});
