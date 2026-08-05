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

describe("GET /api/projects/:key/triage-proposals (KAN-193 disposed list)", () => {
  let app: FastifyInstance;
  let workspaceId: string;
  let projectId: string;
  let projectKey: string;
  let policyId: string;
  let userToken: string;

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
        retentionDays: 30,
        dispositionListVisibility: "hidden",
      },
    });
    policyId = policy.id;
  });

  async function createProposal(opts: {
    lifecycle: "pending" | "expired" | "disposed";
    dispositionListVisible?: boolean | null;
    expiresAt?: Date;
  }) {
    const createdAt = new Date(Date.now() - 10 * 86400_000);
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
        lifecycle: opts.lifecycle,
        listSummary: { title: opts.lifecycle },
        createdAt,
        expiresAt:
          opts.expiresAt ??
          (opts.lifecycle === "expired"
            ? new Date(Date.now() - 86400_000)
            : new Date(Date.now() + 86400_000)),
        retentionEligibleAt: captured.retentionEligibleAt,
        capturedRetentionDays: captured.capturedRetentionDays,
        capturedPolicyVersion: captured.capturedPolicyVersion,
        disposedAt: opts.lifecycle === "disposed" ? new Date() : undefined,
        dispositionListVisible:
          opts.lifecycle === "disposed"
            ? (opts.dispositionListVisible ?? false)
            : undefined,
      },
    });
  }

  it("default current list excludes expired and disposed", async () => {
    await createProposal({ lifecycle: "pending" });
    await createProposal({ lifecycle: "expired" });
    await createProposal({
      lifecycle: "disposed",
      dispositionListVisible: true,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals`,
      headers: authHeader(userToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0].lifecycle).toBe("pending");
  });

  it("hides disposed when dispositionListVisible is false", async () => {
    await createProposal({
      lifecycle: "disposed",
      dispositionListVisible: false,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?state=disposed`,
      headers: authHeader(userToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(0);
  });

  it("returns disposed tombstone rows when dispositionListVisible is true", async () => {
    const disposed = await createProposal({
      lifecycle: "disposed",
      dispositionListVisible: true,
    });

    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?state=disposed`,
      headers: authHeader(userToken),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.rows).toHaveLength(1);
    expect(body.rows[0]).toMatchObject({
      id: disposed.id,
      lifecycle: "disposed",
      dispositionListVisible: true,
    });
    expect(body.rows[0].listSummary).toBeUndefined();
    expect(body.rows[0].content).toBeUndefined();
  });

  it("lists expired on explicit filter without content table fields", async () => {
    await createProposal({ lifecycle: "expired" });
    const res = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?state=expired`,
      headers: authHeader(userToken),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().rows).toHaveLength(1);
    expect(res.json().rows[0].lifecycle).toBe("expired");
    expect(res.json().rows[0].listSummary).toEqual({ title: "expired" });
  });
});
