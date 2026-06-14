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
    member: { findUnique: vi.fn() },
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
        updateMilestone("ms-missing", { name: "Updated" }, "workspace-a"),
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

      // No ownerId in body → no member check, defaults to actor
      const result = await createMilestone(
        "proj-a",
        { name: "Release 1.0", target: "2026-09-01T00:00:00.000Z" },
        "actor-member-id",
        "workspace-a",
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

    it("[RED] ownerId provided → validates workspace membership then uses provided ownerId", async () => {
      const { prisma: mockPrisma } = await import("../../config/prisma.js");
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValueOnce({ id: "custom-owner-id", workspaceId: "workspace-a" } as any);
      const created = {
        ...fakeMilestone,
        ownerId: "custom-owner-id",
      };
      mockMilestoneCreate.mockResolvedValueOnce(created);

      await createMilestone(
        "proj-a",
        { name: "Release 1.0", target: "2026-09-01T00:00:00.000Z", ownerId: "custom-owner-id" },
        "actor-member-id",
        "workspace-a",
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
  // NOTE: The implementation was updated to use a direct P2025-catching delete
  // (CRITICAL 3 fix). This test now matches the new direct-delete pattern.

  describe("detachDeliverable — not found guard (direct delete)", () => {
    it("[RED] deliverable row not found → 404 DELIVERABLE_NOT_FOUND (via direct delete)", async () => {
      const { PrismaClientKnownRequestError } = await import("@prisma/client/runtime/library.js");
      const p2025 = new PrismaClientKnownRequestError(
        "An operation failed because it depends on one or more records that were required but not found.",
        { code: "P2025", clientVersion: "6.0.0" },
      );
      mockDeliverableDelete.mockRejectedValueOnce(p2025);

      await expect(
        detachDeliverable("ms-1", "issue-missing"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "DELIVERABLE_NOT_FOUND",
      });
    });
  });

  // ── Extra: updateMilestone with metOn settable (now requires workspaceId) ─

  describe("updateMilestone — metOn + status settable", () => {
    it("[RED] can set status to met and metOn manually (coherent)", async () => {
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone); // status: "upcoming", metOn: null
      const updated = { ...fakeMilestone, status: "met", metOn: new Date("2026-08-30") };
      mockMilestoneUpdate.mockResolvedValueOnce(updated);

      const result = await updateMilestone("ms-1", {
        status: "met",
        metOn: "2026-08-30T00:00:00.000Z",
      }, "workspace-a");

      expect(mockMilestoneUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: "met" }),
        }),
      );
      expect(result.status).toBe("met");
    });
  });

  // ── CRITICAL 1: createMilestone cross-workspace ownerId → 422 ────────────

  describe("createMilestone — cross-workspace ownerId guard", () => {
    it("[RED] ownerId not a member of the workspace → 422 INVALID_OWNER", async () => {
      // prisma.member.findUnique returns null (ownerId not in workspace)
      const { prisma: mockPrisma } = await import("../../config/prisma.js");
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValueOnce(null);

      await expect(
        createMilestone(
          "proj-a",
          { name: "Release 2.0", target: "2026-09-01T00:00:00.000Z", ownerId: "foreign-member" },
          "actor-member-id",
          "workspace-a",
        ),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_OWNER",
      });

      expect(mockMilestoneCreate).not.toHaveBeenCalled();
    });

    it("[RED] ownerId is a member of the workspace → write proceeds", async () => {
      const { prisma: mockPrisma } = await import("../../config/prisma.js");
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValueOnce({ id: "foreign-member", workspaceId: "workspace-a" } as any);
      mockMilestoneCreate.mockResolvedValueOnce({ ...fakeMilestone, ownerId: "foreign-member" });

      const result = await createMilestone(
        "proj-a",
        { name: "Release 2.0", target: "2026-09-01T00:00:00.000Z", ownerId: "foreign-member" },
        "actor-member-id",
        "workspace-a",
      );

      expect(mockMilestoneCreate).toHaveBeenCalled();
      expect(result.ownerId).toBe("foreign-member");
    });
  });

  // ── CRITICAL 1: updateMilestone cross-workspace ownerId → 422 ────────────

  describe("updateMilestone — cross-workspace ownerId guard", () => {
    it("[RED] ownerId not a member of the workspace → 422 INVALID_OWNER", async () => {
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone);
      const { prisma: mockPrisma } = await import("../../config/prisma.js");
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValueOnce(null);

      await expect(
        updateMilestone("ms-1", { ownerId: "foreign-member" }, "workspace-a"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_OWNER",
      });

      expect(mockMilestoneUpdate).not.toHaveBeenCalled();
    });

    it("[RED] ownerId is a member of the workspace → write proceeds", async () => {
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone);
      const { prisma: mockPrisma } = await import("../../config/prisma.js");
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValueOnce({ id: "foreign-member", workspaceId: "workspace-a" } as any);
      mockMilestoneUpdate.mockResolvedValueOnce({ ...fakeMilestone, ownerId: "foreign-member" });

      const result = await updateMilestone("ms-1", { ownerId: "foreign-member" }, "workspace-a");
      expect(mockMilestoneUpdate).toHaveBeenCalled();
      expect(result.ownerId).toBe("foreign-member");
    });
  });

  // ── CRITICAL 2: P2003 FK violation → 422 INVALID_OWNER ──────────────────

  describe("createMilestone — P2003 FK violation → 422", () => {
    it("[RED] Prisma P2003 on create → 422 INVALID_OWNER", async () => {
      const { prisma: mockPrisma } = await import("../../config/prisma.js");
      // owner passes membership check
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValueOnce({ id: "some-id", workspaceId: "workspace-a" } as any);
      const { PrismaClientKnownRequestError } = await import("@prisma/client/runtime/library.js");
      const p2003 = new PrismaClientKnownRequestError(
        "Foreign key constraint failed on the field: `ownerId`",
        { code: "P2003", clientVersion: "6.0.0" },
      );
      mockMilestoneCreate.mockRejectedValueOnce(p2003);

      await expect(
        createMilestone("proj-a", { name: "R1", target: "2026-09-01T00:00:00.000Z", ownerId: "some-id" }, "actor", "workspace-a"),
      ).rejects.toMatchObject({ statusCode: 422, code: "INVALID_OWNER" });
    });
  });

  describe("updateMilestone — P2003 FK violation → 422", () => {
    it("[RED] Prisma P2003 on update → 422 INVALID_OWNER", async () => {
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone);
      const { prisma: mockPrisma } = await import("../../config/prisma.js");
      vi.mocked(mockPrisma.member.findUnique).mockResolvedValueOnce({ id: "some-id", workspaceId: "workspace-a" } as any);
      const { PrismaClientKnownRequestError } = await import("@prisma/client/runtime/library.js");
      const p2003 = new PrismaClientKnownRequestError(
        "Foreign key constraint failed on the field: `ownerId`",
        { code: "P2003", clientVersion: "6.0.0" },
      );
      mockMilestoneUpdate.mockRejectedValueOnce(p2003);

      await expect(
        updateMilestone("ms-1", { ownerId: "some-id" }, "workspace-a"),
      ).rejects.toMatchObject({ statusCode: 422, code: "INVALID_OWNER" });
    });
  });

  // ── CRITICAL 3: detachDeliverable TOCTOU — direct delete, P2025 → 404 ──

  describe("detachDeliverable — direct delete (no TOCTOU)", () => {
    it("[RED] deliverable not found (P2025 from direct delete) → 404 DELIVERABLE_NOT_FOUND", async () => {
      const { PrismaClientKnownRequestError } = await import("@prisma/client/runtime/library.js");
      const p2025 = new PrismaClientKnownRequestError(
        "An operation failed because it depends on one or more records that were required but not found.",
        { code: "P2025", clientVersion: "6.0.0" },
      );
      mockDeliverableDelete.mockRejectedValueOnce(p2025);

      await expect(
        detachDeliverable("ms-1", "issue-missing"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "DELIVERABLE_NOT_FOUND",
      });
    });
  });

  // ── WARNING 4: status/metOn coherence guard ──────────────────────────────

  describe("updateMilestone — status/metOn coherence", () => {
    it("[RED] metOn set while resulting status != 'met' → 422 INVALID_MILESTONE_STATE", async () => {
      // existing status is "upcoming", patch sets metOn but not status → incoherent
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone); // status: "upcoming"

      await expect(
        updateMilestone("ms-1", { metOn: "2026-08-30T00:00:00.000Z" }, "workspace-a"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_MILESTONE_STATE",
      });

      expect(mockMilestoneUpdate).not.toHaveBeenCalled();
    });

    it("[RED] status set to 'met' without metOn → 422 INVALID_MILESTONE_STATE", async () => {
      // existing has no metOn; patch sets status to "met" but no metOn → incoherent
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone); // metOn: null

      await expect(
        updateMilestone("ms-1", { status: "met" }, "workspace-a"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_MILESTONE_STATE",
      });

      expect(mockMilestoneUpdate).not.toHaveBeenCalled();
    });

    it("[RED] status='met' WITH metOn → OK (coherent)", async () => {
      mockMilestoneFind.mockResolvedValueOnce(fakeMilestone);
      const updated = { ...fakeMilestone, status: "met", metOn: new Date("2026-08-30") };
      mockMilestoneUpdate.mockResolvedValueOnce(updated);

      const result = await updateMilestone("ms-1", { status: "met", metOn: "2026-08-30T00:00:00.000Z" }, "workspace-a");
      expect(result.status).toBe("met");
    });

    it("[RED] existing status='met' with metOn, patch clears metOn (null) while keeping 'met' → incoherent → 422", async () => {
      // existing has status "met" and a metOn; patching metOn=null without changing status → incoherent
      const metMilestone = { ...fakeMilestone, status: "met" as const, metOn: new Date("2026-08-01") };
      mockMilestoneFind.mockResolvedValueOnce(metMilestone);

      await expect(
        updateMilestone("ms-1", { metOn: null }, "workspace-a"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "INVALID_MILESTONE_STATE",
      });

      expect(mockMilestoneUpdate).not.toHaveBeenCalled();
    });

    it("[RED] existing status='met' patch changes status away from 'met', clears metOn → OK (coherent)", async () => {
      const metMilestone = { ...fakeMilestone, status: "met" as const, metOn: new Date("2026-08-01") };
      mockMilestoneFind.mockResolvedValueOnce(metMilestone);
      const updated = { ...metMilestone, status: "at_risk", metOn: null };
      mockMilestoneUpdate.mockResolvedValueOnce(updated);

      const result = await updateMilestone("ms-1", { status: "at_risk", metOn: null }, "workspace-a");
      expect(result.status).toBe("at_risk");
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
