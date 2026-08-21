import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMember,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";

const apiDirectory = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const schemaPath = join(apiDirectory, "prisma/schema.prisma");
const migrationPath = join(
  apiDirectory,
  "prisma/migrations/20260821150000_integration_reconciliation_recommendations/migration.sql",
);

async function clearRecommendations() {
  await prisma.integrationReconciliationRecommendation.deleteMany();
}

async function fixture() {
  const workspace = await seedTestWorkspace();
  const project = await seedTestProject(workspace.id);
  const member = await seedTestMember(workspace.id);
  const connection = await prisma.integrationConnection.create({
    data: { provider: "redmine", baseUrl: "https://redmine.example", workspaceId: workspace.id },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "41",
      readMap: {},
      writeMap: {},
    },
  });
  const issues = await Promise.all([1, 2].map((sequenceNum) => prisma.issue.create({
    data: {
      projectId: project.id,
      key: `${project.key}-${sequenceNum}`,
      sequenceNum,
      title: `Candidate ${sequenceNum}`,
    },
  })));
  return { binding, connection, issues, member };
}

interface RecommendationInput {
  bindingId: string;
  candidateIssueId: string;
  remoteIssueId: string;
  remoteSourceVersion: string;
  state?: "pending" | "accepted" | "rejected";
  decidedById?: string | null;
  acceptedRefId?: string | null;
}

async function insertRecommendation(input: RecommendationInput) {
  const state = input.state ?? "pending";
  const decided = state === "pending" ? null : new Date("2026-08-21T15:00:00.000Z");
  const decisionKind = state === "pending" ? null : state === "accepted" ? "link" : "dismiss";
  const recommendation = await prisma.integrationReconciliationRecommendation.create({
    data: {
      bindingId: input.bindingId,
      candidateIssueId: input.candidateIssueId,
      remoteIssueId: input.remoteIssueId,
      remoteSourceVersion: input.remoteSourceVersion,
      score: 92,
      scoringVersion: "v1",
      factorEvidence: { titleSimilarity: 80, metadataAgreement: 12 },
      localFingerprint: "sha256:local",
      remoteFingerprint: "sha256:remote",
      decisionState: state,
      decisionKind,
      decidedAt: decided,
      decidedById: input.decidedById,
      acceptedRefId: input.acceptedRefId,
    },
  });
  return recommendation.id;
}

describe("integration reconciliation recommendation persistence", () => {
  beforeEach(async () => {
    await clearRecommendations();
    await cleanDatabase();
  });
  afterAll(async () => {
    await clearRecommendations();
    await cleanDatabase();
    await disconnectTestDb();
  });

  it("declares a content-free recommendation model and additive migration", async () => {
    const [schema, sql] = await Promise.all([readFile(schemaPath, "utf8"), readFile(migrationPath, "utf8")]);
    const model = schema.match(/model IntegrationReconciliationRecommendation \{[\s\S]*?\n\}/)?.[0];

    expect(model).toContain("remoteSourceVersion");
    expect(model).toContain("factorEvidence");
    expect(model).not.toMatch(/remote(?:Title|Description)/);
    expect(sql).toContain("IntegrationReconciliationDecisionState");
    expect(sql).toContain("integration_reconciliation_accepted_remote_key");
    expect(sql).toContain("integration_reconciliation_accepted_local_key");
    expect(sql).toContain("integration_reconciliation_binding_state_score_id_idx");
    expect(sql).toContain("integration_reconciliation_binding_remote_score_id_idx");
    expect(sql).toContain("integration_reconciliation_decision_shape");
    expect(sql).toContain("ON DELETE RESTRICT");
    expect(sql).toContain("ON DELETE SET NULL");
    expect(sql).not.toMatch(/\b(?:DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|RENAME)\b/i);
  });

  it("deduplicates exact snapshots and accepts only one remote/local identity pair", async () => {
    const { binding, issues } = await fixture();
    const exact = {
      bindingId: binding.id,
      candidateIssueId: issues[0]!.id,
      remoteIssueId: "100",
      remoteSourceVersion: "sha256:remote-v1",
    };
    await insertRecommendation(exact);
    await expect(insertRecommendation(exact)).rejects.toMatchObject({ code: "P2002" });

    await insertRecommendation({ ...exact, remoteSourceVersion: "sha256:remote-v2", state: "accepted" });
    await expect(insertRecommendation({
      ...exact,
      candidateIssueId: issues[1]!.id,
      remoteSourceVersion: "sha256:remote-v3",
      state: "accepted",
    })).rejects.toMatchObject({ code: "P2002" });
    await expect(insertRecommendation({
      ...exact,
      remoteIssueId: "101",
      remoteSourceVersion: "sha256:remote-v3",
      state: "accepted",
    })).rejects.toMatchObject({ code: "P2002" });
    await expect(insertRecommendation({
      ...exact,
      candidateIssueId: issues[1]!.id,
      remoteSourceVersion: "sha256:remote-v4",
    })).resolves.toEqual(expect.any(String));
  });

  it("retains decisions across actor/ref deletion and protects binding/candidate identity", async () => {
    const { binding, connection, issues, member } = await fixture();
    const ref = await prisma.externalRef.create({
      data: {
        bindingId: binding.id,
        connectionId: connection.id,
        entityType: "issue",
        entityId: issues[0]!.id,
        externalId: "100",
      },
    });
    const id = await insertRecommendation({
      bindingId: binding.id,
      candidateIssueId: issues[0]!.id,
      remoteIssueId: "100",
      remoteSourceVersion: "sha256:remote-v1",
      state: "accepted",
      decidedById: member.id,
      acceptedRefId: ref.id,
    });

    await prisma.member.delete({ where: { id: member.id } });
    await prisma.externalRef.delete({ where: { id: ref.id } });
    await expect(prisma.issue.delete({ where: { id: issues[0]!.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.integrationProjectBinding.delete({ where: { id: binding.id } })).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id } }))
      .resolves.toMatchObject({ decidedById: null, acceptedRefId: null });
  });
});
