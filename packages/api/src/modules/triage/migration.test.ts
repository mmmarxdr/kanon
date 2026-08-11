import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { prisma } from "../../config/prisma.js";
import { seedTestWorkspace, seedTestProject, cleanDatabase } from "../../test/helpers.js";
import crypto from "node:crypto";

describe("Triage Proposal Migration Schema", () => {
  let workspace: any;
  let project: any;
  let policy: any;

  beforeAll(async () => {
    await cleanDatabase();
    workspace = await seedTestWorkspace("Triage Test");
    project = await seedTestProject(workspace.id, "TRG");
    policy = await prisma.triagePolicy.create({
      data: {
        workspaceId: workspace.id,
        version: "1",
        retentionDays: 365,
        dispositionListVisibility: "hidden",
      },
    });
  });

  afterAll(async () => {
    await cleanDatabase();
  });

  it("should have TriageProposal models accessible via prisma client", () => {
    expect(prisma.triageProposal).toBeDefined();
    expect(prisma.triageProposalContent).toBeDefined();
    expect(prisma.triageProposalLifecycleEvent).toBeDefined();
    expect(prisma.triagePolicy).toBeDefined();
  });

  it("should prevent cascade delete from policy to proposal (ON DELETE RESTRICT)", async () => {
    const createdAt = new Date();
    const proposal = await prisma.triageProposal.create({
      data: {
        identityDigest: crypto.randomBytes(32).toString("hex"),
        targetIssueId: crypto.randomUUID(),
        workspaceId: workspace.id,
        projectId: project.id,
        policyId: policy.id,
        lifecycle: "pending",
        listSummary: { title: "test" },
        createdAt,
        expiresAt: new Date(Date.now() + 86400000),
        retentionEligibleAt: new Date(createdAt.getTime() + 365 * 86400000),
        capturedRetentionDays: 365,
        capturedPolicyVersion: "1",
      },
    });

    // Attempting to delete the policy should fail due to RESTRICT
    await expect(
      prisma.triagePolicy.delete({ where: { id: policy.id } })
    ).rejects.toThrow(/Foreign key constraint violated/);

    // Clean up
    await prisma.triageProposal.delete({ where: { id: proposal.id } });
  });

  it("should maintain terminal-event uniqueness", async () => {
    const createdAt = new Date();
    const proposal = await prisma.triageProposal.create({
      data: {
        identityDigest: crypto.randomBytes(32).toString("hex"),
        targetIssueId: crypto.randomUUID(),
        workspaceId: workspace.id,
        projectId: project.id,
        policyId: policy.id,
        lifecycle: "pending",
        listSummary: { title: "test" },
        createdAt,
        expiresAt: new Date(Date.now() + 86400000),
        retentionEligibleAt: new Date(createdAt.getTime() + 365 * 86400000),
        capturedRetentionDays: 365,
        capturedPolicyVersion: "1",
      },
    });

    await prisma.triageProposalLifecycleEvent.create({
      data: {
        proposalId: proposal.id,
        state: "dismissed",
      },
    });

    // A second terminal event of the same state should fail
    await expect(
      prisma.triageProposalLifecycleEvent.create({
        data: {
          proposalId: proposal.id,
          state: "dismissed",
        },
      })
    ).rejects.toThrow(/Unique constraint failed/);

    // Clean up
    await prisma.triageProposalLifecycleEvent.deleteMany({ where: { proposalId: proposal.id } });
    await prisma.triageProposal.delete({ where: { id: proposal.id } });
  });

  it("allows only one successor per proposal", async () => {
    const createdAt = new Date();
    const proposalData = () => ({
      identityDigest: crypto.randomBytes(32).toString("hex"),
      targetIssueId: crypto.randomUUID(),
      workspaceId: workspace.id,
      projectId: project.id,
      policyId: policy.id,
      lifecycle: "pending" as const,
      listSummary: { title: "test" },
      createdAt,
      expiresAt: new Date(createdAt.getTime() + 7 * 86400000),
      retentionEligibleAt: new Date(createdAt.getTime() + 365 * 86400000),
      capturedRetentionDays: 365,
      capturedPolicyVersion: "1",
    });
    const predecessor = await prisma.triageProposal.create({ data: proposalData() });
    const successor = await prisma.triageProposal.create({
      data: { ...proposalData(), supersedesId: predecessor.id },
    });

    await expect(
      prisma.triageProposal.create({
        data: { ...proposalData(), supersedesId: predecessor.id },
      }),
    ).rejects.toThrow(/Unique constraint failed/);

    await expect(prisma.triageProposal.delete({ where: { id: predecessor.id } }))
      .rejects.toThrow(/triage_proposals_supersedes_id_fkey/);
    const selfId = crypto.randomUUID();
    await expect(prisma.triageProposal.create({
      data: { ...proposalData(), id: selfId, supersedesId: selfId },
    })).rejects.toThrow(/triage_proposals_supersedes_not_self/);
    await expect(prisma.triageProposal.create({
      data: { ...proposalData(), supersedesId: crypto.randomUUID() },
    })).rejects.toThrow(/triage_proposals_supersedes_id_fkey/);

    await prisma.triageProposal.delete({ where: { id: successor.id } });
    await prisma.triageProposal.delete({ where: { id: predecessor.id } });
  });

  it("rejects retention_days below the seven-day minimum", async () => {
    await expect(
      prisma.triagePolicy.create({
        data: {
          workspaceId: workspace.id,
          version: "too-short",
          retentionDays: 6,
          dispositionListVisibility: "hidden",
        },
      }),
    ).rejects.toThrow(/triage_policies_retention_days_min|CheckConstraintViolation|check constraint/i);
  });

  it("accepts disposed lifecycle for retention tombstones", async () => {
    const createdAt = new Date(Date.now() - 400 * 86400000);
    const proposal = await prisma.triageProposal.create({
      data: {
        identityDigest: crypto.randomBytes(32).toString("hex"),
        targetIssueId: crypto.randomUUID(),
        workspaceId: workspace.id,
        projectId: project.id,
        policyId: policy.id,
        lifecycle: "disposed",
        listSummary: { title: "tombstone" },
        createdAt,
        expiresAt: new Date(createdAt.getTime() + 7 * 86400000),
        retentionEligibleAt: new Date(createdAt.getTime() + 365 * 86400000),
        capturedRetentionDays: 365,
        capturedPolicyVersion: "1",
        disposedAt: new Date(),
        dispositionListVisible: false,
      },
    });

    expect(proposal.lifecycle).toBe("disposed");
    expect(proposal.disposedAt).not.toBeNull();

    await prisma.triageProposal.delete({ where: { id: proposal.id } });
  });
});
