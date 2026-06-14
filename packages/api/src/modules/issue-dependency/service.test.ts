import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock prisma ────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    issue: { findUnique: vi.fn() },
    issueDependency: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
    },
  },
}));

// ── Mock eventBus ──────────────────────────────────────────────────────────
vi.mock("../../services/event-bus/index.js", () => ({
  eventBus: { emit: vi.fn() },
}));

import { prisma } from "../../config/prisma.js";
import { eventBus } from "../../services/event-bus/index.js";
import {
  createDependency,
  listDependencies,
  deleteDependency,
} from "./service.js";
import { AppError } from "../../shared/types.js";

const mockIssueFind = vi.mocked(prisma.issue.findUnique);
const mockDepFindMany = vi.mocked(prisma.issueDependency.findMany);
const mockDepFindUnique = vi.mocked(prisma.issueDependency.findUnique);
const mockDepCreate = vi.mocked(prisma.issueDependency.create);
const mockDepDelete = vi.mocked(prisma.issueDependency.delete);
const mockEmit = vi.mocked(eventBus.emit);

// ── Fake objects ───────────────────────────────────────────────────────────

const fakeSourceIssue = {
  id: "issue-src-1",
  key: "KAN-1",
  projectId: "proj-1",
  project: { workspaceId: "ws-1" },
} as any;

const fakeTargetIssue = {
  id: "issue-tgt-1",
  key: "KAN-2",
  projectId: "proj-1",
  project: { workspaceId: "ws-1" },
} as any;

function makeDep(overrides: Record<string, unknown> = {}) {
  return {
    id: "dep-1",
    type: "blocks",
    lagDays: 0,
    sourceId: "issue-src-1",
    targetId: "issue-tgt-1",
    createdAt: new Date(),
    source: { id: "issue-src-1", key: "KAN-1", title: "Source", state: "todo", projectId: "proj-1", project: { workspaceId: "ws-1" } },
    target: { id: "issue-tgt-1", key: "KAN-2", title: "Target", state: "todo" },
    ...overrides,
  } as any;
}

// ── Test suite ─────────────────────────────────────────────────────────────

describe("IssueDependencyService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── 1.2.1: lagDays < 0 rejected → INVALID_LAG 422 ────────────────────────

  describe("createDependency — lagDays guard", () => {
    it("[RED] rejects lagDays = -1 → 422 INVALID_LAG", async () => {
      mockIssueFind
        .mockResolvedValueOnce(fakeSourceIssue)
        .mockResolvedValueOnce(fakeTargetIssue);
      mockDepFindMany.mockResolvedValue([]);

      await expect(
        createDependency("KAN-1", { targetKey: "KAN-2", type: "FS", lagDays: -1 }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_LAG",
      });

      expect(mockDepCreate).not.toHaveBeenCalled();
    });

    it("[RED] rejects lagDays = -100 → 422 INVALID_LAG", async () => {
      mockIssueFind
        .mockResolvedValueOnce(fakeSourceIssue)
        .mockResolvedValueOnce(fakeTargetIssue);
      mockDepFindMany.mockResolvedValue([]);

      await expect(
        createDependency("KAN-1", { targetKey: "KAN-2", type: "blocks", lagDays: -100 }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_LAG",
      });

      expect(mockDepCreate).not.toHaveBeenCalled();
    });
  });

  // ── 1.2.2: self-dependency rejected ───────────────────────────────────────

  describe("createDependency — self-dependency guard", () => {
    it("[RED] rejects self-dependency → 400 SELF_DEPENDENCY", async () => {
      const sameIssue = { ...fakeSourceIssue };
      mockIssueFind
        .mockResolvedValueOnce(sameIssue)
        .mockResolvedValueOnce(sameIssue);

      await expect(
        createDependency("KAN-1", { targetKey: "KAN-1", type: "blocks", lagDays: 0 }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "SELF_DEPENDENCY",
      });

      expect(mockDepCreate).not.toHaveBeenCalled();
    });
  });

  // ── 1.2.3: cycle-creating dep rejected ────────────────────────────────────

  describe("createDependency — cycle guard", () => {
    it("[RED] rejects cycle-creating dep → 400 DEPENDENCY_CYCLE", async () => {
      mockIssueFind
        .mockResolvedValueOnce(fakeSourceIssue)
        .mockResolvedValueOnce(fakeTargetIssue);

      // Simulate target→source path: target already reaches source (cycle)
      // reachable(target.id, source.id) → traverses target's outgoing edges
      mockDepFindMany.mockImplementation(async ({ where }: any) => {
        // When traversing from target (issue-tgt-1), it finds a path to source
        if (where.sourceId === "issue-tgt-1") {
          return [{ targetId: "issue-src-1" }];
        }
        return [];
      });

      await expect(
        createDependency("KAN-1", { targetKey: "KAN-2", type: "FS", lagDays: 0 }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 400,
        code: "DEPENDENCY_CYCLE",
      });

      expect(mockDepCreate).not.toHaveBeenCalled();
    });
  });

  // ── 1.2.4: duplicate same-type edge → P2002 mapped to 409 DEPENDENCY_EXISTS ──

  describe("createDependency — duplicate same-type edge", () => {
    it("[RED→GREEN] Prisma P2002 on duplicate dep → AppError 409 DEPENDENCY_EXISTS", async () => {
      const { PrismaClientKnownRequestError } = await import("@prisma/client/runtime/library.js");
      mockIssueFind
        .mockResolvedValueOnce(fakeSourceIssue)
        .mockResolvedValueOnce(fakeTargetIssue);
      mockDepFindMany.mockResolvedValue([]);

      const p2002Error = new PrismaClientKnownRequestError(
        "Unique constraint failed on the constraint: `IssueDependency_sourceId_targetId_type_key`",
        { code: "P2002", clientVersion: "6.0.0" },
      );
      mockDepCreate.mockRejectedValue(p2002Error);

      await expect(
        createDependency("KAN-1", { targetKey: "KAN-2", type: "blocks", lagDays: 0 }, "member-1"),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "DEPENDENCY_EXISTS",
      });
    });

    it("[RED] different-type edge between same pair is allowed", async () => {
      mockIssueFind
        .mockResolvedValueOnce(fakeSourceIssue)
        .mockResolvedValueOnce(fakeTargetIssue);
      mockDepFindMany.mockResolvedValue([]);
      const dep = makeDep({ type: "FS", lagDays: 2 });
      mockDepCreate.mockResolvedValue(dep);

      // Should NOT throw — different type on same pair is permitted
      const result = await createDependency(
        "KAN-1",
        { targetKey: "KAN-2", type: "FS", lagDays: 2 },
        "member-1",
      );
      expect(result).toMatchObject({ type: "FS", lagDays: 2 });
    });
  });

  // ── 1.2.5: deleteDependency — not found → DEPENDENCY_NOT_FOUND 404 ────────

  describe("deleteDependency — not found guard", () => {
    it("[RED] rejects unknown id → 404 DEPENDENCY_NOT_FOUND", async () => {
      mockDepFindUnique.mockResolvedValue(null);

      await expect(deleteDependency("dep-missing", "member-1", "ws-1")).rejects.toMatchObject({
        statusCode: 404,
        code: "DEPENDENCY_NOT_FOUND",
      });

      expect(mockDepDelete).not.toHaveBeenCalled();
    });
  });

  // ── 1.2.6: createDependency stores lagDays + emits dependency.changed ──────

  describe("createDependency — success path", () => {
    it("[RED] stores lagDays and emits dependency.changed with action='created'", async () => {
      mockIssueFind
        .mockResolvedValueOnce(fakeSourceIssue)
        .mockResolvedValueOnce(fakeTargetIssue);
      mockDepFindMany.mockResolvedValue([]);
      const dep = makeDep({ type: "SS", lagDays: 3 });
      mockDepCreate.mockResolvedValue(dep);

      await createDependency("KAN-1", { targetKey: "KAN-2", type: "SS", lagDays: 3 }, "member-1", "web");

      expect(mockDepCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ lagDays: 3, type: "SS" }),
        }),
      );

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "dependency.changed",
          payload: expect.objectContaining({
            action: "created",
            lagDays: 3,
            depType: "SS",
          }),
        }),
      );
    });

    it("[RED] all 5 dep types are accepted (FS, SS, FF, SF, blocks)", async () => {
      for (const depType of ["blocks", "FS", "SS", "FF", "SF"] as const) {
        vi.resetAllMocks();
        mockIssueFind
          .mockResolvedValueOnce(fakeSourceIssue)
          .mockResolvedValueOnce(fakeTargetIssue);
        mockDepFindMany.mockResolvedValue([]);
        const dep = makeDep({ type: depType });
        mockDepCreate.mockResolvedValue(dep);

        const result = await createDependency(
          "KAN-1",
          { targetKey: "KAN-2", type: depType, lagDays: 0 },
          "member-1",
        );
        expect(result).toMatchObject({ type: depType });
      }
    });
  });

  // ── 1.2.7: deleteDependency emits dependency.changed with action='deleted' ─

  describe("deleteDependency — success path", () => {
    it("[RED] emits dependency.changed with action='deleted' on success", async () => {
      const dep = makeDep();
      mockDepFindUnique.mockResolvedValue(dep);
      mockDepDelete.mockResolvedValue(dep);

      await deleteDependency("dep-1", "member-1", "ws-1", "claude-code");

      expect(mockEmit).toHaveBeenCalledWith(
        expect.objectContaining({
          type: "dependency.changed",
          workspaceId: "ws-1",
          actorId: "member-1",
          via: "claude-code",
          payload: expect.objectContaining({
            dependencyId: "dep-1",
            action: "deleted",
          }),
        }),
      );
    });

    it("[RED] does not throw when event emission fails (fire-and-forget guard)", async () => {
      const dep = makeDep();
      mockDepFindUnique.mockResolvedValue(dep);
      mockDepDelete.mockResolvedValue(dep);
      mockEmit.mockImplementationOnce(() => {
        throw new Error("event bus dead");
      });

      await expect(deleteDependency("dep-1", "member-1", "ws-1")).resolves.toMatchObject({ ok: true });
    });
  });
});
