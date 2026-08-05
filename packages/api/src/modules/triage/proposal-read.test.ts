import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  createTestApp,
  authHeader,
} from "../../test/helpers.js";
import { captureRetentionFromPolicy } from "./retention.js";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

describe("GET /api/triage-proposals/:id (KAN-193 disposed get)", () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;
  let projectKey: string;
  let policyId: string;
  let userToken: string;
  let outsiderToken: string;

  beforeAll(async () => {
    app = await createTestApp();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase();
    const ws = await seedTestWorkspace();
    workspaceId = ws.id;

    const member = await seedTestMember(workspaceId);
    userToken = member.token;

    const outsiderWs = await seedTestWorkspace(`out-${randomUUID().slice(0, 6)}`);
    const outsider = await seedTestMember(outsiderWs.id);
    outsiderToken = outsider.token;

    const project = await seedTestProject(workspaceId);
    projectId = project.id;
    projectKey = project.key;

    await prisma.projectMember.create({
      data: { projectId, userId: member.userId, role: "member" },
    });

    const policy = await prisma.triagePolicy.create({
      data: {
        workspaceId,
        version: "v1",
        retentionDays: 365,
        dispositionListVisibility: "hidden",
      },
    });
    policyId = policy.id;
  });

  async function createProposal(opts: {
    lifecycle?: "pending" | "disposed" | "expired";
    disposedAt?: Date | null;
    dispositionListVisible?: boolean | null;
    withContent?: boolean;
  } = {}) {
    const createdAt = new Date();
    const policy = await prisma.triagePolicy.findUniqueOrThrow({
      where: { id: policyId },
    });
    const captured = captureRetentionFromPolicy(policy, createdAt);
    return prisma.triageProposal.create({
      data: {
        workspaceId,
        projectId,
        policyId,
        identityDigest: `digest-${randomUUID()}`,
        targetIssueId: randomUUID(),
        lifecycle: opts.lifecycle ?? "pending",
        listSummary: { title: "readable" },
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 7 * 86400_000),
        retentionEligibleAt: captured.retentionEligibleAt,
        capturedRetentionDays: captured.capturedRetentionDays,
        capturedPolicyVersion: captured.capturedPolicyVersion,
        disposedAt: opts.disposedAt ?? undefined,
        dispositionListVisible: opts.dispositionListVisible ?? undefined,
        content:
          opts.withContent === false
            ? undefined
            : {
                create: {
                  payload: { secret: "must-not-leak" },
                  provenance: { source: "test" },
                },
              },
      },
    });
  }

  it("returns 200 with content for an authorized pending proposal", async () => {
    const proposal = await createProposal({ lifecycle: "pending" });
    const res = await app.inject({
      method: "GET",
      url: `/api/triage-proposals/${proposal.id}`,
      headers: authHeader(userToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.content?.payload).toEqual({ secret: "must-not-leak" });
    expect(body.lifecycle).toBe("pending");
  });

  it("returns 410 tombstone without content for disposed proposal", async () => {
    const proposal = await createProposal({
      lifecycle: "disposed",
      disposedAt: new Date(),
      dispositionListVisible: false,
      withContent: false,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/triage-proposals/${proposal.id}`,
      headers: authHeader(userToken),
    });
    expect(res.statusCode).toBe(410);
    const body = res.json();
    expect(body.lifecycle).toBe("disposed");
    expect(body.httpStatus).toBe(410);
    expect(body.content).toBeUndefined();
    expect(body.payload).toBeUndefined();
    expect(body.retentionPolicy).toMatchObject({
      id: policyId,
      version: "v1",
      retentionDays: 365,
    });
  });

  it("returns 404 for outsider (no existence leak)", async () => {
    const proposal = await createProposal({ lifecycle: "pending" });
    const res = await app.inject({
      method: "GET",
      url: `/api/triage-proposals/${proposal.id}`,
      headers: authHeader(outsiderToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/triage-proposals/${randomUUID()}`,
      headers: authHeader(userToken),
    });
    expect(res.statusCode).toBe(404);
  });
});
