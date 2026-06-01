/**
 * Integration tests for KAN-19 PR1: token project scoping (storage + issuance + inert claim).
 *
 * T1.2: onboard() with scoped invite stores allowedProjectIds=[P,Q] on RefreshToken row
 * T1.3: onboard() with no assignments stores allowedProjectIds=[]
 * T1.4: exchange() with scoped RefreshToken → access JWT carries allowedProjectIds:[P] claim
 * T1.5: exchange() with unscoped RefreshToken → access JWT has NO allowedProjectIds claim
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import jwt from "jsonwebtoken";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { sha256Hex, generateOpaqueToken } from "./service.js";

describe("KAN-19 PR1 — Token Project Scoping Integration", () => {
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

  // ── Helpers ─────────────────────────────────────────────────────────────────

  /**
   * Create an onboarding invite in the DB with given projectAssignments and return its JWT.
   */
  async function createOnboardingInvite(
    workspaceId: string,
    createdById: string,
    targetEmail: string,
    projectAssignments: Array<{ projectId: string; role: string }>,
  ): Promise<string> {
    const { randomBytes } = await import("node:crypto");
    const opaqueToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);

    const invite = await prisma.workspaceInvite.create({
      data: {
        token: opaqueToken,
        role: "member",
        maxUses: 1,
        expiresAt,
        label: "Onboarding link",
        email: targetEmail,
        kind: "ONBOARDING",
        workspaceId,
        createdById,
        projectAssignments: projectAssignments as any,
      },
    });

    return jwt.sign(
      { sub: invite.id, scope: "onboard" },
      process.env["JWT_SECRET"]!,
      { expiresIn: "72h" },
    );
  }

  // ── T1.2: onboard with scoped invite → allowedProjectIds=[P,Q] on RefreshToken ──

  it("T1.2: onboard with scoped invite stores allowedProjectIds=[P,Q] on RefreshToken row", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const dev = await seedTestMemberWithRole(ws.id, "member");
    const projectP = await seedTestProject(ws.id, "TSP1");
    const projectQ = await seedTestProject(ws.id, "TSQ1");

    const onboardToken = await createOnboardingInvite(
      ws.id,
      admin.userId,
      dev.email,
      [
        { projectId: projectP.id, role: "member" },
        { projectId: projectQ.id, role: "viewer" },
      ],
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/onboard",
      payload: { token: onboardToken },
    });

    expect(res.statusCode).toBe(200);

    // Find the RefreshToken row created by onboard() for this user
    const refreshRow = await prisma.refreshToken.findFirst({
      where: { userId: dev.userId, source: "ONBOARDING" },
    });

    expect(refreshRow).not.toBeNull();
    expect(refreshRow!.allowedProjectIds).toHaveLength(2);
    expect(refreshRow!.allowedProjectIds).toContain(projectP.id);
    expect(refreshRow!.allowedProjectIds).toContain(projectQ.id);
  });

  // ── T1.3: onboard with no assignments → allowedProjectIds=[] ────────────────

  it("T1.3: onboard with no assignments stores allowedProjectIds=[] on RefreshToken row", async () => {
    const ws = await seedTestWorkspace();
    const admin = await seedTestMemberWithRole(ws.id, "admin");
    const dev = await seedTestMemberWithRole(ws.id, "member");

    const onboardToken = await createOnboardingInvite(
      ws.id,
      admin.userId,
      dev.email,
      [], // no assignments
    );

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/onboard",
      payload: { token: onboardToken },
    });

    expect(res.statusCode).toBe(200);

    const refreshRow = await prisma.refreshToken.findFirst({
      where: { userId: dev.userId, source: "ONBOARDING" },
    });

    expect(refreshRow).not.toBeNull();
    expect(refreshRow!.allowedProjectIds).toEqual([]);
  });

  // ── T1.4: exchange scoped refresh → access JWT carries allowedProjectIds claim ──

  it("T1.4: exchange with scoped RefreshToken → access JWT carries allowedProjectIds:[P] claim", async () => {
    const ws = await seedTestWorkspace();
    const user = await seedTestMemberWithRole(ws.id, "member");
    const projectP = await seedTestProject(ws.id, "TSP2");

    // Seed a RefreshToken row with allowedProjectIds=[P] directly
    const rawToken = generateOpaqueToken();
    const tokenHash = sha256Hex(rawToken);
    await prisma.refreshToken.create({
      data: {
        tokenHash,
        source: "ONBOARDING",
        userId: user.userId,
        workspaceId: ws.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        allowedProjectIds: [projectP.id],
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/exchange",
      payload: { refreshToken: rawToken },
    });

    expect(res.statusCode).toBe(200);
    const { accessToken } = res.json() as { accessToken: string };

    const decoded = jwt.decode(accessToken) as Record<string, unknown>;
    expect(decoded["sub"]).toBe(user.userId);
    expect(decoded["scope"]).toBe("access");
    expect(decoded["allowedProjectIds"]).toEqual([projectP.id]);
  });

  // ── T1.5: exchange unscoped refresh → access JWT has NO allowedProjectIds claim ──

  it("T1.5: exchange with unscoped RefreshToken (allowedProjectIds=[]) → access JWT has no allowedProjectIds claim", async () => {
    const ws = await seedTestWorkspace();
    const user = await seedTestMemberWithRole(ws.id, "member");

    // Seed an unscoped RefreshToken row (allowedProjectIds defaults to [])
    const rawToken = generateOpaqueToken();
    const tokenHash = sha256Hex(rawToken);
    await prisma.refreshToken.create({
      data: {
        tokenHash,
        source: "ONBOARDING",
        userId: user.userId,
        workspaceId: ws.id,
        expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        allowedProjectIds: [],
      },
    });

    const res = await app.inject({
      method: "POST",
      url: "/api/auth/exchange",
      payload: { refreshToken: rawToken },
    });

    expect(res.statusCode).toBe(200);
    const { accessToken } = res.json() as { accessToken: string };

    const decoded = jwt.decode(accessToken) as Record<string, unknown>;
    expect(decoded["sub"]).toBe(user.userId);
    expect(decoded).not.toHaveProperty("allowedProjectIds");
  });
});
