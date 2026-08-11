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
import { executePreview } from "./preview.js";
import { persistTriageProposal } from "./proposal-write.js";

describe("persistTriageProposal", () => {
  beforeEach(cleanDatabase);
  afterAll(disconnectTestDb);

  it("deduplicates atomically and captures immutable source and retention", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMember(workspace.id);
    const project = await seedTestProject(workspace.id);
    await prisma.projectMember.create({
      data: { projectId: project.id, userId: member.userId, role: "member" },
    });
    await prisma.triagePolicy.create({
      data: { workspaceId: workspace.id, version: "policy-v1", retentionDays: 30 },
    });
    const target = await prisma.issue.create({
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
        title: "Login failure duplicate",
      },
    });
    const issueBefore = await prisma.issue.findUniqueOrThrow({ where: { id: target.id } });
    const correlationId = randomUUID();
    const preview = await executePreview({
      issueKey: target.key,
      userId: member.userId,
      allowedProjectIds: [],
      correlationId,
      request: { phase: "prepare", aiIntent: "none", format: "compact" },
    });
    const input = {
      issueKey: target.key,
      issueId: target.id,
      memberId: member.id,
      userId: member.userId,
      allowedProjectIds: undefined,
      client: "test",
      correlationId,
      body: { preview, previewSeal: preview.previewSeal },
    };

    const results = await Promise.all([
      persistTriageProposal(input),
      persistTriageProposal(input),
    ]);

    expect(results.map(({ outcome }) => outcome).sort()).toEqual(["created", "deduplicated"]);
    expect(results[0]?.id).toBe(results[1]?.id);
    const proposal = await prisma.triageProposal.findUniqueOrThrow({
      where: { id: results[0]!.id },
      include: { content: true },
    });
    expect(proposal).toMatchObject({
      capturedRetentionDays: 30,
      capturedPolicyVersion: "policy-v1",
    });
    expect(proposal.retentionEligibleAt.getTime() - proposal.createdAt.getTime()).toBe(30 * 86_400_000);
    expect(proposal.content?.payload).toMatchObject({
      provenance: { sourceSnapshots: { target: { issueId: target.id } } },
    });
    await expect(prisma.issue.findUniqueOrThrow({ where: { id: target.id } })).resolves.toEqual(issueBefore);

    await prisma.issue.update({ where: { id: target.id }, data: { priority: "low" } });
    const correctionPreview = await executePreview({
      issueKey: target.key,
      userId: member.userId,
      allowedProjectIds: [],
      correlationId,
      request: { phase: "prepare", aiIntent: "none", format: "compact" },
    });
    const correctionInput = {
      ...input,
      body: {
        preview: correctionPreview,
        previewSeal: correctionPreview.previewSeal,
        supersedesId: proposal.id,
      },
    };
    const correction = await persistTriageProposal(correctionInput);
    await expect(persistTriageProposal(correctionInput)).resolves.toMatchObject({
      id: correction.id,
      outcome: "deduplicated",
    });
    await prisma.issue.update({ where: { id: target.id }, data: { priority: "medium" } });
    const conflictingPreview = await executePreview({
      issueKey: target.key,
      userId: member.userId,
      allowedProjectIds: [],
      correlationId,
      request: { phase: "prepare", aiIntent: "none", format: "compact" },
    });
    await expect(persistTriageProposal({
      ...input,
      body: { ...correctionInput.body, preview: conflictingPreview, previewSeal: conflictingPreview.previewSeal },
    })).rejects.toMatchObject({ statusCode: 409, code: "SUPERSESSION_CONFLICT" });

    await expect(persistTriageProposal({ ...input, allowedProjectIds: [] })).rejects.toMatchObject({
      statusCode: 404,
      code: "NOT_FOUND_OR_NOT_VISIBLE",
    });
  });
});
