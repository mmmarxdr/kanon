/**
 * Workspace routes — integration tests (real DB, real HTTP).
 *
 * Covers:
 * - 1a.6 / 1a.7: POST /api/workspaces requireInstanceAdmin guard
 *   - 401 unauthenticated
 *   - 403 plain authenticated user (no instance-admin flag)
 *   - 201 instance-admin user
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  cleanDatabase,
  disconnectTestDb,
  generateTestToken,
  seedInstanceAdminUser,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { randomUUID } from "node:crypto";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";

describe("POST /api/workspaces — requireInstanceAdmin guard", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
  });

  it("401 when unauthenticated", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      payload: { name: "Test", slug: "test-ws" },
    });
    expect(res.statusCode).toBe(401);
  });

  it("403 when authenticated but not instance-admin", async () => {
    // Plain user with no isInstanceAdmin flag
    const user = await prisma.user.create({
      data: {
        email: `plain-${randomUUID().slice(0, 8)}@kanon.test`,
        passwordHash: "$2b$04$placeholder",
      },
    });
    const token = generateTestToken({ userId: user.id, email: user.email });

    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Test", slug: "test-ws" },
    });
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });

  it("201 when authenticated as instance-admin", async () => {
    const { token } = await seedInstanceAdminUser();

    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Admin Workspace", slug: `ws-${randomUUID().slice(0, 8)}` },
    });
    expect(res.statusCode).toBe(201);
  });

  it("403 when user is ownerUserId (super-admin) but isInstanceAdmin=false (FIX3 regression guard)", async () => {
    // Seed a user who IS the instance owner (ownerUserId) but has NOT been granted
    // the instance-admin flag. This guards against a future || isSuperAdmin regression
    // in requireInstanceAdmin — super-admin status alone must NOT satisfy the guard.
    const user = await prisma.user.create({
      data: {
        email: `super-no-flag-${randomUUID().slice(0, 8)}@kanon.test`,
        passwordHash: "$2b$04$placeholder",
        isInstanceAdmin: false,
        isSuperAdmin: true,
      },
    });

    // Set this user as ownerUserId on the singleton
    await prisma.instanceSettings.update({
      where: { id: INSTANCE_SETTINGS_ID },
      data: { ownerUserId: user.id },
    });

    const token = generateTestToken({ userId: user.id, email: user.email });

    const res = await app.inject({
      method: "POST",
      url: "/api/workspaces",
      headers: { authorization: `Bearer ${token}` },
      payload: { name: "Should Fail", slug: `ws-fail-${randomUUID().slice(0, 8)}` },
    });

    // requireInstanceAdmin checks ONLY isInstanceAdmin — ownerUserId/isSuperAdmin
    // must NOT grant access. If this ever returns 201, a regression was introduced.
    expect(res.statusCode).toBe(403);
    expect(res.json().code).toBe("FORBIDDEN");
  });
});
