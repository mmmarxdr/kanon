import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import {
  cleanDatabase,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import {
  listRedmineReconciliationRecommendations,
  materializeRedmineReconciliationRecommendations,
  type RedmineReconciliationRemoteDetail,
} from "./redmine-reconciliation.js";
const SOURCE = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;
const PREVIEW_ID = "10000000-0000-4000-8000-000000000001";
const createdAt = new Date("2026-08-01T10:00:00.000Z");
const concurrentPrisma = new PrismaClient();
function previewEvidence(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    previewIdentity: PREVIEW_ID,
    mode: "full",
    scopeFingerprint: OTHER_HASH,
    cutoff: "2026-08-04T12:00:00.000Z",
    complete: true,
    nextOffset: 1,
    scannedCount: 1,
    remainingCount: 0,
    excludedPrivateCount: 0,
    linkedCount: 0,
    checkpoint: { updatedAt: createdAt.toISOString(), remoteId: "42", pageToken: null },
    candidates: [{ remoteId: "42", sourceVersion: SOURCE }],
    unmappedStatusIds: [],
    unmappedPriorityIds: [],
    unmappedAssigneeIds: [],
    assigneeRemoteIds: [],
    ...overrides,
  };
}
async function fixture() {
  const workspace = await seedTestWorkspace();
  const owner = await seedTestMemberWithRole(workspace.id, "owner");
  const project = await seedTestProject(workspace.id);
  const connection = await prisma.integrationConnection.create({
    data: { provider: "redmine", baseUrl: "https://redmine.test", workspaceId: workspace.id, lifecycle: "paused" },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "7",
      readMap: {},
      writeMap: {},
      lifecycle: "paused",
      bootstrapState: "previewed",
      bootstrapCutoff: new Date("2026-08-04T12:00:00.000Z"),
      bootstrapPageToken: previewEvidence(),
    },
  });
  const titles = ["Alpha sync issue", "Alpha sync", "sync issue", "unrelated"];
  const issues = await Promise.all(
    titles.map((title, index) =>
      prisma.issue.create({
        data: { projectId: project.id, key: `${project.key}-${index + 1}`, sequenceNum: index + 1, title, description: "shared body", state: "in_progress", assigneeId: owner.id, createdAt },
      }),
    ),
  );
  const request = { connectionId: connection.id, bindingId: binding.id, userId: owner.userId, remoteIssueId: "42" };
  const remote: RedmineReconciliationRemoteDetail = {
    remoteIssueId: "42",
    remoteProjectId: "7",
    sourceVersion: SOURCE,
    previewIdentity: PREVIEW_ID,
    scopeFingerprint: OTHER_HASH,
    visible: true,
    title: "Alpha sync issue",
    description: "shared body",
    createdAt,
    mappedAssigneeId: owner.id,
    mappedState: "in_progress",
  };
  const run = (overrides: Partial<RedmineReconciliationRemoteDetail> = {}) =>
    materializeRedmineReconciliationRecommendations(request, {
      loadRemoteIssue: async () => ({ ...remote, ...overrides }),
    });
  return { workspace, owner, project, connection, binding, issues, request, remote, run };
}
describe("Redmine reconciliation recommendations", () => {
  beforeEach(async () => {
    await prisma.integrationReconciliationRecommendation.deleteMany();
    await cleanDatabase();
  });
  afterAll(async () => Promise.all([disconnectTestDb(), concurrentPrisma.$disconnect()]));
  it("materializes the top three replay-safely while retaining decisions and cleaning obsolete pending rows", async () => {
    const { owner, connection, binding, issues, run } = await fixture();
    await expect(run()).resolves.toMatchObject({ recommendationCount: 3 });
    const initial = await prisma.integrationReconciliationRecommendation.findMany({
      where: { bindingId: binding.id },
      orderBy: [{ score: "desc" }, { id: "desc" }],
    });
    expect(initial).toHaveLength(3);
    expect(initial[0]?.candidateIssueId).toBe(issues[0]?.id);
    expect(initial.map(({ score }) => score)).toEqual([...initial].map(({ score }) => score).sort((a, b) => b - a));
    expect(JSON.stringify(initial.map(({ factorEvidence }) => factorEvidence))).not.toMatch(/Alpha|shared body/);
    const decided = await prisma.integrationReconciliationRecommendation.update({
      where: { id: initial[0]!.id },
      data: { decisionState: "rejected", decisionKind: "owner-review", decidedById: owner.id, decidedAt: createdAt },
    });
    await run();
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { bindingId: binding.id } })).resolves.toBe(3);
    await expect(prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id: decided.id } })).resolves.toMatchObject({ decisionState: "rejected", decisionKind: "owner-review" });
    await prisma.issue.update({ where: { id: decided.candidateIssueId }, data: { title: "Alpha sync issue updated" } });
    await run();
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { id: decided.id } })).resolves.toBe(1);
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { candidateIssueId: decided.candidateIssueId, decisionState: "pending" } })).resolves.toBe(1);
    const obsolete = initial.find(({ decisionState, id }) => decisionState === "pending" && id !== decided.id)!;
    await prisma.externalRef.create({
      data: { connectionId: connection.id, bindingId: binding.id, entityType: "issue", entityId: obsolete.candidateIssueId, externalId: "999" },
    });
    await run();
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { candidateIssueId: obsolete.candidateIssueId, decisionState: "pending" } })).resolves.toBe(0);
    let release!: () => void;
    let locked!: () => void;
    const proceed = new Promise<void>((resolve) => (release = resolve));
    const acquired = new Promise<void>((resolve) => (locked = resolve));
    const holder = concurrentPrisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${binding.id}::uuid FOR UPDATE`);
      locked();
      await proceed;
      await transaction.integrationProjectBinding.update({ where: { id: binding.id }, data: { bootstrapPageToken: previewEvidence({ previewIdentity: "10000000-0000-4000-8000-000000000002" }) } });
    });
    await acquired;
    const stale = run({ title: "changed remote" });
    try {
      await vi.waitFor(async () => {
        const [waiting] = await concurrentPrisma.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`SELECT COUNT(*)::bigint AS "count" FROM pg_stat_activity WHERE datname = current_database() AND wait_event_type = 'Lock'`);
        expect(Number(waiting?.count)).toBeGreaterThan(0);
      });
    } finally {
      release();
      await holder;
    }
    await expect(stale).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_SCOPE_STALE" });
  });
  it("rejects invalid preview, source, project, scope, visibility, listing, and existing links before writes", async () => {
    const context = await fixture();
    for (const evidence of [previewEvidence({ complete: false }), previewEvidence({ mode: "future_only" })]) {
      await prisma.integrationProjectBinding.update({ where: { id: context.binding.id }, data: { bootstrapPageToken: evidence } });
      await expect(context.run()).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_PREVIEW_REQUIRED" });
    }
    await prisma.integrationProjectBinding.update({ where: { id: context.binding.id }, data: { bootstrapPageToken: previewEvidence() } });
    await expect(context.run({ sourceVersion: OTHER_HASH })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_SOURCE_STALE" });
    await expect(context.run({ remoteProjectId: "8" })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_PROJECT_MISMATCH" });
    await expect(context.run({ scopeFingerprint: SOURCE })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_SCOPE_STALE" });
    await expect(context.run({ visible: false })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_NOT_VISIBLE" });
    await expect(materializeRedmineReconciliationRecommendations(
      { ...context.request, remoteIssueId: "43" },
      { loadRemoteIssue: async () => ({ ...context.remote, remoteIssueId: "43" }) },
    )).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_UNLISTED" });
    await prisma.externalRef.create({
      data: { connectionId: context.connection.id, bindingId: context.binding.id, entityType: "issue", entityId: context.issues[0]!.id, externalId: "42" },
    });
    await expect(context.run()).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_ALREADY_LINKED" });
    await expect(prisma.integrationReconciliationRecommendation.count()).resolves.toBe(0);
  });
  it("pages deterministically without leaking another binding", async () => {
    const context = await fixture();
    await context.run();
    const project = await seedTestProject(context.workspace.id);
    const issue = await prisma.issue.create({ data: { projectId: project.id, key: `${project.key}-1`, sequenceNum: 1, title: "leak" } });
    const binding = await prisma.integrationProjectBinding.create({
      data: { connectionId: context.connection.id, projectId: project.id, remoteProjectId: "8", readMap: {}, writeMap: {}, lifecycle: "paused" },
    });
    const sample = await prisma.integrationReconciliationRecommendation.findFirstOrThrow({ where: { bindingId: context.binding.id } });
    const leaked = await prisma.integrationReconciliationRecommendation.create({
      data: { bindingId: binding.id, remoteIssueId: "99", remoteSourceVersion: SOURCE, candidateIssueId: issue.id, score: 999, scoringVersion: sample.scoringVersion, factorEvidence: sample.factorEvidence as Prisma.InputJsonValue, localFingerprint: sample.localFingerprint, remoteFingerprint: sample.remoteFingerprint },
    });
    const scope = { connectionId: context.connection.id, bindingId: context.binding.id, userId: context.owner.userId };
    const first = await listRedmineReconciliationRecommendations(scope, { limit: 2 });
    const second = await listRedmineReconciliationRecommendations(scope, { limit: 2, cursor: first.nextCursor! });
    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(1);
    expect(new Set([...first.items, ...second.items].map(({ id }) => id))).toHaveProperty("size", 3);
    expect([...first.items, ...second.items].map(({ id }) => id)).not.toContain(leaked.id);
  });
});
