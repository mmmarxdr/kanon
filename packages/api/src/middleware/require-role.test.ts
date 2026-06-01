import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  requireRole,
  requireCycleRole,
  requireCycleMember,
  requireProjectRole,
  requireProjectMember,
  enforceProjectAccess,
} from "./require-role.js";
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
    project: {
      findFirst: vi.fn(),
    },
    projectMember: {
      findUnique: vi.fn(),
    },
  },
}));

import { prisma } from "../config/prisma.js";
const mockFindUnique = vi.mocked(prisma.member.findUnique);
const mockCycleFindUnique = vi.mocked(prisma.cycle.findUnique);
const mockProjectFindFirst = vi.mocked(prisma.project.findFirst);
const mockProjectMemberFindUnique = vi.mocked(prisma.projectMember.findUnique);

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
      project: { id: "proj-cycle-1", workspaceId: WORKSPACE_ID },
    } as any);
    mockFindUnique.mockResolvedValue({ id: "m1", role: "member" } as any);
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-1", role: "member" } as any);

    const handler = requireCycleRole("id", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: CYCLE_ID },
    ) as any;
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
    expect(mockCycleFindUnique).toHaveBeenCalledWith({
      where: { id: CYCLE_ID },
      select: { project: { select: { id: true, workspaceId: true } } },
    });
    expect(request.member).toEqual({
      id: "m1",
      role: "member",
      workspaceId: WORKSPACE_ID,
      userId: "u1",
    });
    expect(request.projectRole).toBe("member");
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
      project: { id: "proj-cycle-2", workspaceId: WORKSPACE_ID },
    } as any);
    mockFindUnique.mockResolvedValue(null); // not a workspace member

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

  it("throws 403 when user PM role is below the minimum required", async () => {
    mockCycleFindUnique.mockResolvedValue({
      project: { id: "proj-cycle-3", workspaceId: WORKSPACE_ID },
    } as any);
    mockFindUnique.mockResolvedValue({ id: "m1", role: "viewer" } as any);
    // viewer with PM row but PM role is also viewer → fails member-minimum route
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-v", role: "viewer" } as any);

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
    mockProjectMemberFindUnique.mockReset();
  });

  it("delegates to requireCycleRole with no minimum role (any membership passes)", async () => {
    mockCycleFindUnique.mockResolvedValue({
      project: { id: "proj-cycle-9999", workspaceId: WORKSPACE_ID },
    } as any);
    mockFindUnique.mockResolvedValue({ id: "m2", role: "viewer" } as any);
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-v", role: "viewer" } as any);

    const handler = requireCycleMember("id");
    const request = makeRequest(
      { userId: "u2", email: "u2@test.com" },
      { id: CYCLE_ID },
    ) as any;
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
    expect(request.member).toMatchObject({ id: "m2", role: "viewer" });
    expect(request.projectRole).toBe("viewer");
  });
});

// ---------------------------------------------------------------------------
// enforceProjectAccess — unit tests (KAN-16, R-INV1, R-KAN16-bug)
// ---------------------------------------------------------------------------

describe("enforceProjectAccess", () => {
  const USER_ID = "user-uuid-1";
  const PROJECT_ID = "proj-uuid-1";
  const WORKSPACE_ID = "ws-uuid-1";

  beforeEach(() => {
    mockFindUnique.mockReset();
    mockProjectMemberFindUnique.mockReset();
  });

  // ── (d) Workspace owner/admin bypass — no ProjectMember lookup ──────────
  it("(d) owner bypasses: skips ProjectMember lookup, returns workspace role", async () => {
    mockFindUnique.mockResolvedValue({ id: "wm-owner", role: "owner" } as any);

    const result = await enforceProjectAccess(USER_ID, PROJECT_ID, WORKSPACE_ID, "member");

    expect(mockProjectMemberFindUnique).not.toHaveBeenCalled();
    expect(result.member.id).toBe("wm-owner");
    expect(result.projectRole).toBe("owner");
  });

  it("(d) admin bypasses: skips ProjectMember lookup, returns workspace role", async () => {
    mockFindUnique.mockResolvedValue({ id: "wm-admin", role: "admin" } as any);

    const result = await enforceProjectAccess(USER_ID, PROJECT_ID, WORKSPACE_ID, "admin");

    expect(mockProjectMemberFindUnique).not.toHaveBeenCalled();
    expect(result.member.id).toBe("wm-admin");
    expect(result.projectRole).toBe("admin");
  });

  // ── (b) member with PM row + sufficient role → pass ─────────────────────
  it("(b) member with PM row and sufficient role passes", async () => {
    mockFindUnique.mockResolvedValue({ id: "wm-1", role: "member" } as any);
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-1", role: "member" } as any);

    const result = await enforceProjectAccess(USER_ID, PROJECT_ID, WORKSPACE_ID, "member");

    expect(mockProjectMemberFindUnique).toHaveBeenCalledWith({
      where: { userId_projectId: { userId: USER_ID, projectId: PROJECT_ID } },
      select: { id: true, role: true },
    });
    expect(result.projectRole).toBe("member");
  });

  it("(b) viewer with PM row and viewer-minimum route passes", async () => {
    mockFindUnique.mockResolvedValue({ id: "wm-v", role: "viewer" } as any);
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-v", role: "viewer" } as any);

    const result = await enforceProjectAccess(USER_ID, PROJECT_ID, WORKSPACE_ID, "viewer");

    expect(result.projectRole).toBe("viewer");
  });

  // ── (c) viewer on member-minimum route → 403 ────────────────────────────
  it("(c) viewer PM role on member-minimum route returns 403", async () => {
    mockFindUnique.mockResolvedValue({ id: "wm-v", role: "viewer" } as any);
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-v", role: "viewer" } as any);

    await expect(
      enforceProjectAccess(USER_ID, PROJECT_ID, WORKSPACE_ID, "member"),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  // ── (a) member with no PM row → 403 ─────────────────────────────────────
  it("(a) member with no ProjectMember row returns 403", async () => {
    mockFindUnique.mockResolvedValue({ id: "wm-1", role: "member" } as any);
    mockProjectMemberFindUnique.mockResolvedValue(null);

    await expect(
      enforceProjectAccess(USER_ID, PROJECT_ID, WORKSPACE_ID, "member"),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
  });

  // ── R-INV1: member.id MUST be workspace Member.id, not PM.id ────────────
  it("(R-INV1) result.member.id is workspace Member.id, NOT ProjectMember.id", async () => {
    mockFindUnique.mockResolvedValue({ id: "workspace-member-42", role: "member" } as any);
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-id-999", role: "member" } as any);

    const result = await enforceProjectAccess(USER_ID, PROJECT_ID, WORKSPACE_ID, "member");

    // INVARIANT: id must be the workspace member id
    expect(result.member.id).toBe("workspace-member-42");
    expect(result.member.id).not.toBe("pm-id-999");
  });

  // ── Not a workspace member at all → 403 ─────────────────────────────────
  it("non-member of workspace returns 403", async () => {
    mockFindUnique.mockResolvedValue(null);

    await expect(
      enforceProjectAccess(USER_ID, PROJECT_ID, WORKSPACE_ID, "member"),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(mockProjectMemberFindUnique).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// requireProjectRole with enforceProjectAccess — key-scoped routes (KAN-16, R-KAN16-bug)
// ---------------------------------------------------------------------------

describe("requireProjectRole (with enforceProjectAccess gate)", () => {
  const PROJECT_KEY = "KAN";
  const PROJECT_ID = "proj-uuid-kan";
  const WORKSPACE_ID = "ws-uuid-kan";

  beforeEach(() => {
    mockFindUnique.mockReset();
    mockProjectFindFirst.mockReset();
    mockProjectMemberFindUnique.mockReset();
  });

  it("resolves project key scoped to user's workspaces (R-KAN16-bug)", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as any);
    mockFindUnique.mockResolvedValue({ id: "wm-1", role: "member" } as any);
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-1", role: "member" } as any);

    const handler = requireProjectRole("key", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { key: PROJECT_KEY },
    );
    await handler(request, dummyReply, vi.fn());

    // The project findFirst MUST be scoped to the user's workspaces
    expect(mockProjectFindFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          key: PROJECT_KEY,
          workspace: expect.objectContaining({
            members: expect.objectContaining({
              some: expect.objectContaining({ userId: "u1" }),
            }),
          }),
        }),
      }),
    );
  });

  it("member with PM row passes and sets request.member + request.projectRole", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as any);
    mockFindUnique.mockResolvedValue({ id: "wm-42", role: "member" } as any);
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-1", role: "member" } as any);

    const handler = requireProjectRole("key", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { key: PROJECT_KEY },
    ) as any;
    await handler(request, dummyReply, vi.fn());

    expect(request.member.id).toBe("wm-42");
    expect(request.projectRole).toBe("member");
  });

  it("admin bypasses ProjectMember check and passes", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as any);
    mockFindUnique.mockResolvedValue({ id: "wm-admin", role: "admin" } as any);

    const handler = requireProjectRole("key", "admin");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { key: PROJECT_KEY },
    ) as any;
    await handler(request, dummyReply, vi.fn());

    expect(mockProjectMemberFindUnique).not.toHaveBeenCalled();
    expect(request.member.id).toBe("wm-admin");
    expect(request.projectRole).toBe("admin");
  });

  it("member with no PM row returns 403", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as any);
    mockFindUnique.mockResolvedValue({ id: "wm-1", role: "member" } as any);
    mockProjectMemberFindUnique.mockResolvedValue(null);

    const handler = requireProjectRole("key", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { key: PROJECT_KEY },
    );
    await expect(handler(request, dummyReply, vi.fn())).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
  });
});

describe("requireProjectMember (with enforceProjectAccess gate)", () => {
  const PROJECT_KEY = "TEST";
  const PROJECT_ID = "proj-uuid-test";
  const WORKSPACE_ID = "ws-uuid-test";

  beforeEach(() => {
    mockFindUnique.mockReset();
    mockProjectFindFirst.mockReset();
    mockProjectMemberFindUnique.mockReset();
  });

  it("viewer with PM row passes (no minimum role)", async () => {
    mockProjectFindFirst.mockResolvedValue({ id: PROJECT_ID, workspaceId: WORKSPACE_ID } as any);
    mockFindUnique.mockResolvedValue({ id: "wm-v", role: "viewer" } as any);
    mockProjectMemberFindUnique.mockResolvedValue({ id: "pm-v", role: "viewer" } as any);

    const handler = requireProjectMember("key");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { key: PROJECT_KEY },
    ) as any;
    await handler(request, dummyReply, vi.fn());

    expect(request.member.id).toBe("wm-v");
    expect(request.projectRole).toBe("viewer");
  });
});
