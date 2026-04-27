import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireRole, requireCycleRole, requireCycleMember } from "./require-role.js";
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Unit tests for requireRole middleware.
 * The new signature: requireRole(workspaceIdParam, ...roles)
 * - Reads workspaceId from request.params[workspaceIdParam]
 * - Queries Member table by userId + workspaceId to get role
 * - Checks role against allowed list
 *
 * Since this hits Prisma, we mock the prisma.member.findUnique call.
 */

// Mock the prisma module
vi.mock("../config/prisma.js", () => ({
  prisma: {
    member: {
      findUnique: vi.fn(),
    },
    cycle: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "../config/prisma.js";
const mockFindUnique = vi.mocked(prisma.member.findUnique);
const mockCycleFindUnique = vi.mocked(prisma.cycle.findUnique);

function makeRequest(user: any, params?: Record<string, string>): FastifyRequest {
  return {
    user,
    params: params ?? {},
  } as unknown as FastifyRequest;
}

const dummyReply = {} as FastifyReply;

describe("requireRole", () => {
  beforeEach(() => {
    mockFindUnique.mockReset();
    mockCycleFindUnique.mockReset();
  });

  it("passes when member has an allowed role", async () => {
    mockFindUnique.mockResolvedValue({ id: "m1", role: "admin" } as any);

    const handler = requireRole("id", "owner", "admin");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { userId_workspaceId: { userId: "u1", workspaceId: "ws-1" } },
      select: { id: true, role: true },
    });
    // Verify request.member is set
    expect(request.member).toEqual({
      id: "m1",
      role: "admin",
      workspaceId: "ws-1",
      userId: "u1",
    });
  });

  it("passes for exact single role match", async () => {
    mockFindUnique.mockResolvedValue({ id: "m1", role: "owner" } as any);

    const handler = requireRole("id", "owner");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
  });

  it("rejects when member role is not in allowed list", async () => {
    mockFindUnique.mockResolvedValue({ id: "m1", role: "member" } as any);

    const handler = requireRole("id", "owner", "admin");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    await expect(handler(request, dummyReply, vi.fn())).rejects.toThrow(
      /requires at least the "admin" role/,
    );
  });

  it("returns 403 status code for unauthorized role", async () => {
    mockFindUnique.mockResolvedValue({ id: "m1", role: "viewer" } as any);

    const handler = requireRole("id", "owner");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
    }
  });

  it("returns 403 when user is not a member of the workspace", async () => {
    mockFindUnique.mockResolvedValue(null);

    const handler = requireRole("id", "owner");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
    }
  });

  it("returns 401 when user is null (unauthenticated)", async () => {
    const handler = requireRole("id", "owner");
    const request = makeRequest(null, { id: "ws-1" });
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns 401 when user is undefined", async () => {
    const handler = requireRole("id", "admin");
    const request = makeRequest(undefined, { id: "ws-1" });
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns 400 when workspace param is missing", async () => {
    const handler = requireRole("id", "owner");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      {}, // no 'id' param
    );
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(400);
      expect(err.code).toBe("WORKSPACE_REQUIRED");
    }
  });

  it("handles multiple allowed roles correctly", async () => {
    mockFindUnique.mockResolvedValue({ id: "m1", role: "member" } as any);

    const handler = requireRole("id", "owner", "admin", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
  });

  // ── Role hierarchy tests ────────────────────────────────────────────

  describe("role hierarchy enforcement", () => {
    it("owner meets all minimum roles", async () => {
      for (const minRole of ["viewer", "member", "admin", "owner"] as const) {
        mockFindUnique.mockResolvedValue({ id: "m1", role: "owner" } as any);
        const handler = requireRole("id", minRole);
        const request = makeRequest(
          { userId: "u1", email: "u@test.com" },
          { id: "ws-1" },
        );
        await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
      }
    });

    it("admin meets admin, member, and viewer but not owner", async () => {
      for (const minRole of ["viewer", "member", "admin"] as const) {
        mockFindUnique.mockResolvedValue({ id: "m1", role: "admin" } as any);
        const handler = requireRole("id", minRole);
        const request = makeRequest(
          { userId: "u1", email: "u@test.com" },
          { id: "ws-1" },
        );
        await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
      }

      // admin does NOT meet owner
      mockFindUnique.mockResolvedValue({ id: "m1", role: "admin" } as any);
      const handler = requireRole("id", "owner");
      const request = makeRequest(
        { userId: "u1", email: "u@test.com" },
        { id: "ws-1" },
      );
      await expect(handler(request, dummyReply, vi.fn())).rejects.toThrow(/requires at least/);
    });

    it("member meets member and viewer but not admin or owner", async () => {
      for (const minRole of ["viewer", "member"] as const) {
        mockFindUnique.mockResolvedValue({ id: "m1", role: "member" } as any);
        const handler = requireRole("id", minRole);
        const request = makeRequest(
          { userId: "u1", email: "u@test.com" },
          { id: "ws-1" },
        );
        await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
      }

      for (const minRole of ["admin", "owner"] as const) {
        mockFindUnique.mockResolvedValue({ id: "m1", role: "member" } as any);
        const handler = requireRole("id", minRole);
        const request = makeRequest(
          { userId: "u1", email: "u@test.com" },
          { id: "ws-1" },
        );
        await expect(handler(request, dummyReply, vi.fn())).rejects.toThrow(/requires at least/);
      }
    });

    it("viewer meets only viewer, not member/admin/owner", async () => {
      mockFindUnique.mockResolvedValue({ id: "m1", role: "viewer" } as any);
      const viewerHandler = requireRole("id", "viewer");
      const request = makeRequest(
        { userId: "u1", email: "u@test.com" },
        { id: "ws-1" },
      );
      await expect(viewerHandler(request, dummyReply, vi.fn())).resolves.toBeUndefined();

      for (const minRole of ["member", "admin", "owner"] as const) {
        mockFindUnique.mockResolvedValue({ id: "m1", role: "viewer" } as any);
        const handler = requireRole("id", minRole);
        const req = makeRequest(
          { userId: "u1", email: "u@test.com" },
          { id: "ws-1" },
        );
        await expect(handler(req, dummyReply, vi.fn())).rejects.toThrow(/requires at least/);
      }
    });
  });

  // ── resolveAndCheckMember behavior ──────────────────────────────────

  describe("resolveAndCheckMember (via requireRole)", () => {
    it("sets request.member with correct MemberContext shape", async () => {
      mockFindUnique.mockResolvedValue({ id: "m-abc", role: "admin" } as any);
      const handler = requireRole("id", "admin");
      const request = makeRequest(
        { userId: "u-xyz", email: "u@test.com" },
        { id: "ws-123" },
      );
      await handler(request, dummyReply, vi.fn());

      expect(request.member).toEqual({
        id: "m-abc",
        role: "admin",
        workspaceId: "ws-123",
        userId: "u-xyz",
      });
    });

    it("throws 403 with FORBIDDEN code for non-member", async () => {
      mockFindUnique.mockResolvedValue(null);
      const handler = requireRole("id", "member");
      const request = makeRequest(
        { userId: "u1", email: "u@test.com" },
        { id: "ws-1" },
      );
      try {
        await handler(request, dummyReply, vi.fn());
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("not a member");
      }
    });

    it("throws 403 with descriptive message for insufficient role", async () => {
      mockFindUnique.mockResolvedValue({ id: "m1", role: "viewer" } as any);
      const handler = requireRole("id", "admin");
      const request = makeRequest(
        { userId: "u1", email: "u@test.com" },
        { id: "ws-1" },
      );
      try {
        await handler(request, dummyReply, vi.fn());
        expect.fail("Should have thrown");
      } catch (err: any) {
        expect(err.statusCode).toBe(403);
        expect(err.code).toBe("FORBIDDEN");
        expect(err.message).toContain("admin");
      }
    });
  });
});

// ---------------------------------------------------------------------------
// requireCycleRole / requireCycleMember
// ---------------------------------------------------------------------------

describe("requireCycleRole", () => {
  const CYCLE_ID = "cycle-uuid-1234";
  const WORKSPACE_ID = "ws-uuid-5678";

  beforeEach(() => {
    mockFindUnique.mockReset();
    mockCycleFindUnique.mockReset();
  });

  it("passes and sets request.member when cycle exists and user is a member with sufficient role", async () => {
    mockCycleFindUnique.mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
    } as any);
    mockFindUnique.mockResolvedValue({ id: "m1", role: "member" } as any);

    const handler = requireCycleRole("id", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: CYCLE_ID },
    );
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
    expect(mockCycleFindUnique).toHaveBeenCalledWith({
      where: { id: CYCLE_ID },
      select: { project: { select: { workspaceId: true } } },
    });
    expect(request.member).toEqual({
      id: "m1",
      role: "member",
      workspaceId: WORKSPACE_ID,
      userId: "u1",
    });
  });

  it("throws 401 when user is not authenticated", async () => {
    const handler = requireCycleRole("id", "member");
    const request = makeRequest(null, { id: CYCLE_ID });
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    }
    // prisma should NOT be called when unauthenticated
    expect(mockCycleFindUnique).not.toHaveBeenCalled();
  });

  it("throws 404 when cycle does not exist", async () => {
    mockCycleFindUnique.mockResolvedValue(null);

    const handler = requireCycleRole("id", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: CYCLE_ID },
    );
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(404);
      expect(err.code).toBe("CYCLE_NOT_FOUND");
    }
    // member lookup should NOT be called when cycle is missing
    expect(mockFindUnique).not.toHaveBeenCalled();
  });

  it("throws 403 when user is not a member of the cycle's workspace", async () => {
    mockCycleFindUnique.mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
    } as any);
    mockFindUnique.mockResolvedValue(null); // not a member

    const handler = requireCycleRole("id", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: CYCLE_ID },
    );
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
    }
  });

  it("throws 403 when user role is below the minimum required", async () => {
    mockCycleFindUnique.mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
    } as any);
    mockFindUnique.mockResolvedValue({ id: "m1", role: "viewer" } as any);

    const handler = requireCycleRole("id", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: CYCLE_ID },
    );
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
      expect(err.message).toContain("member");
    }
  });
});

describe("requireCycleMember", () => {
  const CYCLE_ID = "cycle-uuid-9999";
  const WORKSPACE_ID = "ws-uuid-aaaa";

  beforeEach(() => {
    mockFindUnique.mockReset();
    mockCycleFindUnique.mockReset();
  });

  it("delegates to requireCycleRole with no minimum role (any membership passes)", async () => {
    mockCycleFindUnique.mockResolvedValue({
      project: { workspaceId: WORKSPACE_ID },
    } as any);
    mockFindUnique.mockResolvedValue({ id: "m2", role: "viewer" } as any);

    const handler = requireCycleMember("id");
    const request = makeRequest(
      { userId: "u2", email: "u2@test.com" },
      { id: CYCLE_ID },
    );
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
    expect(request.member).toMatchObject({ id: "m2", role: "viewer" });
  });
});
