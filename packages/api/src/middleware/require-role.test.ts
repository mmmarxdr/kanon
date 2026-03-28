import { describe, it, expect, vi } from "vitest";
import { requireRole } from "./require-role.js";
import type { FastifyRequest, FastifyReply } from "fastify";

/**
 * Unit tests for requireRole middleware.
 * Tests role-based access control preHandler logic.
 */

function makeRequest(user: any): FastifyRequest {
  return { user } as unknown as FastifyRequest;
}

const dummyReply = {} as FastifyReply;

describe("requireRole", () => {
  it("passes when user role is in allowed list", async () => {
    const handler = requireRole("owner", "admin");
    const request = makeRequest({
      memberId: "m1",
      workspaceId: "w1",
      role: "admin",
    });
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
  });

  it("passes for exact single role match", async () => {
    const handler = requireRole("owner");
    const request = makeRequest({
      memberId: "m1",
      workspaceId: "w1",
      role: "owner",
    });
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
  });

  it("rejects when user role is not in allowed list", async () => {
    const handler = requireRole("owner", "admin");
    const request = makeRequest({
      memberId: "m1",
      workspaceId: "w1",
      role: "member",
    });
    await expect(handler(request, dummyReply, vi.fn())).rejects.toThrow(
      /requires one of the following roles/,
    );
  });

  it("returns 403 status code for unauthorized role", async () => {
    const handler = requireRole("owner");
    const request = makeRequest({
      memberId: "m1",
      workspaceId: "w1",
      role: "viewer",
    });
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(403);
      expect(err.code).toBe("FORBIDDEN");
    }
  });

  it("rejects viewer when only owner/admin allowed", async () => {
    const handler = requireRole("owner", "admin");
    const request = makeRequest({
      memberId: "m1",
      workspaceId: "w1",
      role: "viewer",
    });
    await expect(handler(request, dummyReply, vi.fn())).rejects.toThrow();
  });

  it("returns 401 when user is null (unauthenticated)", async () => {
    const handler = requireRole("owner");
    const request = makeRequest(null);
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("returns 401 when user is undefined", async () => {
    const handler = requireRole("admin");
    const request = makeRequest(undefined);
    try {
      await handler(request, dummyReply, vi.fn());
      expect.fail("Should have thrown");
    } catch (err: any) {
      expect(err.statusCode).toBe(401);
      expect(err.code).toBe("UNAUTHORIZED");
    }
  });

  it("handles multiple allowed roles correctly", async () => {
    const handler = requireRole("owner", "admin", "member");
    const request = makeRequest({
      memberId: "m1",
      workspaceId: "w1",
      role: "member",
    });
    await expect(handler(request, dummyReply, vi.fn())).resolves.toBeUndefined();
  });
});
