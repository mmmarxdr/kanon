/**
 * KAN-83: GET /api/members/me (getProfile) must return a deterministic
 * membership for a multi-workspace user — the OLDEST by createdAt — rather than
 * whatever findFirst happened to return.
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
import { prisma } from "../../config/prisma.js";

describe("KAN-83 — getProfile membership determinism", () => {
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

  it("returns the oldest membership (by createdAt) regardless of insertion order", async () => {
    // wsA membership is inserted FIRST but back-dated to be NEWER.
    const wsA = await seedTestWorkspace();
    const x = await seedTestMemberWithRole(wsA.id, "admin");
    await prisma.member.update({
      where: { id: x.id },
      data: { createdAt: new Date("2023-01-01T00:00:00Z") },
    });

    // wsB membership is inserted SECOND but is OLDER → must win the orderBy.
    const wsB = await seedTestWorkspace();
    await prisma.member.create({
      data: {
        username: "x-in-b",
        role: "owner",
        userId: x.userId,
        workspaceId: wsB.id,
        createdAt: new Date("2020-01-01T00:00:00Z"),
      },
    });

    const res = await app.inject({
      method: "GET",
      url: "/api/members/me",
      headers: { authorization: `Bearer ${x.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.workspaceId).toBe(wsB.id); // oldest membership, not the first-inserted
    expect(body.role).toBe("owner");
  });
});
