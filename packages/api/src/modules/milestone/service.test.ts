import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Mock prisma ────────────────────────────────────────────────────────────
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    milestone: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
    },
    issue: { findUnique: vi.fn() },
    milestoneDeliverable: {
      findUnique: vi.fn(),
      create: vi.fn(),
      delete: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));

import { prisma } from "../../config/prisma.js";
import {
  createMilestone,
  listMilestones,
  updateMilestone,
  attachDeliverable,
  detachDeliverable,
} from "./service.js";
import { AppError } from "../../shared/types.js";

const mockMilestoneFind = vi.mocked(prisma.milestone.findUnique);
const mockMilestoneFindMany = vi.mocked(prisma.milestone.findMany);
const mockMilestoneCreate = vi.mocked(prisma.milestone.create);
const mockMilestoneUpdate = vi.mocked(prisma.milestone.update);
const mockIssueFind = vi.mocked(prisma.issue.findUnique);
const mockDeliverableCreate = vi.mocked(prisma.milestoneDeliverable.create);
const mockDeliverableFind = vi.mocked(prisma.milestoneDeliverable.findUnique);
const mockDeliverableDelete = vi.mocked(prisma.milestoneDeliverable.delete);

// ── Fake objects ───────────────────────────────────────────────────────────

const fakeMilestone = {
  id: "ms-1",
  name: "Release 1.0",
  target: new Date("2026-09-01"),
  status: "upcoming" as const,
  metOn: null,
  projectId: "proj-a",
  ownerId: "member-1",
  createdAt: new Date(),
  deliverables: [],
} as any;

const fakeIssue = {
  id: "issue-1",
  key: "KAN-1",
  projectId: "proj-a",
} as any;

const fakeIssueOtherProject = {
  id: "issue-9",
  key: "KAN-9",
  projectId: "proj-other",
} as any;

// ── Test suite ─────────────────────────────────────────────────────────────

describe("MilestoneService", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  // ── 2.2.1: attachDeliverable rejects issue not in milestone's project ─────

  describe("attachDeliverable — cross-project guard", () => {
    it("[RED] rejects issue from another project → 422 DELIVERABLE_PROJECT_MISMATCH", async () => {
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone);
      mockIssueFind.mockResolvedValueOnce(fakeIssueOtherProject);

      await expect(
        attachDeliverable("ms-1", "KAN-9", "member-1"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "DELIVERABLE_PROJECT_MISMATCH",
      });

      expect(mockDeliverableCreate).not.toHaveBeenCalled();
    });
  });

  // ── 2.2.2: attachDeliverable duplicate → Prisma P2002 → 409 ──────────────

  describe("attachDeliverable — duplicate deliverable guard", () => {
    it("[RED] duplicate issue in milestone → P2002 → 409 DUPLICATE_DELIVERABLE", async () => {
      const { PrismaClientKnownRequestError } = await import("@prisma/client/runtime/library.js");

      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone);
      mockIssueFind.mockResolvedValueOnce(fakeIssue);

      const p2002 = new PrismaClientKnownRequestError(
        "Unique constraint failed on the constraint: `milestone_deliverables_milestone_id_issue_id_key`",
        { code: "P2002", clientVersion: "6.0.0" },
      );
      mockDeliverableCreate.mockRejectedValue(p2002);

      await expect(
        attachDeliverable("ms-1", "KAN-1", "member-1"),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "DUPLICATE_DELIVERABLE",
      });
    });
  });

  // ── 2.2.3: updateMilestone with unknown id → 404 ──────────────────────────

  describe("updateMilestone — not found guard", () => {
    it("[RED] unknown milestone id → 404 MILESTONE_NOT_FOUND", async () => {
      mockMilestoneFind.mockResolvedValueOnce(null);

      await expect(
        updateMilestone("ms-missing", { name: "Updated" }),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "MILESTONE_NOT_FOUND",
      });

      expect(mockMilestoneUpdate).not.toHaveBeenCalled();
    });
  });

  // ── 2.2.4: createMilestone defaults ownerId to actorMemberId ──────────────

  describe("createMilestone — ownerId default to actor", () => {
    it("[RED] ownerId absent → defaults to actorMemberId; status defaults to upcoming", async () => {
      const created = {
        ...fakeMilestone,
        ownerId: "actor-member-id",
        status: "upcoming",
      };
      mockMilestoneCreate.mockResolvedValueOnce(created);

      const result = await createMilestone(
        "proj-a",
        { name: "Release 1.0", target: "2026-09-01T00:00:00.000Z" },
        "actor-member-id",
      );

      expect(mockMilestoneCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerId: "actor-member-id",
            status: "upcoming",
          }),
        }),
      );
      expect(result.ownerId).toBe("actor-member-id");
      expect(result.status).toBe("upcoming");
    });

    it("[RED] ownerId provided → uses provided ownerId", async () => {
      const created = {
        ...fakeMilestone,
        ownerId: "custom-owner-id",
      };
      mockMilestoneCreate.mockResolvedValueOnce(created);

      await createMilestone(
        "proj-a",
        { name: "Release 1.0", target: "2026-09-01T00:00:00.000Z", ownerId: "custom-owner-id" },
        "actor-member-id",
      );

      expect(mockMilestoneCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            ownerId: "custom-owner-id",
          }),
        }),
      );
    });
  });

  // ── 2.2.5: detachDeliverable with unknown deliverable row → 404 ──────────

  describe("detachDeliverable — not found guard", () => {
    it("[RED] deliverable row not found → 404 DELIVERABLE_NOT_FOUND", async () => {
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone);
      mockDeliverableFind.mockResolvedValueOnce(null);

      await expect(
        detachDeliverable("ms-1", "issue-missing"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "DELIVERABLE_NOT_FOUND",
      });

      expect(mockDeliverableDelete).not.toHaveBeenCalled();
    });
  });

  // ── Extra: updateMilestone with metOn settable ────────────────────────────

  describe("updateMilestone — metOn + status settable", () => {
    it("[RED] can set status to met and metOn manually", async () => {
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone);
      const updated = { ...fakeMilestone, status: "met", metOn: new Date("2026-08-30") };
      mockMilestoneUpdate.mockResolvedValueOnce(updated);

      const result = await updateMilestone("ms-1", {
        status: "met",
        metOn: "2026-08-30T00:00:00.000Z",
      });

      expect(mockMilestoneUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "met" }),
        }),
      );
      expect(result.status).toBe("met");
    });
  });

  // ── Extra: listMilestones ─────────────────────────────────────────────────

  describe("listMilestones", () => {
    it("[RED] returns milestones for a project with deliverables", async () => {
      mockMilestoneFindMany.mockResolvedValueOnce([fakeMilestone]);

      const result = await listMilestones("proj-a");

      expect(mockMilestoneFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: "proj-a" },
        }),
      );
      expect(result).toHaveLength(1);
    });
  });

  // ── Extra: attachDeliverable milestone not found → 404 ───────────────────

  describe("attachDeliverable — milestone not found", () => {
    it("[RED] unknown milestoneId → 404 MILESTONE_NOT_FOUND", async () => {
      mockMilestoneFind.mockResolvedValueOnce(null);

      await expect(
        attachDeliverable("ms-missing", "KAN-1", "member-1"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "MILESTONE_NOT_FOUND",
      });
    });
  });

  // ── Extra: attachDeliverable issue not found → 404 ───────────────────────

  describe("attachDeliverable — issue not found", () => {
    it("[RED] unknown issue key → 404 ISSUE_NOT_FOUND", async () => {
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone);
      mockIssueFind.mockResolvedValueOnce(null);

      await expect(
        attachDeliverable("ms-1", "KAN-MISSING", "member-1"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "ISSUE_NOT_FOUND",
      });
    });
  });
});
