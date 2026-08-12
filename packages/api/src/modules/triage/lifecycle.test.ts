import { describe, it, expect, beforeEach, afterAll, beforeAll, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
  createTestApp,
  authHeader,
} from "../../test/helpers.js";
import type { FastifyInstance } from "fastify";
import { dismissTriageProposal } from "./lifecycle.js";

describe("POST /api/triage-proposals/:id/dismiss (KAN-193 PR8)", () => {
  let workspaceId: string;
  let userId: string;
  let projectId: string;
  let memberId: string;
  let issueId: string;
  let app: FastifyInstance;
  let policyId: string;
  let userToken: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace("Dismiss WS " + Math.random().toString(36).substring(7));
    workspaceId = ws.id;

    const memberData = await seedTestMember(workspaceId);
    userId = memberData.userId;
    memberId = memberData.id;
    userToken = memberData.token;

    const project = await seedTestProject(workspaceId, "D" + Math.floor(Math.random() * 1000));
    projectId = project.id;
    
    // Make user a project member
    await prisma.projectMember.create({
      data: {
        projectId,
        userId,
        role: "member",
      }
    });

    const issueKey = "D" + Math.floor(Math.random() * 1000) + "-1";
    const issue = await prisma.issue.create({
      data: {
        projectId,
        key: issueKey,
        sequenceNum: 1,
        title: "Test Issue",
        type: "task",
        priority: "medium",
        state: "backlog"
      }
    });
    issueId = issue.id;

    const policy = await prisma.triagePolicy.create({
      data: {
        workspaceId,
        version: "v1",
      }
    });
    policyId = policy.id;
  });

  const createProposal = async (status: 'pending' | 'dismissed' | 'expired' | 'disposed' = 'pending', expired: boolean = false) => {
    const createdAt = new Date();
    return await prisma.triageProposal.create({
      data: {
        workspaceId,
        projectId,
        targetIssueId: issueId,
        policyId,
        identityDigest: `digest-${Math.random().toString(36).substring(2, 15)}`,
        lifecycle: status,
        listSummary: { summary: "Test proposal" },
        createdAt,
        expiresAt: expired ? new Date(Date.now() - 100000) : new Date(Date.now() + 100000),
        retentionEligibleAt: new Date(createdAt.getTime() + 365 * 86400_000),
        capturedRetentionDays: 365,
        capturedPolicyVersion: "v1",
        content: {
          create: {
            payload: {},
            provenance: {}
          }
        }
      }
    });
  };

  it("should dismiss a pending proposal successfully and create a lifecycle event", async () => {
    const proposal = await createProposal("pending");

    const res = await app.inject({
      method: "POST",
      url: `/api/triage-proposals/${proposal.id}/dismiss`,
      headers: authHeader(userToken),
      payload: { reason: "Not relevant" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("dismissed");

    const updated = await prisma.triageProposal.findUnique({
      where: { id: proposal.id },
      include: { lifecycleEvents: true },
    });
    expect(updated?.lifecycle).toBe("dismissed");
    expect(updated?.lifecycleEvents.length).toBe(1);
    expect(updated?.lifecycleEvents[0].state).toBe("dismissed");
    expect(updated?.lifecycleEvents[0].reason).toBe("Not relevant");
    expect(updated?.lifecycleEvents[0].details).toEqual({
      correlationId: expect.any(String),
      client: null,
    });
  });

  it("should be idempotent if already dismissed", async () => {
    const proposal = await createProposal("dismissed");
    await prisma.triageProposalLifecycleEvent.create({
      data: {
        proposalId: proposal.id,
        state: "dismissed",
        reason: "Initial dismiss",
      },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/triage-proposals/${proposal.id}/dismiss`,
      headers: authHeader(userToken),
      payload: { reason: "Repeat dismiss" },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.ok).toBe(true);
    expect(body.status).toBe("dismissed");

    const events = await prisma.triageProposalLifecycleEvent.findMany({
      where: { proposalId: proposal.id },
    });
    expect(events.length).toBe(1);
  });

  it("returns the existing terminal state for an expired proposal", async () => {
    const proposal = await createProposal("expired", true);
    await prisma.triageProposalLifecycleEvent.create({
      data: { proposalId: proposal.id, state: "expired", reason: "validity_expired" },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/triage-proposals/${proposal.id}/dismiss`,
      headers: authHeader(userToken),
      payload: { reason: "Expired" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: "expired" });
    expect(await prisma.triageProposalLifecycleEvent.count({
      where: { proposalId: proposal.id, state: "expired" },
    })).toBe(1);
  });

  it("materializes expiry once when dismissal loses the expiry race", async () => {
    const proposal = await createProposal("pending", true);

    const res = await app.inject({
      method: "POST",
      url: `/api/triage-proposals/${proposal.id}/dismiss`,
      headers: authHeader(userToken),
      payload: { reason: "Expired" },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, status: "expired" });

    const updated = await prisma.triageProposal.findUnique({
      where: { id: proposal.id },
    });
    expect(updated?.lifecycle).toBe("expired");
    expect(await prisma.triageProposalLifecycleEvent.count({
      where: { proposalId: proposal.id, state: "expired" },
    })).toBe(1);
  });

  it("lets expiry win when the row lock wait crosses expiresAt", async () => {
    const proposal = await createProposal("pending");
    const expiresAt = new Date(Date.now() + 400);
    await prisma.triageProposal.update({ where: { id: proposal.id }, data: { expiresAt } });
    let release!: () => void;
    let locked!: () => void;
    const hold = new Promise<void>((resolve) => { release = resolve; });
    const ready = new Promise<void>((resolve) => { locked = resolve; });
    const blocker = prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT "id" FROM "triage_proposals" WHERE "id" = ${proposal.id}::uuid FOR UPDATE`;
      locked();
      await hold;
    });
    await Promise.race([ready, blocker]);

    const response = app.inject({
      method: "POST",
      url: `/api/triage-proposals/${proposal.id}/dismiss`,
      headers: authHeader(userToken),
      payload: { reason: "Race expiry" },
    });
    try {
      await vi.waitFor(async () => {
        const [row] = await prisma.$queryRaw<Array<{ expired: boolean; waiting: number }>>`
          SELECT clock_timestamp() >= ${expiresAt} AS expired,
            (SELECT COUNT(*)::int FROM pg_stat_activity
              WHERE datname = current_database() AND wait_event_type = 'Lock'
                AND query ILIKE '%FROM "triage_proposals"%FOR UPDATE%') AS waiting
        `;
        expect(row).toMatchObject({ expired: true, waiting: expect.any(Number) });
        expect(row!.waiting).toBeGreaterThanOrEqual(1);
      }, { timeout: 1_000, interval: 20 });
    } finally {
      release();
      await blocker.catch(() => undefined);
    }

    expect((await response).json()).toMatchObject({ ok: true, status: "expired" });
    expect(await prisma.triageProposalLifecycleEvent.count({
      where: { proposalId: proposal.id, state: "expired" },
    })).toBe(1);
  });

  it("should reject dismissal for disposed proposal", async () => {
    const proposal = await createProposal("pending");
    await prisma.triageProposal.update({
      where: { id: proposal.id },
      data: { disposedAt: new Date() },
    });

    const res = await app.inject({
      method: "POST",
      url: `/api/triage-proposals/${proposal.id}/dismiss`,
      headers: authHeader(userToken),
      payload: { reason: "Disposed" },
    });

    expect(res.statusCode).toBe(409);
  });

  it("should return 404 for non-existent proposal", async () => {
    const res = await app.inject({
      method: "POST",
      url: `/api/triage-proposals/00000000-0000-0000-0000-000000000000/dismiss`,
      headers: authHeader(userToken),
      payload: { reason: "Missing" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("should return permission-safe 404 if user is not a project member", async () => {
    const otherUser = await seedTestMember(workspaceId);
    const proposal = await createProposal("pending");

    const res = await app.inject({
      method: "POST",
      url: `/api/triage-proposals/${proposal.id}/dismiss`,
      headers: authHeader(otherUser.token),
      payload: { reason: "Forbidden" },
    });

    expect(res.statusCode).toBe(404);
  });

  it("should do zero domain writes to Issue or ActivityLog", async () => {
    const proposal = await createProposal("pending");
    const issuesBefore = await prisma.issue.findMany();
    const logsBefore = await prisma.activityLog.findMany();

    await app.inject({
      method: "POST",
      url: `/api/triage-proposals/${proposal.id}/dismiss`,
      headers: authHeader(userToken),
      payload: { reason: "No domain writes" },
    });

    const issuesAfter = await prisma.issue.findMany();
    const logsAfter = await prisma.activityLog.findMany();

    expect(issuesAfter).toEqual(issuesBefore);
    expect(logsAfter).toEqual(logsBefore);
  });

  it("should handle concurrent dismissals safely (SERIALIZABLE transaction)", async () => {
    const proposal = await createProposal("pending");

    const [res1, res2] = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/triage-proposals/${proposal.id}/dismiss`,
        headers: authHeader(userToken),
        payload: { reason: "Concurrent" },
      }),
      app.inject({
        method: "POST",
        url: `/api/triage-proposals/${proposal.id}/dismiss`,
        headers: authHeader(userToken),
        payload: { reason: "Concurrent" },
      }),
    ]);

    expect(res1.statusCode).toBe(200);
    expect(res2.statusCode).toBe(200);

    const events = await prisma.triageProposalLifecycleEvent.findMany({
      where: { proposalId: proposal.id },
    });
    expect(events.length).toBe(1);
  });

  it("rejects before writing when the dismissal deadline has elapsed", async () => {
    const proposal = await createProposal("pending");

    await expect(
      dismissTriageProposal(proposal.id, memberId, "Too late", undefined, performance.now() - 1),
    ).rejects.toMatchObject({ statusCode: 503, code: "DISMISSAL_TIMED_OUT" });
    await expect(prisma.triageProposal.findUniqueOrThrow({ where: { id: proposal.id } }))
      .resolves.toMatchObject({ lifecycle: "pending" });
  });
});
