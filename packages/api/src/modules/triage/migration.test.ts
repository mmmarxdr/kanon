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
    const proposal = await prisma.triageProposal.create({
      data: {
        identityDigest: crypto.randomBytes(32).toString("hex"),
        targetIssueId: crypto.randomUUID(),
        workspaceId: workspace.id,
        projectId: project.id,
        policyId: policy.id,
        lifecycle: "pending",
        listSummary: { title: "test" },
        expiresAt: new Date(Date.now() + 86400000),
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
    const proposal = await prisma.triageProposal.create({
      data: {
        identityDigest: crypto.randomBytes(32).toString("hex"),
        targetIssueId: crypto.randomUUID(),
        workspaceId: workspace.id,
        projectId: project.id,
        policyId: policy.id,
        lifecycle: "pending",
        listSummary: { title: "test" },
        expiresAt: new Date(Date.now() + 86400000),
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
});


