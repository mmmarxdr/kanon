import { describe, it, expect, beforeEach, afterAll, beforeAll } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  seedTestWorkspace,
  seedTestMember,
  seedTestProject,
  cleanDatabase,
  createTestApp,
  authHeader,
  generateTestToken,
} from "../../test/helpers.js";
import { captureRetentionFromPolicy } from "./retention.js";
import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";

describe("GET /api/triage-proposals/:id (KAN-193 disposed get)", () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;
  let projectKey: string;
  let targetIssueId: string;
  let userId: string;
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
    userId = member.userId;
    userToken = member.token;

    const outsiderWs = await seedTestWorkspace(`out-${randomUUID().slice(0, 6)}`);
    const outsider = await seedTestMember(outsiderWs.id);
    outsiderToken = outsider.token;

    const project = await seedTestProject(workspaceId);
    projectId = project.id;
    projectKey = project.key;
    const target = await prisma.issue.create({
      data: {
        projectId,
        key: `${projectKey}-1`,
        sequenceNum: 1,
        title: "Triage target",
      },
    });
    targetIssueId = target.id;

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
    supersedesId?: string;
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
        targetIssueId,
        lifecycle: opts.lifecycle ?? "pending",
        listSummary: { title: "readable", candidateCount: 9 },
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 7 * 86400_000),
        retentionEligibleAt: captured.retentionEligibleAt,
        capturedRetentionDays: captured.capturedRetentionDays,
        capturedPolicyVersion: captured.capturedPolicyVersion,
        disposedAt: opts.disposedAt ?? undefined,
        dispositionListVisible: opts.dispositionListVisible ?? undefined,
        supersedesId: opts.supersedesId,
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
    expect(body.lifecycle).toBe("current");
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

  it("treats an explicitly empty token scope as no project access", async () => {
    const proposal = await createProposal();
    const scopedToken = generateTestToken({ userId, allowedProjectIds: [] });
    const res = await app.inject({
      method: "GET",
      url: `/api/triage-proposals/${proposal.id}`,
      headers: authHeader(scopedToken),
    });
    expect(res.statusCode).toBe(404);

    await prisma.issue.update({ where: { id: targetIssueId }, data: { state: "done" } });
    const history = await app.inject({
      method: "GET", url: `/api/issues/${projectKey}-1/triage-history`, headers: authHeader(scopedToken),
    });
    expect(history.statusCode).toBe(404);
  });

  it("returns 404 for unknown id", async () => {
    const res = await app.inject({
      method: "GET",
      url: `/api/triage-proposals/${randomUUID()}`,
      headers: authHeader(userToken),
    });
    expect(res.statusCode).toBe(404);
  });

  it("redacts both aliases and dependent actions without mutating stored content", async () => {
    const hiddenProject = await seedTestProject(workspaceId, `H${randomUUID().slice(0, 4)}`);
    const hidden = await prisma.issue.create({
      data: { projectId: hiddenProject.id, key: `${hiddenProject.key}-1`, sequenceNum: 1, title: "Hidden" },
    });
    const proposal = await createProposal();
    const evidence = { evidenceRefId: `candidate:${hidden.id}:title`, field: "title" };
    const normalized = { concept: "impact", operation: "recommend", value: "high", metadataOnly: true };
    await prisma.triageProposal.update({
      where: { id: proposal.id },
      data: { listSummary: { candidateCount: 1, recommendationCount: 1, actionKinds: ["impact"] } },
    });
    await prisma.triageProposalContent.update({
      where: { proposalId: proposal.id },
      data: {
        payload: { normalizedPayload: { candidateIds: [hidden.id], actions: [normalized] } },
        provenance: {
          retainedCandidateIds: [hidden.id],
          retainedItemIds: [hidden.key, "host:1"],
          preview: {
            candidates: [{ issueId: hidden.id, issueKey: hidden.key, rank: 1, evidence: [evidence] }],
            evidence: [evidence],
            recommendations: [{ itemId: "host:1", state: "supported", normalized, evidence: [evidence] }],
            conflicts: ["host:1"],
            unknowns: [],
          },
        },
      },
    });
    const stored = await prisma.triageProposalContent.findUniqueOrThrow({ where: { proposalId: proposal.id } });

    const res = await app.inject({
      method: "GET", url: `/api/triage-proposals/${proposal.id}`, headers: authHeader(userToken),
    });
    const serialized = JSON.stringify(res.json());
    expect(res.statusCode).toBe(200);
    expect(serialized).not.toContain(hidden.id);
    expect(serialized).not.toContain(hidden.key);
    expect(serialized).not.toContain("host:1");
    expect(res.json().content.payload.normalizedPayload.actions).toEqual([]);
    await expect(prisma.triageProposalContent.findUniqueOrThrow({ where: { proposalId: proposal.id } }))
      .resolves.toEqual(stored);
  });

  it("hides disposed supersession relationship identifiers", async () => {
    const predecessor = await createProposal({
      lifecycle: "disposed", disposedAt: new Date(), dispositionListVisible: false,
    });
    const successor = await createProposal({ supersedesId: predecessor.id });
    const res = await app.inject({
      method: "GET", url: `/api/triage-proposals/${successor.id}`, headers: authHeader(userToken),
    });
    expect(res.json()).toMatchObject({ lifecycle: "current", supersedesId: null });
  });

  it("omits candidate cardinality from target history", async () => {
    await createProposal({ lifecycle: "pending" });
    const hidden = await createProposal({
      lifecycle: "disposed", disposedAt: new Date(), dispositionListVisible: false,
    });
    await createProposal({ supersedesId: hidden.id });
    await prisma.issue.update({ where: { id: targetIssueId }, data: { state: "done" } });

    const res = await app.inject({
      method: "GET",
      url: `/api/issues/${projectKey}-1/triage-history`,
      headers: authHeader(userToken),
    });

    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(2);
    expect(JSON.stringify(res.json())).not.toContain(hidden.id);
    expect(res.json().rows[0].listSummary).toEqual({ title: "readable" });
  });
});
