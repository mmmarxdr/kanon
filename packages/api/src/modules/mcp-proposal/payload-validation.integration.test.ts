/**
 * KAN-80: POST /api/workspaces/:id/proposals validates the payload shape and
 * caps its serialized size (prevents DB bloat / DoS via oversized payloads).
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";

describe("KAN-80 — mcp-proposal payload validation", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  afterAll(async () => {
    await app.close();
    await cleanDatabase();
    await disconnectTestDb();
  });
  beforeEach(async () => {
    await cleanDatabase();
  });

  async function post(wsId: string, token: string, body: unknown) {
    return app.inject({
      method: "POST",
      url: `/api/workspaces/${wsId}/proposals`,
      headers: { authorization: `Bearer ${token}` },
      payload: body as Record<string, unknown>,
    });
  }

  it("accepts a small object payload (201)", async () => {
    const ws = await seedTestWorkspace();
    const m = await seedTestMemberWithRole(ws.id, "member");

    const res = await post(ws.id, m.token, {
      kind: "generic",
      title: "Do the thing",
      payload: { action: "rename", to: "X" },
    });

    expect(res.statusCode).toBe(201);
    expect(res.json().payload).toEqual({ action: "rename", to: "X" });
  });

  it("accepts an absent payload (201, stored null)", async () => {
    const ws = await seedTestWorkspace();
    const m = await seedTestMemberWithRole(ws.id, "member");

    const res = await post(ws.id, m.token, { kind: "generic", title: "No payload" });
    expect(res.statusCode).toBe(201);
    expect(res.json().payload).toBeNull();
  });

  it("rejects a non-object payload (400)", async () => {
    const ws = await seedTestWorkspace();
    const m = await seedTestMemberWithRole(ws.id, "member");

    const res = await post(ws.id, m.token, {
      kind: "generic",
      title: "Bad payload",
      payload: "just a string",
    });
    expect(res.statusCode).toBe(400);
  });

  it("rejects an oversized payload (400)", async () => {
    const ws = await seedTestWorkspace();
    const m = await seedTestMemberWithRole(ws.id, "member");

    const huge = { blob: "x".repeat(9 * 1024) }; // > 8 KiB serialized
    const res = await post(ws.id, m.token, {
      kind: "generic",
      title: "Too big",
      payload: huge,
    });
    expect(res.statusCode).toBe(400);
    // Pin the failure to the size cap specifically (not just "some 400").
    expect(JSON.stringify(res.json())).toContain("bytes");
  });
});
