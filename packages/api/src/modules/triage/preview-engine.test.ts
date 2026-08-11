import { randomUUID } from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { executePreview, PreviewRequestSchema } from "./preview.js";

describe("executePreview", () => {
  let workspaceId: string;
  let projectId: string;
  let userId: string;
  let issueKey: string;

  afterAll(disconnectTestDb);

  beforeEach(async () => {
    await cleanDatabase();
    const workspace = await seedTestWorkspace(`preview-${randomUUID().slice(0, 8)}`);
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id, `P${randomUUID().slice(0, 4)}`);
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: member.userId, role: "member" },
    });
    await prisma.triagePolicy.create({
      data: { workspaceId: workspace.id, version: "triage-policy.v1" },
    });
    const issue = await prisma.issue.create({
      data: {
        projectId: project.id,
        key: `${project.key}-1`,
        sequenceNum: 1,
        title: "Login failure",
        priority: "high",
      },
    });
    await prisma.issue.create({
      data: {
        projectId: project.id,
        key: `${project.key}-2`,
        sequenceNum: 2,
        title: `${"a".repeat(239)}😀 Login failure duplicate`,
      },
    });
    workspaceId = workspace.id;
    projectId = project.id;
    userId = member.userId;
    issueKey = issue.key;
  });

  const execute = (request: unknown, allowedProjectIds: string[] = []) => executePreview({
    issueKey,
    userId,
    allowedProjectIds,
    correlationId: randomUUID(),
    request: PreviewRequestSchema.parse(request),
  });

  it("produces stable deterministic findings without domain writes", async () => {
    const before = await Promise.all([
      prisma.issue.findMany({ orderBy: { key: "asc" } }),
      prisma.activityLog.count(),
      prisma.triageProposal.count(),
    ]);

    const first = await execute({ phase: "prepare" });
    const repeated = await execute({ phase: "prepare" });
    const stable = ({ recommendations, candidates, conflicts, unknowns, degradation }: typeof first) => ({
      recommendations,
      candidates,
      conflicts,
      unknowns,
      degradation,
    });

    expect(first).toMatchObject({
      contractVersion: "triage-preview.v1",
      target: { issueKey },
      recommendations: [{ source: "deterministic_policy", state: "supported" }],
      candidates: [{ rank: 1 }],
    });
    expect(first.previewSeal).toMatch(/^seal\.v1\./);
    expect(first.candidates[0]!.evidence[0]!.excerpt).toBe("a".repeat(239));
    expect(stable(repeated)).toEqual(stable(first));
    await expect(prisma.issue.findMany({ orderBy: { key: "asc" } })).resolves.toEqual(before[0]);
    await expect(prisma.activityLog.count()).resolves.toBe(before[1]);
    await expect(prisma.triageProposal.count()).resolves.toBe(before[2]);
  });

  it("validates bounded host recommendations against prepared evidence", async () => {
    const prepared = await execute({ phase: "prepare", aiIntent: "host_assisted" });
    const evidenceRefId = prepared.recommendations[0]!.evidence[0]!.evidenceRefId;

    const request = {
      phase: "validate",
      contextToken: prepared.contextToken,
      hostOutcome: {
        status: "completed",
        provider: "test",
        model: "test-model",
        modelVersion: "1",
      },
      suggestions: [{
        concept: "impact",
        value: "customer-facing",
        reason: "Login failure blocks users",
        evidenceRefIds: [evidenceRefId],
        confidence: "medium",
        confidenceBasis: "Target priority evidence",
      }],
    };
    const validated = await execute(request);

    expect(validated.recommendations).toEqual(
      expect.arrayContaining([expect.objectContaining({ source: "host_ai", state: "supported" })]),
    );
    const invalid = await execute({
      ...request,
      suggestions: [{ ...request.suggestions[0]!, evidenceRefIds: ["missing"] }],
    });
    expect(invalid.recommendations.some((item) => item.source === "host_ai")).toBe(false);
    expect(invalid.degradation).toContain("ai_invalid");
    await prisma.issue.update({
      where: { id: prepared.candidates[0]!.issueId },
      data: { description: "changed after prepare" },
    });
    await expect(execute(request)).rejects.toMatchObject({ code: "SOURCE_CONFLICT", statusCode: 409 });
    await expect(prisma.triageProposal.count()).resolves.toBe(0);
  });

  it("marks policy-host and host-host disagreements as conflicts", async () => {
    const prepared = await execute({ phase: "prepare", aiIntent: "host_assisted" });
    const evidenceRefId = prepared.recommendations[0]!.evidence[0]!.evidenceRefId;
    const suggestion = (concept: "urgency" | "impact", value: string) => ({
      concept,
      value,
      reason: `${concept} is ${value}`,
      evidenceRefIds: [evidenceRefId],
      confidence: "medium" as const,
      confidenceBasis: "Target priority evidence",
    });

    const validated = await execute({
      phase: "validate",
      contextToken: prepared.contextToken,
      hostOutcome: {
        status: "completed",
        provider: "test",
        model: "test-model",
        modelVersion: "1",
      },
      suggestions: [
        suggestion("urgency", "low"),
        suggestion("impact", "low"),
        suggestion("impact", "high"),
        suggestion("impact", "ignored"),
      ],
    });

    expect(validated.recommendations).toEqual([
      expect.objectContaining({ itemId: "policy:priority-urgency:v1", state: "conflict" }),
      expect.objectContaining({ itemId: "host:1", state: "conflict" }),
      expect.objectContaining({ itemId: "host:2", state: "conflict" }),
      expect.objectContaining({ itemId: "host:3", state: "conflict" }),
    ]);
    expect(validated.conflicts).toEqual([
      "policy:priority-urgency:v1",
      "host:1",
      "host:2",
      "host:3",
    ]);
    expect(validated.degradation).toContain("host_suggestions_truncated");
  });

  it("intersects workspace candidates with credential project scope", async () => {
    const foreign = await seedTestProject(workspaceId, `F${randomUUID().slice(0, 4)}`);
    await prisma.projectMember.create({
      data: { projectId: foreign.id, userId, role: "member" },
    });
    await prisma.issue.create({
      data: {
        projectId: foreign.id,
        key: `${foreign.key}-1`,
        sequenceNum: 1,
        title: "Login failure outside token scope",
      },
    });

    const preview = await execute(
      { phase: "prepare", scope: { kind: "workspace", workspaceId } },
      [projectId],
    );

    expect(preview.candidates.every((candidate) => !candidate.issueKey.startsWith(`${foreign.key}-`)))
      .toBe(true);
  });
});
