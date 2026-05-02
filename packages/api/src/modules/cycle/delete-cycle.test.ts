import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for deleteCycle service function — Phase B strict TDD.
 *
 * Test ordering matches spec scenarios:
 *   B.1  REQ-CYCLE-DELETE-002 — active-state guard (rejected unconditionally)
 *   B.2  REQ-CYCLE-DELETE-003 s1 — non-terminal issues, no force → 400
 *   B.3  REQ-CYCLE-DELETE-003 s2 — non-terminal + force=true → proceeds
 *   B.4  REQ-CYCLE-DELETE-003 s3 — only terminal issues, no force → proceeds
 *   B.5  REQ-CYCLE-DELETE-004 s1 / REQ-CYCLE-DELETE-005 — detach before delete, detachedIssueKeys
 *   B.6  REQ-CYCLE-DELETE-004 s2 — zero issues, updateMany still called
 *   B.7  REQ-AUDIT-LOG-001 s1 / REQ-AUDIT-LOG-002 — audit row fields + payload shape
 *   B.8  REQ-AUDIT-LOG-001 s2 — guard rejection → no audit row
 *   B.9  REQ-SSE-CYCLE-DELETED-001 s1 — cycle.deleted emitted post-commit
 *   B.10 REQ-SSE-CYCLE-DELETED-001 s2 — cycle.deleted emitted even with zero issues
 *   B.11 REQ-SSE-ISSUE-UPDATED-001 s1 — one issue.updated per detached key
 *   B.12 REQ-SSE-ISSUE-UPDATED-001 s2 — zero detached → no issue.updated emitted
 *   B.13 REQ-SSE-CYCLE-DELETED-001 fire-and-forget — eventBus throws → still resolves
 *   B.14 REQ-CONCURRENCY-001 — P2025 caught outside tx → AppError(404, "CYCLE_NOT_FOUND")
 */

vi.mock("../../config/engram.js", () => ({
  getEngramClient: vi.fn().mockReturnValue(null),
}));

vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: {
    emit: vi.fn(),
    on: vi.fn(),
  },
}));

vi.mock("../../config/prisma.js", () => ({
  prisma: {
    cycle: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      delete: vi.fn(),
    },
    cycleScopeEvent: {
      create: vi.fn(),
      createMany: vi.fn(),
      findMany: vi.fn(),
    },
    issue: {
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    project: {
      findFirst: vi.fn(),
    },
    adminAuditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import { AppError } from "../../shared/types.js";
import { makeTxMock } from "./__test-helpers__/tx-mock.js";
import { deleteCycle } from "./delete-cycle.js";

// ── Fixture builders ─────────────────────────────────────────────────────────

const CYCLE_ID = "a1b2c3d4-0000-0000-0000-000000000010";
const PROJECT_ID = "proj-0001";
const WORKSPACE_ID = "ws-0001";
const AUTHOR_ID = "member-1";
const AUDIT_LOG_ID = "aud-0099";

/** Build a minimal cycle row suitable for the tx.cycle.findUnique stub. */
function buildCycle(
  overrides: Partial<{
    id: string;
    state: string;
    issues: Array<{ id: string; key: string; state: string }>;
    projectId: string;
    project: { workspaceId: string };
    name: string;
    goal: string | null;
    startDate: Date;
    endDate: Date;
    velocity: number | null;
    createdAt: Date;
    updatedAt: Date;
  }> = {},
) {
  return {
    id: CYCLE_ID,
    name: "Sprint 7",
    goal: "ship feature",
    state: "done",
    startDate: new Date("2026-04-01"),
    endDate: new Date("2026-04-14"),
    velocity: 23,
    projectId: PROJECT_ID,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-04-14"),
    project: { workspaceId: WORKSPACE_ID },
    issues: [],
    ...overrides,
  };
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe("deleteCycle()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── B.1 ── REQ-CYCLE-DELETE-002 ─────────────────────────────────────────────
  describe("B.1 — active-state guard (REQ-CYCLE-DELETE-002)", () => {
    it("rejects an active cycle unconditionally, even with force:true", async () => {
      const activeCycle = buildCycle({ state: "active" });
      const tx = makeTxMock({ cycleFindUniqueResult: activeCycle });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await expect(
        deleteCycle(CYCLE_ID, { force: true }, AUTHOR_ID),
      ).rejects.toThrow(AppError);

      await expect(
        deleteCycle(CYCLE_ID, { force: true }, AUTHOR_ID),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "CYCLE_ACTIVE",
      });
    });

    it("does not emit any SSE event when active-state guard fires", async () => {
      const activeCycle = buildCycle({ state: "active" });
      const tx = makeTxMock({ cycleFindUniqueResult: activeCycle });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await expect(deleteCycle(CYCLE_ID, { force: true }, AUTHOR_ID)).rejects.toThrow(AppError);

      expect(vi.mocked(eventBus.emit)).not.toHaveBeenCalled();
    });
  });

  // ── B.2 ── REQ-CYCLE-DELETE-003 s1 ──────────────────────────────────────────
  describe("B.2 — non-terminal issues guard, no force (REQ-CYCLE-DELETE-003 s1)", () => {
    it("rejects with 400 CYCLE_HAS_NON_TERMINAL_ISSUES when non-terminal issues exist and force is omitted", async () => {
      const cycle = buildCycle({
        issues: [
          { id: "i1", key: "KAN-7", state: "in_progress" },
          { id: "i2", key: "KAN-8", state: "review" },
        ],
      });
      const tx = makeTxMock({ cycleFindUniqueResult: cycle });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await expect(
        deleteCycle(CYCLE_ID, {}, AUTHOR_ID),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "CYCLE_HAS_NON_TERMINAL_ISSUES",
      });
    });

    it("includes details.issueKeys listing the non-terminal issue keys", async () => {
      const cycle = buildCycle({
        issues: [
          { id: "i1", key: "KAN-7", state: "in_progress" },
          { id: "i2", key: "KAN-8", state: "review" },
        ],
      });
      const tx = makeTxMock({ cycleFindUniqueResult: cycle });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      let caught: any;
      try {
        await deleteCycle(CYCLE_ID, {}, AUTHOR_ID);
      } catch (e) {
        caught = e;
      }

      expect(caught).toBeDefined();
      expect(caught.details).toMatchObject({ issueKeys: ["KAN-7", "KAN-8"] });
    });
  });

  // ── B.3 ── REQ-CYCLE-DELETE-003 s2 ──────────────────────────────────────────
  describe("B.3 — non-terminal issues + force=true (REQ-CYCLE-DELETE-003 s2)", () => {
    it("bypasses the non-terminal guard when force:true is passed", async () => {
      const cycle = buildCycle({
        issues: [
          { id: "i1", key: "KAN-7", state: "in_progress" },
          { id: "i2", key: "KAN-8", state: "done" },
        ],
      });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      // Should NOT throw
      const result = await deleteCycle(CYCLE_ID, { force: true }, AUTHOR_ID);

      expect(result).toMatchObject({
        deletedCycleId: CYCLE_ID,
      });
    });
  });

  // ── B.4 ── REQ-CYCLE-DELETE-003 s3 ──────────────────────────────────────────
  describe("B.4 — only terminal issues, no force needed (REQ-CYCLE-DELETE-003 s3)", () => {
    it("proceeds without force when all issues are in terminal state", async () => {
      const cycle = buildCycle({
        issues: [
          { id: "i1", key: "KAN-3", state: "done" },
          { id: "i2", key: "KAN-4", state: "done" },
        ],
      });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      const result = await deleteCycle(CYCLE_ID, { force: false }, AUTHOR_ID);

      expect(result).toMatchObject({ deletedCycleId: CYCLE_ID });
    });
  });

  // ── B.5 ── REQ-CYCLE-DELETE-004 s1 + REQ-CYCLE-DELETE-005 ───────────────────
  describe("B.5 — detach before delete + detachedIssueKeys (REQ-CYCLE-DELETE-004 s1, REQ-CYCLE-DELETE-005)", () => {
    it("calls tx.issue.updateMany before tx.cycle.delete and returns correct detachedIssueKeys", async () => {
      const cycle = buildCycle({
        issues: [
          { id: "i1", key: "KAN-3", state: "done" },
          { id: "i2", key: "KAN-5", state: "done" },
        ],
      });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });

      const callOrder: string[] = [];
      tx.issue.updateMany.mockImplementation(async () => {
        callOrder.push("issue.updateMany");
        return { count: 2 };
      });
      tx.cycle.delete.mockImplementation(async () => {
        callOrder.push("cycle.delete");
        return {};
      });

      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      const result = await deleteCycle(CYCLE_ID, {}, AUTHOR_ID);

      expect(callOrder.indexOf("issue.updateMany")).toBeLessThan(
        callOrder.indexOf("cycle.delete"),
      );
      expect(result.detachedIssueKeys).toEqual(["KAN-3", "KAN-5"]);
    });
  });

  // ── B.6 ── REQ-CYCLE-DELETE-004 s2 ──────────────────────────────────────────
  describe("B.6 — empty cycle (zero issues) (REQ-CYCLE-DELETE-004 s2)", () => {
    it("still calls tx.issue.updateMany, detachedIssueKeys is empty, no throw", async () => {
      const cycle = buildCycle({ state: "upcoming", issues: [] });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      const result = await deleteCycle(CYCLE_ID, {}, AUTHOR_ID);

      expect(tx.issue.updateMany).toHaveBeenCalledOnce();
      expect(result.detachedIssueKeys).toEqual([]);
    });
  });

  // ── B.7 ── REQ-AUDIT-LOG-001 s1 + REQ-AUDIT-LOG-002 ────────────────────────
  describe("B.7 — audit row fields and payload shape (REQ-AUDIT-LOG-001 s1, REQ-AUDIT-LOG-002)", () => {
    it("creates audit row inside tx with correct fields and returns auditLogId in response", async () => {
      const cycle = buildCycle({
        id: CYCLE_ID,
        name: "Sprint 1",
        goal: "ship feature",
        state: "done",
        velocity: 23,
        projectId: PROJECT_ID,
        issues: [
          { id: "i1", key: "KAN-4", state: "done" },
          { id: "i2", key: "KAN-5", state: "done" },
        ],
      });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      const result = await deleteCycle(
        CYCLE_ID,
        { reason: "remove placeholder" },
        AUTHOR_ID,
      );

      expect(tx.adminAuditLog.create).toHaveBeenCalledOnce();
      const createArg = tx.adminAuditLog.create.mock.calls[0]![0] as any;

      expect(createArg.data).toMatchObject({
        entityType: "cycle",
        entityId: CYCLE_ID,
        action: "delete",
        authorId: AUTHOR_ID,
        reason: "remove placeholder",
      });

      // Payload shape
      expect(createArg.data.payload).toMatchObject({
        cycleSnapshot: {
          id: CYCLE_ID,
          name: "Sprint 1",
          goal: "ship feature",
          state: "done",
          velocity: 23,
          projectId: PROJECT_ID,
        },
        detachedIssueKeys: ["KAN-4", "KAN-5"],
        force: false,
      });

      expect(result.auditLogId).toBe(AUDIT_LOG_ID);
    });
  });

  // ── B.8 ── REQ-AUDIT-LOG-001 s2 ─────────────────────────────────────────────
  describe("B.8 — no audit row created when guard rejects (REQ-AUDIT-LOG-001 s2)", () => {
    it("does not call adminAuditLog.create when active-state guard fires", async () => {
      const activeCycle = buildCycle({ state: "active" });
      const tx = makeTxMock({ cycleFindUniqueResult: activeCycle });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await expect(deleteCycle(CYCLE_ID, { force: true }, AUTHOR_ID)).rejects.toThrow(AppError);

      expect(tx.adminAuditLog.create).not.toHaveBeenCalled();
    });
  });

  // ── B.9 ── REQ-SSE-CYCLE-DELETED-001 s1 ─────────────────────────────────────
  describe("B.9 — cycle.deleted emitted post-commit (REQ-SSE-CYCLE-DELETED-001 s1)", () => {
    it("emits exactly one cycle.deleted event with { cycleId, projectId }", async () => {
      const cycle = buildCycle({
        issues: [{ id: "i1", key: "KAN-12", state: "done" }],
        projectId: PROJECT_ID,
      });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await deleteCycle(CYCLE_ID, {}, AUTHOR_ID);

      const cycleCalls = vi
        .mocked(eventBus.emit)
        .mock.calls.filter((c: any) => c[0].type === "cycle.deleted");

      expect(cycleCalls).toHaveLength(1);
      expect(cycleCalls[0]![0]).toMatchObject({
        type: "cycle.deleted",
        payload: {
          cycleId: CYCLE_ID,
          projectId: PROJECT_ID,
        },
      });
    });
  });

  // ── B.10 ── REQ-SSE-CYCLE-DELETED-001 s2 ────────────────────────────────────
  describe("B.10 — cycle.deleted emitted even for empty cycle (REQ-SSE-CYCLE-DELETED-001 s2)", () => {
    it("emits cycle.deleted even when detachedIssueKeys is empty", async () => {
      const cycle = buildCycle({ issues: [] });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await deleteCycle(CYCLE_ID, {}, AUTHOR_ID);

      const cycleCalls = vi
        .mocked(eventBus.emit)
        .mock.calls.filter((c: any) => c[0].type === "cycle.deleted");

      expect(cycleCalls).toHaveLength(1);
    });
  });

  // ── B.11 ── REQ-SSE-ISSUE-UPDATED-001 s1 ────────────────────────────────────
  describe("B.11 — one issue.updated per detached key (REQ-SSE-ISSUE-UPDATED-001 s1)", () => {
    it("emits issue.updated for each detached issue key with fields:[cycleId]", async () => {
      const cycle = buildCycle({
        issues: [
          { id: "i1", key: "KAN-12", state: "done" },
          { id: "i2", key: "KAN-13", state: "done" },
        ],
      });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await deleteCycle(CYCLE_ID, {}, AUTHOR_ID);

      const issueUpdatedCalls = vi
        .mocked(eventBus.emit)
        .mock.calls.filter((c: any) => c[0].type === "issue.updated");

      expect(issueUpdatedCalls).toHaveLength(2);

      const emittedKeys = issueUpdatedCalls.map((c: any) => c[0].payload.issueKey).sort();
      expect(emittedKeys).toEqual(["KAN-12", "KAN-13"]);

      for (const call of issueUpdatedCalls) {
        expect((call[0] as any).payload.fields).toEqual(["cycleId"]);
      }
    });
  });

  // ── B.12 ── REQ-SSE-ISSUE-UPDATED-001 s2 ────────────────────────────────────
  describe("B.12 — zero detached issues → no issue.updated (REQ-SSE-ISSUE-UPDATED-001 s2)", () => {
    it("does not emit issue.updated when no issues were attached", async () => {
      const cycle = buildCycle({ issues: [] });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));

      await deleteCycle(CYCLE_ID, {}, AUTHOR_ID);

      const issueUpdatedCalls = vi
        .mocked(eventBus.emit)
        .mock.calls.filter((c: any) => c[0].type === "issue.updated");

      expect(issueUpdatedCalls).toHaveLength(0);
    });
  });

  // ── B.13 ── REQ-SSE-CYCLE-DELETED-001 fire-and-forget ───────────────────────
  describe("B.13 — eventBus throws → service still resolves (fire-and-forget)", () => {
    it("resolves with the correct return value even when eventBus.emit throws", async () => {
      const cycle = buildCycle({ issues: [] });
      const tx = makeTxMock({
        cycleFindUniqueResult: cycle,
        auditLogCreateResult: { id: AUDIT_LOG_ID },
      });
      vi.mocked(prisma.$transaction).mockImplementation(async (cb: any) => cb(tx));
      vi.mocked(eventBus.emit).mockImplementation(() => {
        throw new Error("SSE bus down");
      });

      const result = await deleteCycle(CYCLE_ID, {}, AUTHOR_ID);

      expect(result).toMatchObject({
        deletedCycleId: CYCLE_ID,
        detachedIssueKeys: [],
        auditLogId: AUDIT_LOG_ID,
      });
    });
  });

  // ── B.14 ── REQ-CONCURRENCY-001 ─────────────────────────────────────────────
  describe("B.14 — P2025 from prisma.$transaction → AppError(404, CYCLE_NOT_FOUND) (REQ-CONCURRENCY-001)", () => {
    it("catches Prisma P2025 outside the tx and rethrows as AppError 404", async () => {
      const { PrismaClientKnownRequestError } = await import("@prisma/client/runtime/library.js");
      const p2025 = new PrismaClientKnownRequestError("Record not found", {
        code: "P2025",
        clientVersion: "6.0.0",
      });
      vi.mocked(prisma.$transaction).mockRejectedValue(p2025);

      await expect(
        deleteCycle(CYCLE_ID, {}, AUTHOR_ID),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "CYCLE_NOT_FOUND",
      });
    });
  });
});
