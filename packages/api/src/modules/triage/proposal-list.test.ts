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
  let targetIssueId: string;
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
    const target = await prisma.issue.create({
      data: {
        projectId,
        key: `${projectKey}-1`,
        sequenceNum: 1,
        title: "List target",
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
    supersedesId?: string;
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
        targetIssueId,
        lifecycle: opts.lifecycle,
        listSummary: {
          targetIssueKey: projectKey,
          targetTitle: opts.lifecycle,
          actionKinds: ["urgency"],
          generatorSource: "deterministic_policy",
          policy: { id: policyId, version: "v1" },
          confidenceBands: ["high"],
          degraded: false,
          degradationCategories: [],
          nonExecutable: true,
        },
        createdAt,
        expiresAt:
          opts.expiresAt ??
          (opts.lifecycle === "expired"
            ? new Date(Date.now() - 86400_000)
            : new Date(Date.now() + 86400_000)),
        retentionEligibleAt: captured.retentionEligibleAt,
        capturedRetentionDays: captured.capturedRetentionDays,
        capturedPolicyVersion: captured.capturedPolicyVersion,
        supersedesId: opts.supersedesId,
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
    expect(body.rows[0].lifecycle).toBe("current");
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

  it("separates current and superseded rows without revealing hidden relationships", async () => {
    const predecessor = await createProposal({ lifecycle: "pending" });
    const successor = await createProposal({ lifecycle: "pending", supersedesId: predecessor.id });

    const current = await app.inject({
      method: "GET", url: `/api/projects/${projectKey}/triage-proposals`, headers: authHeader(userToken),
    });
    const superseded = await app.inject({
      method: "GET", url: `/api/projects/${projectKey}/triage-proposals?state=superseded`, headers: authHeader(userToken),
    });
    expect(current.json().rows.map(({ id }: { id: string }) => id)).toEqual([successor.id]);
    expect(superseded.json().rows[0]).toMatchObject({ id: predecessor.id, successorId: successor.id });

    await prisma.triageProposal.update({
      where: { id: successor.id },
      data: { lifecycle: "disposed", disposedAt: new Date(), dispositionListVisible: false },
    });
    const hidden = await app.inject({
      method: "GET", url: `/api/projects/${projectKey}/triage-proposals?state=superseded`, headers: authHeader(userToken),
    });
    expect(hidden.json().rows[0].successorId).toBeNull();
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
    expect(res.json().rows[0].listSummary).toMatchObject({ targetTitle: "expired" });
  });

  it("continues the same authorized snapshot with an opaque cursor", async () => {
    await createProposal({ lifecycle: "pending" });
    await createProposal({ lifecycle: "pending" });

    const first = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?limit=1`,
      headers: authHeader(userToken),
    });
    const firstBody = first.json();
    const second = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor)}`,
      headers: authHeader(userToken),
    });

    expect(first.statusCode).toBe(200);
    expect(firstBody.nextCursor).toMatch(/^cur\.v1\./);
    expect(second.statusCode).toBe(200);
    expect(second.json().rows[0].id).not.toBe(firstBody.rows[0].id);
    expect(second.json().nextCursor).toBeUndefined();
  });

  it("hides proposals whose target was deleted before filtering and counting", async () => {
    await createProposal({ lifecycle: "pending" });
    await prisma.issue.delete({ where: { id: targetIssueId } });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals`,
      headers: authHeader(userToken),
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ returnedCount: 0, rows: [] });
    expect(response.json().nextCursor).toBeUndefined();
  });

  it("rejects cursor continuation after lifecycle source changes", async () => {
    await createProposal({ lifecycle: "pending" });
    const changed = await createProposal({ lifecycle: "pending" });
    const first = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?limit=1`,
      headers: authHeader(userToken),
    });
    await prisma.triageProposal.update({
      where: { id: changed.id },
      data: { lifecycle: "dismissed" },
    });

    const second = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: authHeader(userToken),
    });

    expect(second.statusCode).toBe(409);
    expect(second.json().code).toBe("CURSOR_SOURCE_CONFLICT");
  });

  it("ignores successors created after the first-page snapshot", async () => {
    const predecessor = await createProposal({ lifecycle: "pending" });
    await createProposal({ lifecycle: "pending" });
    const first = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?limit=1`,
      headers: authHeader(userToken),
    });
    await prisma.triageProposal.create({
      data: {
        workspaceId,
        projectId,
        policyId,
        identityDigest: `digest-${randomUUID()}`,
        targetIssueId,
        lifecycle: "pending",
        listSummary: { title: "new successor" },
        expiresAt: new Date(Date.now() + 86400_000),
        retentionEligibleAt: new Date(Date.now() + 30 * 86400_000),
        capturedRetentionDays: 30,
        capturedPolicyVersion: "v1",
        supersedesId: predecessor.id,
      },
    });

    const second = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?limit=1&cursor=${encodeURIComponent(first.json().nextCursor)}`,
      headers: authHeader(userToken),
    });

    expect(second.statusCode).toBe(200);
  });

  it("keeps a maximum list page within 32 KiB", async () => {
    const long = `${"x".repeat(199)}😀`;
    await prisma.triageProposal.createMany({
      data: Array.from({ length: 50 }, (_, index) => ({
        workspaceId,
        projectId,
        policyId,
        identityDigest: `digest-${randomUUID()}`,
        targetIssueId,
        lifecycle: "pending" as const,
        listSummary: index === 0 ? "x".repeat(50_000) : {
          targetIssueKey: projectKey,
          targetTitle: long,
          actionKinds: ["severity", "impact", "urgency", "sla"],
          generatorSource: "host_ai",
          policy: { id: long, version: long },
          model: { provider: long, model: long, modelVersion: long },
          confidenceBands: ["low", "medium", "high"],
          degraded: true,
          degradationCategories: Array.from({ length: 8 }, () => long),
          nonExecutable: true,
        },
        createdAt: new Date(Date.now() - index),
        expiresAt: new Date(Date.now() + 86400_000),
        retentionEligibleAt: new Date(Date.now() + 30 * 86400_000),
        capturedRetentionDays: 30,
        capturedPolicyVersion: "v1",
      })),
    });

    const response = await app.inject({
      method: "GET",
      url: `/api/projects/${projectKey}/triage-proposals?limit=50`,
      headers: authHeader(userToken),
    });

    expect(response.statusCode).toBe(200);
    expect(Buffer.byteLength(response.body)).toBeLessThanOrEqual(32 * 1024);
    expect(response.json().rows[1].listSummary.targetTitle).toBe("x".repeat(199));
    expect(response.json().nextCursor).toMatch(/^cur\.v1\./);
  });
});
