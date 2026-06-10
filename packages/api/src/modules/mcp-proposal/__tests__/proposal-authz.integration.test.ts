import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import type { FastifyInstance } from "fastify";
import {
  createTestApp,
  seedTestWorkspace,
  seedTestMemberWithRole,
  cleanDatabase,
  disconnectTestDb,
} from "../../../test/helpers.js";
import { prisma } from "../../../config/prisma.js";

/**
 * Integration tests for KAN-64: proposal apply/dismiss authorization.
 *
 * Covers:
 *   S1  member of proposal's workspace can apply a pending proposal → 200
 *   S2  member of proposal's workspace can dismiss a pending proposal → 200
 *   S3  member of a DIFFERENT workspace → 403 on apply AND dismiss
 *   S4  viewer of proposal's workspace → 403 (minimum role is member)
 *   S5  unknown proposal UUID → 404
 *   S6  non-pending proposal (already applied) → 409 for a legitimate member
 *   S7  unauthenticated request → 401
 */
describe("KAN-64: Proposal apply/dismiss authorization", () => {
  let app: FastifyInstance;
  let workspaceId: string;

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
    const ws = await seedTestWorkspace(`k64${Math.random().toString(36).slice(2, 7)}`);
    workspaceId = ws.id;
  });

  // ── Seed helper ────────────────────────────────────────────────────────────

  async function seedPendingProposal(wsId: string): Promise<{ id: string }> {
    return prisma.mcpProposal.create({
      data: {
        workspaceId: wsId,
        kind: "generic",
        title: "Test proposal",
        status: "pending",
      },
      select: { id: true },
    });
  }

  // ── S1: member can apply a pending proposal ────────────────────────────────

  it("S1: workspace member can apply a pending proposal (200, status=applied)", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const proposal = await seedPendingProposal(workspaceId);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("applied");
  });

  // ── S2: member can dismiss a pending proposal ──────────────────────────────

  it("S2: workspace member can dismiss a pending proposal (200, status=dismissed)", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const proposal = await seedPendingProposal(workspaceId);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/dismiss`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("dismissed");
  });

  // ── S3: member of a DIFFERENT workspace → 403 ─────────────────────────────

  it("S3a: member of a different workspace → 403 on apply; proposal stays pending", async () => {
    const otherWs = await seedTestWorkspace(`k64other${Math.random().toString(36).slice(2, 7)}`);
    const outsider = await seedTestMemberWithRole(otherWs.id, "member");
    const proposal = await seedPendingProposal(workspaceId);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers: { authorization: `Bearer ${outsider.token}` },
    });

    expect(res.statusCode).toBe(403);

    // Proposal must remain pending
    const dbProposal = await prisma.mcpProposal.findUnique({
      where: { id: proposal.id },
      select: { status: true },
    });
    expect(dbProposal?.status).toBe("pending");
  });

  it("S3b: member of a different workspace → 403 on dismiss; proposal stays pending", async () => {
    const otherWs = await seedTestWorkspace(`k64oth2${Math.random().toString(36).slice(2, 7)}`);
    const outsider = await seedTestMemberWithRole(otherWs.id, "member");
    const proposal = await seedPendingProposal(workspaceId);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/dismiss`,
      headers: { authorization: `Bearer ${outsider.token}` },
    });

    expect(res.statusCode).toBe(403);

    const dbProposal = await prisma.mcpProposal.findUnique({
      where: { id: proposal.id },
      select: { status: true },
    });
    expect(dbProposal?.status).toBe("pending");
  });

  // ── S4: viewer of proposal's workspace → 403 ──────────────────────────────

  it("S4a: viewer of proposal's workspace → 403 on apply (minimum role is member)", async () => {
    const viewer = await seedTestMemberWithRole(workspaceId, "viewer");
    const proposal = await seedPendingProposal(workspaceId);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  it("S4b: viewer of proposal's workspace → 403 on dismiss (minimum role is member)", async () => {
    const viewer = await seedTestMemberWithRole(workspaceId, "viewer");
    const proposal = await seedPendingProposal(workspaceId);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/dismiss`,
      headers: { authorization: `Bearer ${viewer.token}` },
    });

    expect(res.statusCode).toBe(403);
  });

  // ── S5: unknown proposal UUID → 404 ───────────────────────────────────────

  it("S5a: unknown proposal UUID → 404 on apply", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const unknownId = "00000000-0000-0000-0000-000000000000";

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${unknownId}/apply`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("PROPOSAL_NOT_FOUND");
  });

  it("S5b: unknown proposal UUID → 404 on dismiss", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const unknownId = "00000000-0000-0000-0000-000000000000";

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${unknownId}/dismiss`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe("PROPOSAL_NOT_FOUND");
  });

  // ── S6: non-pending proposal → 409 for a legitimate member ────────────────

  it("S6: already-applied proposal → 409 for a legitimate workspace member", async () => {
    const member = await seedTestMemberWithRole(workspaceId, "member");
    const proposal = await prisma.mcpProposal.create({
      data: {
        workspaceId,
        kind: "generic",
        title: "Already applied",
        status: "applied",
        appliedAt: new Date(),
      },
      select: { id: true },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers: { authorization: `Bearer ${member.token}` },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe("PROPOSAL_NOT_PENDING");
  });

  // ── S7: unauthenticated → 401 ─────────────────────────────────────────────

  it("S7a: unauthenticated request → 401 on apply", async () => {
    const proposal = await seedPendingProposal(workspaceId);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
    });

    expect(res.statusCode).toBe(401);
  });

  it("S7b: unauthenticated request → 401 on dismiss", async () => {
    const proposal = await seedPendingProposal(workspaceId);

    const res = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/dismiss`,
    });

    expect(res.statusCode).toBe(401);
  });
});
