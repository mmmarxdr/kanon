import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { randomBytes } from "node:crypto";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
  parseCookies,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { COOKIE_NAMES } from "../../shared/constants.js";

/**
 * Integration tests for R-NUI-autologin:
 *  POST /api/auth/register with invite → 201 + auth cookies + Member row created
 *  POST /api/auth/register without invite → unchanged (no cookies, user only)
 *  register with mismatched invite.email → 403 EMAIL_MISMATCH
 */
describe("Register with invite — auto-login (R-NUI-autologin)", () => {
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

  // ── Helpers ──────────────────────────────────────────────────────────

  /**
   * Create a standard MEMBER invite in the DB and return its token.
   * targetEmail=null → link invite; targetEmail=string → email-targeted invite.
   */
  async function createInviteWithToken(
    workspaceId: string,
    createdById: string,
    targetEmail: string | null = null,
    projectAssignments?: Array<{ projectId: string; role: string }>,
  ) {
    const token = randomBytes(32).toString("base64url");
    const invite = await prisma.workspaceInvite.create({
      data: {
        token,
        role: "member",
        maxUses: targetEmail ? 1 : 0,
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        email: targetEmail,
        workspaceId,
        createdById,
        projectAssignments: projectAssignments ? (projectAssignments as any) : undefined,
      },
    });
    return invite.token;
  }

  // ── Task 3.1: register without invite → unchanged behavior ───────────

  it("register without invite → 201 with user id/email, no auth cookies", async () => {
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "noninvite@kanon.test",
        password: "Password123!",
        displayName: "Regular User",
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty("id");
    expect(body.email).toBe("noninvite@kanon.test");
    // No session in body
    expect(body).not.toHaveProperty("accessToken");
    expect(body).not.toHaveProperty("refreshToken");

    // No auth cookies set
    const setCookies = parseCookies(res.headers["set-cookie"]);
    expect(setCookies[COOKIE_NAMES.ACCESS]).toBeUndefined();
    expect(setCookies[COOKIE_NAMES.REFRESH]).toBeUndefined();
  });

  // ── Task 3.1: register with valid invite → 201 + cookies + Member row ─

  it("register with valid link invite → 201 + auth cookies set + Member row created", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const inviteToken = await createInviteWithToken(ws.id, admin.userId, null);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "newuser@kanon.test",
        password: "Password123!",
        displayName: "New User",
        invite: inviteToken,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();

    // Auth tokens in body (mirrors login)
    expect(body).toHaveProperty("accessToken");
    expect(body).toHaveProperty("refreshToken");
    expect(typeof body.accessToken).toBe("string");
    expect(typeof body.refreshToken).toBe("string");

    // Auth cookies set
    const setCookies = parseCookies(res.headers["set-cookie"]);
    expect(setCookies[COOKIE_NAMES.ACCESS]).toBeDefined();
    expect(setCookies[COOKIE_NAMES.REFRESH]).toBeDefined();

    // User was created
    const user = await prisma.user.findUnique({ where: { email: "newuser@kanon.test" } });
    expect(user).not.toBeNull();

    // Member row created
    const member = await prisma.member.findUnique({
      where: { userId_workspaceId: { userId: user!.id, workspaceId: ws.id } },
    });
    expect(member).not.toBeNull();
    expect(member!.role).toBe("member");
  });

  // Triangulation: KAN-18 — projectAssignments applied during register+invite

  it("register with invite carrying projectAssignments → ProjectMember rows created", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const projectA = await seedTestProject(ws.id, "RPA1");
    const projectB = await seedTestProject(ws.id, "RPB1");

    const inviteToken = await createInviteWithToken(ws.id, admin.userId, null, [
      { projectId: projectA.id, role: "member" },
      { projectId: projectB.id, role: "viewer" },
    ]);

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "projuser@kanon.test",
        password: "Password123!",
        invite: inviteToken,
      },
    });

    expect(res.statusCode).toBe(201);

    const user = await prisma.user.findUnique({ where: { email: "projuser@kanon.test" } });
    expect(user).not.toBeNull();

    const pmRows = await prisma.projectMember.findMany({
      where: { userId: user!.id },
      orderBy: { projectId: "asc" },
    });
    expect(pmRows).toHaveLength(2);
    for (const pm of pmRows) {
      expect(pm.userId).toBe(user!.id);
    }
  });

  // ── Email-match guard propagates through register+invite ─────────────

  it("register with invite.email=alice but registering as bob → 403 EMAIL_MISMATCH", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");

    // Invite targeted at alice
    const inviteToken = await createInviteWithToken(ws.id, admin.userId, "alice@kanon.test");

    // Bob tries to use alice's invite
    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "bob@kanon.test",
        password: "Password123!",
        invite: inviteToken,
      },
    });

    expect(res.statusCode).toBe(403);
    const body = res.json();
    expect(body.code).toBe("EMAIL_MISMATCH");
  });

  // Triangulation: email-targeted invite used by matching email → OK

  it("register with invite.email=alice, registering as alice → 201 + session", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const inviteToken = await createInviteWithToken(ws.id, admin.userId, "alice@kanon.test");

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/register",
      payload: {
        email: "alice@kanon.test",
        password: "Password123!",
        invite: inviteToken,
      },
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toHaveProperty("accessToken");

    const user = await prisma.user.findUnique({ where: { email: "alice@kanon.test" } });
    const member = await prisma.member.findUnique({
      where: { userId_workspaceId: { userId: user!.id, workspaceId: ws.id } },
    });
    expect(member).not.toBeNull();
  });
});
