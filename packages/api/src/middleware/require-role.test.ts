import { describe, it, expect, vi, beforeEach } from "vitest";
import { requireRole } from "./require-role.js";
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
  },
}));

import { prisma } from "../config/prisma.js";
const mockFindUnique = vi.mocked(prisma.member.findUnique);

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
  });

  it("passes when member has an allowed role", async () => {
    mockFindUnique.mockResolvedValue({ role: "admin" } as any);

    const handler = requireRole("id", "owner", "admin");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
    expect(mockFindUnique).toHaveBeenCalledWith({
      where: { userId_workspaceId: { userId: "u1", workspaceId: "ws-1" } },
      select: { role: true },
    });
  });

  it("passes for exact single role match", async () => {
    mockFindUnique.mockResolvedValue({ role: "owner" } as any);

    const handler = requireRole("id", "owner");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
  });

  it("rejects when member role is not in allowed list", async () => {
    mockFindUnique.mockResolvedValue({ role: "member" } as any);

    const handler = requireRole("id", "owner", "admin");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    await expect(handler(request, dummyReply, vi.fn())).rejects.toThrow(
      /requires one of the following roles/,
    );
  });

  it("returns 403 status code for unauthorized role", async () => {
    mockFindUnique.mockResolvedValue({ role: "viewer" } as any);

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
    mockFindUnique.mockResolvedValue({ role: "member" } as any);

    const handler = requireRole("id", "owner", "admin", "member");
    const request = makeRequest(
      { userId: "u1", email: "u@test.com" },
      { id: "ws-1" },
    );
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
  });
});
