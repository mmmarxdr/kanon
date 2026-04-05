import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for workspace member management service functions.
 * Tests: addMember, changeMemberRole, removeMember, listMembers
 */

// Mock the prisma module
vi.mock("../../config/prisma.js", () => ({
  prisma: {
    member: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findFirst: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      count: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "../../config/prisma.js";
import { addMember, changeMemberRole, removeMember, listMembers } from "./service.js";

const mockMemberFindMany = vi.mocked(prisma.member.findMany);
const mockMemberFindUnique = vi.mocked(prisma.member.findUnique);
const mockMemberFindFirst = vi.mocked(prisma.member.findFirst);
const mockMemberCreate = vi.mocked(prisma.member.create);
const mockMemberUpdate = vi.mocked(prisma.member.update);
const mockMemberDelete = vi.mocked(prisma.member.delete);
const mockMemberCount = vi.mocked(prisma.member.count);
const mockUserFindUnique = vi.mocked(prisma.user.findUnique);

describe("Member Service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── listMembers ─────────────────────────────────────────────────────

  describe("listMembers", () => {
    it("returns members with user info", async () => {
      const mockMembers = [
        {
          id: "m1",
          username: "alice",
          role: "owner",
          createdAt: new Date(),
          user: { email: "alice@test.com", displayName: "Alice", avatarUrl: null },
        },
        {
          id: "m2",
          username: "bob",
          role: "member",
          createdAt: new Date(),
          user: { email: "bob@test.com", displayName: "Bob", avatarUrl: null },
        },
      ];
      mockMemberFindMany.mockResolvedValue(mockMembers as any);

      const result = await listMembers("ws-1");

      expect(result).toHaveLength(2);
      expect(mockMemberFindMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { workspaceId: "ws-1" },
        }),
      );
    });
  });

  // ── addMember ───────────────────────────────────────────────────────

  describe("addMember", () => {
    it("adds a user as a member successfully", async () => {
      mockUserFindUnique.mockResolvedValue({
        id: "u1",
        email: "newuser@test.com",
        displayName: "New User",
      } as any);
      mockMemberFindUnique.mockResolvedValue(null); // no existing membership
      mockMemberCreate.mockResolvedValue({
        id: "m-new",
        username: "newuser",
        role: "member",
        userId: "u1",
        workspaceId: "ws-1",
        user: { email: "newuser@test.com", displayName: "New User", avatarUrl: null },
      } as any);

      const result = await addMember("ws-1", "newuser@test.com", "member", "owner");

      expect(result.id).toBe("m-new");
      expect(result.role).toBe("member");
      expect(mockMemberCreate).toHaveBeenCalled();
    });

    it("throws 404 when user is not found", async () => {
      mockUserFindUnique.mockResolvedValue(null);

      await expect(
        addMember("ws-1", "unknown@example.com", "member", "owner"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "USER_NOT_FOUND",
      });
    });

    it("throws 409 for duplicate membership", async () => {
      mockUserFindUnique.mockResolvedValue({
        id: "u1",
        email: "existing@test.com",
        displayName: "Existing",
      } as any);
      // First findUnique call is for duplicate check
      mockMemberFindUnique.mockResolvedValueOnce({ id: "m-existing" } as any);

      await expect(
        addMember("ws-1", "existing@test.com", "member", "owner"),
      ).rejects.toMatchObject({
        statusCode: 409,
        code: "ALREADY_MEMBER",
      });
    });

    it("throws 403 when admin tries to add user as owner", async () => {
      await expect(
        addMember("ws-1", "anyone@test.com", "owner", "admin"),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
    });
  });

  // ── changeMemberRole ────────────────────────────────────────────────

  describe("changeMemberRole", () => {
    it("changes role successfully", async () => {
      mockMemberFindFirst.mockResolvedValue({
        id: "m1",
        role: "member",
        workspaceId: "ws-1",
        userId: "u1",
      } as any);
      mockMemberUpdate.mockResolvedValue({
        id: "m1",
        role: "admin",
        user: { email: "u@test.com", displayName: null, avatarUrl: null },
      } as any);

      const result = await changeMemberRole("ws-1", "m1", "admin", "owner");
      expect(result.role).toBe("admin");
    });

    it("throws 422 when demoting the last owner", async () => {
      mockMemberFindFirst.mockResolvedValue({
        id: "m1",
        role: "owner",
        workspaceId: "ws-1",
        userId: "u1",
      } as any);
      mockMemberCount.mockResolvedValue(1);

      await expect(
        changeMemberRole("ws-1", "m1", "admin", "owner"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "LAST_OWNER",
      });
    });

    it("throws 403 when admin tries to promote to owner", async () => {
      mockMemberFindFirst.mockResolvedValue({
        id: "m1",
        role: "member",
        workspaceId: "ws-1",
        userId: "u1",
      } as any);

      await expect(
        changeMemberRole("ws-1", "m1", "owner", "admin"),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
    });

    it("throws 404 when member not found", async () => {
      mockMemberFindFirst.mockResolvedValue(null);

      await expect(
        changeMemberRole("ws-1", "m-nonexistent", "admin", "owner"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "MEMBER_NOT_FOUND",
      });
    });
  });

  // ── removeMember ────────────────────────────────────────────────────

  describe("removeMember", () => {
    it("removes a member successfully", async () => {
      mockMemberFindFirst.mockResolvedValue({
        id: "m1",
        role: "member",
        workspaceId: "ws-1",
        userId: "u-target",
      } as any);
      mockMemberDelete.mockResolvedValue({} as any);

      await expect(
        removeMember("ws-1", "m1", "u-acting", "admin"),
      ).resolves.toBeUndefined();
      expect(mockMemberDelete).toHaveBeenCalledWith({ where: { id: "m1" } });
    });

    it("throws 422 when removing the last owner", async () => {
      mockMemberFindFirst.mockResolvedValue({
        id: "m1",
        role: "owner",
        workspaceId: "ws-1",
        userId: "u-owner",
      } as any);
      mockMemberCount.mockResolvedValue(1);

      await expect(
        removeMember("ws-1", "m1", "u-owner", "owner"),
      ).rejects.toMatchObject({
        statusCode: 422,
        code: "LAST_OWNER",
      });
    });

    it("throws 403 when admin tries to remove an owner", async () => {
      mockMemberFindFirst.mockResolvedValue({
        id: "m1",
        role: "owner",
        workspaceId: "ws-1",
        userId: "u-owner",
      } as any);

      await expect(
        removeMember("ws-1", "m1", "u-admin", "admin"),
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORBIDDEN",
      });
    });

    it("throws 404 when member not found", async () => {
      mockMemberFindFirst.mockResolvedValue(null);

      await expect(
        removeMember("ws-1", "m-nonexistent", "u-acting", "admin"),
      ).rejects.toMatchObject({
        statusCode: 404,
        code: "MEMBER_NOT_FOUND",
      });
    });
  });
});
