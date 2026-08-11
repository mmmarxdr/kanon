import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

describe("triage feature flags", () => {
  let app: FastifyInstance;
  let helpers: typeof import("../../test/helpers.js");
  let prisma: typeof import("../../config/prisma.js").prisma;
  let token: string;
  let workspaceId: string;
  let projectKey: string;
  let issueKey: string;
  let issueId: string;
  let policyId: string;

  beforeAll(async () => {
    process.env["TRIAGE_SEARCH_ENABLED"] = "false";
    process.env["TRIAGE_PREVIEW_ENABLED"] = "false";
    process.env["TRIAGE_PROPOSAL_READS_ENABLED"] = "false";
    process.env["TRIAGE_PROPOSALS_ENABLED"] = "false";
    helpers = await import("../../test/helpers.js");
    prisma = (await import("../../config/prisma.js")).prisma;
    await helpers.cleanDatabase();
    const workspace = await helpers.seedTestWorkspace(`flags-${randomUUID().slice(0, 8)}`);
    const member = await helpers.seedTestMember(workspace.id);
    const project = await helpers.seedTestProject(workspace.id, `F${randomUUID().slice(0, 4)}`);
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: member.userId, role: "member" },
    });
    const issue = await prisma.issue.create({
      data: { projectId: project.id, key: `${project.key}-1`, sequenceNum: 1, title: "Flag target" },
    });
    const policy = await prisma.triagePolicy.create({
      data: { workspaceId: workspace.id, version: "v1" },
    });
    token = member.token;
    workspaceId = workspace.id;
    projectKey = project.key;
    issueKey = issue.key;
    issueId = issue.id;
    policyId = policy.id;
    app = await helpers.createTestApp();
  });

  afterAll(async () => {
    await app.close();
    await helpers.disconnectTestDb();
    process.env["TRIAGE_SEARCH_ENABLED"] = "true";
    process.env["TRIAGE_PREVIEW_ENABLED"] = "true";
    process.env["TRIAGE_PROPOSAL_READS_ENABLED"] = "true";
    process.env["TRIAGE_PROPOSALS_ENABLED"] = "true";
  });

  it("keeps search, preview, reads, and writes disabled independently", async () => {
    const now = new Date().toISOString();
    const preview = {
      contractVersion: "triage-preview.v1",
      previewIdentity: "preview",
      previewSeal: "seal",
      target: {
        workspaceId,
        projectId: "00000000-0000-4000-8000-000000000001",
        issueId,
        issueKey,
        projectKey,
        sourceVersion: "source-v1",
        sourceHash: "0".repeat(64),
      },
      observedAt: now,
      generatedAt: now,
      authorizationPolicyVersion: "authz-policy.v1",
      effectiveScope: {
        kind: "project",
        workspaceId,
        projectId: "00000000-0000-4000-8000-000000000001",
      },
      searchCompleteness: "complete",
      correlationId: "correlation",
      policy: { id: policyId, version: "v1" },
      recommendations: [{
        itemId: "policy:urgency",
        state: "supported",
        normalized: { concept: "urgency", operation: "recommend", value: "medium", metadataOnly: true },
        source: "deterministic_policy",
        reason: "Policy",
        evidence: [{ evidenceRefId: "target:priority", sourceClass: "deterministic_fact", field: "priority", fact: "medium" }],
        confidence: "high",
        confidenceBasis: "Direct field",
        ruleVersion: "v1",
      }],
      candidates: [],
      conflicts: [],
      unknowns: [],
      degradation: [],
    };
    const headers = helpers.authHeader(token);
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: `/api/workspaces/${workspaceId}/issue-search.v1`,
        headers,
        payload: { q: "flag", scope: { kind: "workspace", workspaceId } },
      }),
      app.inject({
        method: "POST",
        url: `/api/issues/${issueKey}/triage/preview`,
        headers,
        payload: { phase: "prepare" },
      }),
      app.inject({
        method: "GET",
        url: `/api/projects/${projectKey}/triage-proposals`,
        headers,
      }),
      app.inject({
        method: "GET",
        url: `/api/triage-proposals/${randomUUID()}`,
        headers,
      }),
      app.inject({
        method: "POST",
        url: `/api/issues/${issueKey}/triage-proposals`,
        headers,
        payload: { preview, previewSeal: "seal" },
      }),
      app.inject({
        method: "POST",
        url: `/api/triage-proposals/${randomUUID()}/dismiss`,
        headers,
        payload: { reason: "disabled" },
      }),
    ]);

    expect(responses.map((response) => response.statusCode)).toEqual([503, 503, 503, 503, 503, 503]);
    await expect(prisma.triageProposal.count()).resolves.toBe(0);
  });
});
