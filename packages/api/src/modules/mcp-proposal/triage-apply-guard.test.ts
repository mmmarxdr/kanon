import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  authHeader,
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";

describe("legacy apply triage guard", () => {
  let app: FastifyInstance;
  let token: string;
  let outsiderToken: string;
  let outsiderUserId: string;
  let outsiderWorkspaceId: string;
  let workspaceId: string;
  let projectId: string;
  let issueId: string;
  let policyId: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  beforeEach(async () => {
    vi.restoreAllMocks();
    await cleanDatabase();
    const workspace = await seedTestWorkspace(`apply-${randomUUID().slice(0, 8)}`);
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id, `A${randomUUID().slice(0, 4)}`);
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: member.userId, role: "member" },
    });
    const issue = await prisma.issue.create({
      data: {
        projectId: project.id,
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Guard target",
      },
    });
    const policy = await prisma.triagePolicy.create({
      data: { workspaceId: workspace.id, version: "v1" },
    });
    const outsiderWorkspace = await seedTestWorkspace(`outside-${randomUUID().slice(0, 8)}`);
    const outsider = await seedTestMember(outsiderWorkspace.id);
    token = member.token;
    outsiderToken = outsider.token;
    outsiderUserId = outsider.userId;
    outsiderWorkspaceId = outsiderWorkspace.id;
    workspaceId = workspace.id;
    projectId = project.id;
    issueId = issue.id;
    policyId = policy.id;
  });

  async function createTriageProposal(id = randomUUID()) {
    const createdAt = new Date();
    return prisma.triageProposal.create({
      data: {
        id,
        identityDigest: randomUUID().replaceAll("-", "").padEnd(64, "0"),
        targetIssueId: issueId,
        workspaceId,
        projectId,
        policyId,
        lifecycle: "pending",
        listSummary: { nonExecutable: true },
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 7 * 86_400_000),
        retentionEligibleAt: new Date(createdAt.getTime() + 365 * 86_400_000),
        capturedRetentionDays: 365,
        capturedPolicyVersion: "v1",
      },
    });
  }

  async function expectRejectedApplyMetric(outcome: string) {
    const metric = await app.triageMetrics.proposalRequests.get();
    const value = metric.values.find((entry) =>
      entry.labels["operation"] === "rejected_apply" && entry.labels["outcome"] === outcome);
    expect(value?.value).toBeGreaterThan(0);
  }

  it("rejects and audits an authorized triage ID before a colliding legacy row", async () => {
    const sharedId = randomUUID();
    const proposal = await createTriageProposal(sharedId);
    await prisma.mcpProposal.create({
      data: {
        id: sharedId,
        workspaceId,
        projectId,
        kind: "generic",
        title: "Legacy collision",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(422);
    expect(response.json().code).toBe("TRIAGE_PROPOSAL_NON_EXECUTABLE");
    await expect(prisma.adminAuditLog.findFirstOrThrow({
      where: { entityId: proposal.id, action: "apply_rejected" },
    })).resolves.toMatchObject({ reason: "Triage proposals are non-executable" });
    await expect(prisma.mcpProposal.findUniqueOrThrow({ where: { id: sharedId } })).resolves.toMatchObject({
      status: "pending",
    });
    await expectRejectedApplyMetric("unsupported_non_executable");
  });

  it("hides a triage ID from an unauthorized caller without auditing", async () => {
    const proposal = await createTriageProposal();

    const response = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers: authHeader(outsiderToken),
    });

    expect(response.statusCode).toBe(404);
    const missing = await app.inject({
      method: "POST",
      url: `/api/proposals/${randomUUID()}/apply`,
      headers: authHeader(outsiderToken),
    });
    expect(response.json()).toEqual(missing.json());
    await expect(prisma.adminAuditLog.count()).resolves.toBe(0);
    await expectRejectedApplyMetric("not_found_or_not_visible");
  });

  it("does not fall through to an authorized colliding legacy proposal", async () => {
    const sharedId = randomUUID();
    await createTriageProposal(sharedId);
    const outsiderProject = await seedTestProject(outsiderWorkspaceId, `O${randomUUID().slice(0, 4)}`);
    await prisma.projectMember.create({
      data: { projectId: outsiderProject.id, userId: outsiderUserId, role: "member" },
    });
    await prisma.mcpProposal.create({
      data: {
        id: sharedId,
        workspaceId: outsiderWorkspaceId,
        projectId: outsiderProject.id,
        kind: "generic",
        title: "Authorized legacy collision",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/proposals/${sharedId}/apply`,
      headers: authHeader(outsiderToken),
    });

    expect(response.statusCode).toBe(404);
    await expect(prisma.mcpProposal.findUniqueOrThrow({ where: { id: sharedId } }))
      .resolves.toMatchObject({ status: "pending" });
    await expect(prisma.adminAuditLog.count()).resolves.toBe(0);
  });

  it("fails closed when rejected-apply audit persistence fails", async () => {
    const proposal = await createTriageProposal();
    vi.spyOn(prisma.adminAuditLog, "create").mockRejectedValueOnce(new Error("audit unavailable"));

    const response = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("AUDIT_UNAVAILABLE");
    await expect(prisma.triageProposal.findUniqueOrThrow({ where: { id: proposal.id } })).resolves.toMatchObject({
      lifecycle: "pending",
    });
    await expectRejectedApplyMetric("temporary_unavailability");
  });

  it("preserves legacy proposal apply behavior", async () => {
    const proposal = await prisma.mcpProposal.create({
      data: { workspaceId, projectId, kind: "generic", title: "Legacy proposal" },
    });

    const response = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json().status).toBe("applied");
  });

  it("returns retryable unavailability when authorization storage fails", async () => {
    const proposal = await createTriageProposal();
    vi.spyOn(prisma.member, "findUnique").mockRejectedValueOnce(new Error("database unavailable"));

    const response = await app.inject({
      method: "POST",
      url: `/api/proposals/${proposal.id}/apply`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(503);
    expect(response.json().code).toBe("TRIAGE_GUARD_UNAVAILABLE");
    await expect(prisma.adminAuditLog.count()).resolves.toBe(0);
  });
});
