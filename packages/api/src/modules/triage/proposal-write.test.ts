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
        title: "Login failure",
      },
    });
    await prisma.issue.create({
      data: {
        projectId: project.id,
        key: `${project.key}-3`,
        sequenceNum: 3,
        title: "Login failure",
      },
    });
    const issueBefore = await prisma.issue.findUniqueOrThrow({ where: { id: target.id } });
    const correlationId = randomUUID();
    const preview = await executePreview({
      issueKey: target.key,
      userId: member.userId,
      allowedProjectIds: undefined,
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
    expect(preview.candidates.length).toBeGreaterThan(1);
    expect(proposal.content?.provenance.preview.candidates.map((candidate: { rank: number }) => candidate.rank))
      .toEqual(preview.candidates.map((candidate) => candidate.rank));

    const partial = await persistTriageProposal({
      ...input,
      correlationId: randomUUID(),
      body: { preview, previewSeal: preview.previewSeal, retainedItemIds: [preview.candidates[1]!.issueId, preview.candidates[0]!.issueId] },
    });
    const partialContent = await prisma.triageProposalContent.findUniqueOrThrow({ where: { proposalId: partial.id } });
    const persistedCandidates = (partialContent.provenance as { preview: { candidates: Array<{ issueId: string; rank: number }> } }).preview.candidates;
    expect(persistedCandidates.length).toBeGreaterThan(1);
    expect(persistedCandidates.map((candidate) => candidate.rank)).toEqual(
      preview.candidates.filter((candidate) => persistedCandidates.some((stored) => stored.issueId === candidate.issueId)).map((candidate) => candidate.rank),
    );
    await expect(prisma.issue.findUniqueOrThrow({ where: { id: target.id } })).resolves.toEqual(issueBefore);

    await prisma.issue.update({ where: { id: target.id }, data: { priority: "low" } });
    const correctionPreview = await executePreview({
      issueKey: target.key,
      userId: member.userId,
      allowedProjectIds: undefined,
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
      allowedProjectIds: undefined,
      correlationId,
      request: { phase: "prepare", aiIntent: "none", format: "compact" },
    });
    await expect(persistTriageProposal({
      ...input,
      body: { ...correctionInput.body, preview: conflictingPreview, previewSeal: conflictingPreview.previewSeal },
    })).rejects.toMatchObject({ statusCode: 409, code: "SUPERSESSION_CONFLICT" });

    await expect(persistTriageProposal({
      ...input,
      allowedProjectIds: [],
      body: { preview: conflictingPreview, previewSeal: conflictingPreview.previewSeal },
    })).resolves.toMatchObject({ outcome: "created" });

    await expect(persistTriageProposal(input, performance.now() - 1)).rejects.toMatchObject({
      statusCode: 503,
      code: "PERSISTENCE_TIMED_OUT",
    });
  });
});
