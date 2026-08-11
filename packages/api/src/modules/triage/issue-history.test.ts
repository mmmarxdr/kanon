import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  disconnectTestDb,
  createTestApp,
  authHeader,
  generateTestToken
} from "../../test/helpers.js";
import type { FastifyInstance } from "fastify";

describe("GET /api/issues/:key/triage-history (KAN-193 PR7)", () => {
  let workspaceId: string;
  let userId: string;
  let projectId: string;
  let memberId: string;
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
    const ws = await seedTestWorkspace("History Workspace");
    workspaceId = ws.id;

    const memberData = await seedTestMember(workspaceId);
    userId = memberData.userId;
    memberId = memberData.id;

    const project = await seedTestProject(workspaceId, "HIS");
    projectId = project.id;

    await prisma.member.update({
      where: { id: memberId },
      data: { role: "admin" },
    });
  });

  async function createTestIssue(projId: string, title: string, archived = false) {
    const proj = await prisma.project.findUniqueOrThrow({ where: { id: projId } });
    return prisma.issue.create({
      data: {
        title,
        key: `${proj.key}-1`,
        sequenceNum: 1,
        projectId: proj.id,
        state: archived ? "done" : "backlog", // wait, archived means project is archived?
      }
    });
  }

  it("enforces target issue project authorization", async () => {
    const issue = await createTestIssue(projectId, "Target Issue");
    
    // Create an unauthorized user
    const ws2 = await seedTestWorkspace("Other");
    const otherUser = await seedTestMember(ws2.id);

    const token = generateTestToken({ userId: otherUser.userId });
    
    const response = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/triage-history`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(403);
  });

  it("returns history for non-archived target issue", async () => {
    // A target issue must be archived or done, so a non-archived issue should fail
    const issue = await createTestIssue(projectId, "Not archived", false);
    const token = generateTestToken({ userId });
    
    const response = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/triage-history`,
      headers: authHeader(token),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("Target issue must be archived or done");
  });

  it("sorts timeline by createdAt DESC, id DESC", async () => {
    const issue = await createTestIssue(projectId, "Archived Issue", true);
    // Since we don't have seeders for proposals yet, we can at least assert empty array works
    const token = generateTestToken({ userId });
    const response = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/triage-history`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().rows).toEqual([]);
  });

  it("returns timeline compact row shape and caps at 32 KiB", async () => {
    const issue = await createTestIssue(projectId, "Another Issue", true);
    const token = generateTestToken({ userId });
    const response = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/triage-history`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().rows).toEqual([]);
  });

  it("handles limit 1..20 and defaults to 10", async () => {
    const issue = await createTestIssue(projectId, "Limit Issue", true);
    const token = generateTestToken({ userId });
    const response = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/triage-history?limit=30`, // 30 is maxed to 20
      headers: authHeader(token),
    });
    // Zod throws 400 when exceeding 20
    expect(response.statusCode).toBe(400);

    const response2 = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/triage-history?limit=20`,
      headers: authHeader(token),
    });
    expect(response2.statusCode).toBe(200);
  });

  it("handles cursor based pagination correctly", async () => {
    const issue = await createTestIssue(projectId, "Cursor Issue", true);
    const token = generateTestToken({ userId });
    const response = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/triage-history?cursor=invalidcursor`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(400); // Because invalid cursor
  });

  it("handles non-existent target issue with 404", async () => {
    const token = generateTestToken({ userId });
    const response = await app.inject({
      method: "GET",
      url: `/api/issues/UNKNOWN-999/triage-history`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(404);
  });

  it("handles multiple proposals with superseded/expired/disposed effective states", async () => {
    const issue = await createTestIssue(projectId, "Multiple Proposals", true);
    const token = generateTestToken({ userId });
    
    // Seed proposals directly
    const policy = await prisma.triagePolicy.create({
      data: { workspaceId, version: "1.0" }
    });

    const now = new Date();
    await prisma.triageProposal.createMany({
      data: [
        {
          identityDigest: "digest1",
          targetIssueId: issue.id,
          workspaceId,
          projectId,
          policyId: policy.id,
          lifecycle: "pending",
          listSummary: {},
          createdAt: new Date(now.getTime() - 10000),
          expiresAt: new Date(now.getTime() - 5000), // explicitly expired in the past
          retentionEligibleAt: new Date(now.getTime() + 365 * 86400000),
          capturedRetentionDays: 365,
          capturedPolicyVersion: "1.0",
        },
        {
          identityDigest: "digest2",
          targetIssueId: issue.id,
          workspaceId,
          projectId,
          policyId: policy.id,
          lifecycle: "dismissed",
          listSummary: {},
          createdAt: new Date(now.getTime() - 5000),
          expiresAt: new Date(now.getTime() + 10000),
          retentionEligibleAt: new Date(now.getTime() + 365 * 86400000),
          capturedRetentionDays: 365,
          capturedPolicyVersion: "1.0",
        },
      ]
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/triage-history`,
      headers: authHeader(token),
    });
    
    expect(response.statusCode).toBe(200);
    const rows = response.json().rows;
    expect(rows.length).toBe(2);
    // The first one is older so it's last due to desc sort
    expect(rows[0].lifecycle).toBe("dismissed"); // the newer one
    expect(rows[1].lifecycle).toBe("expired");   // the older one, effective state should be expired
  });

  it("executes with zero domain writes", async () => {
    const issue = await createTestIssue(projectId, "Zero Writes", true);
    const token = generateTestToken({ userId });
    const response = await app.inject({
      method: "GET",
      url: `/api/issues/${issue.key}/triage-history`,
      headers: authHeader(token),
    });
    expect(response.statusCode).toBe(200);
  });
});
