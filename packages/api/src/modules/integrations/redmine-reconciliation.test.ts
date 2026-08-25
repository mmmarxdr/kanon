import { createHash } from "node:crypto";
import { Prisma, PrismaClient } from "@prisma/client";
import { redmineReconciliationRecommendationPageSchema } from "@kanon/shared";
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
  decideRedmineReconciliationRecommendations,
  listRedmineReconciliationRecommendations,
  materializeRedmineReconciliationRecommendations,
  reviewRedmineReconciliationPage,
  type RedmineReconciliationRemoteDetail,
} from "./redmine-reconciliation.js";
import { activateRedmineIssueImport } from "./redmine-import.js";
import { rankRedmineReconciliationCandidates } from "./redmine-reconciliation-score.js";
const SOURCE = `sha256:${"a".repeat(64)}`;
const OTHER_HASH = `sha256:${"b".repeat(64)}`;
const PREVIEW_ID = "10000000-0000-4000-8000-000000000001";
const createdAt = new Date("2026-08-01T10:00:00.000Z");
const decidedAt = new Date("2026-08-21T12:00:00.000Z");
const concurrentPrisma = new PrismaClient();
const sha256 = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`;
let currentScopeFingerprint = OTHER_HASH;
function scopeFingerprint(input: { connectionEpoch: number; bindingEpoch: number; remoteProjectId: string; credentialId: string; encryptedKey: string; readMap: Record<string, string> }) {
  return sha256(JSON.stringify({ mode: "full", baseUrl: "https://redmine.test", connectionEpoch: input.connectionEpoch, bindingEpoch: input.bindingEpoch, remoteProjectId: input.remoteProjectId, credentialId: input.credentialId, credentialFingerprint: sha256(input.encryptedKey), readMap: input.readMap, assignees: [] }));
}
function previewEvidence(overrides: Record<string, unknown> = {}) {
  return {
    version: 2,
    previewIdentity: PREVIEW_ID,
    mode: "full",
    scopeFingerprint: currentScopeFingerprint,
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
  const credential = await prisma.memberIntegrationCredential.create({ data: { connectionId: connection.id, memberId: owner.id, encryptedKey: "cipher-one", lastAuthStatus: "valid" } });
  await prisma.integrationConnection.update({ where: { id: connection.id }, data: { serviceCredentialId: credential.id } });
  const readMap = { "priority:3": "high" };
  let binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "7",
      readMap,
      writeMap: {},
      lifecycle: "paused",
      bootstrapState: "previewed",
      bootstrapCutoff: new Date("2026-08-04T12:00:00.000Z"),
      bootstrapPageToken: previewEvidence(),
    },
  });
  currentScopeFingerprint = scopeFingerprint({ connectionEpoch: connection.lifecycleEpoch, bindingEpoch: binding.lifecycleEpoch, remoteProjectId: binding.remoteProjectId, credentialId: credential.id, encryptedKey: credential.encryptedKey, readMap });
  binding = await prisma.integrationProjectBinding.update({ where: { id: binding.id }, data: { bootstrapPageToken: previewEvidence() } });
  await prisma.integrationReconciliationDisposition.create({
    data: { bindingId: binding.id, previewIdentity: PREVIEW_ID, remoteIssueId: "42", remoteSourceVersion: SOURCE },
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
    scopeFingerprint: currentScopeFingerprint,
    visible: true,
    title: "Alpha sync issue",
    description: "shared body",
    createdAt,
    changedAt: new Date("2026-08-04T11:00:00.000Z"),
    completedAt: null,
    mappedAssigneeId: owner.id,
    mappedState: "in_progress",
    mappedPriority: "medium",
    startDate: null,
    dueDate: null,
    progress: 0,
  };
  const run = (overrides: Partial<RedmineReconciliationRemoteDetail> = {}, candidateIssueId?: string) =>
    materializeRedmineReconciliationRecommendations({ ...request, candidateIssueId }, {
      loadRemoteIssue: async () => ({ ...remote, ...overrides }),
    });
  const decide = (decision: Parameters<typeof decideRedmineReconciliationRecommendations>[1], overrides: Partial<RedmineReconciliationRemoteDetail> = {}) =>
    decideRedmineReconciliationRecommendations(request, decision, { loadRemoteIssue: async () => ({ ...remote, ...overrides }), now: () => decidedAt });
  return { workspace, owner, project, connection, credential, binding, issues, request, remote, run, decide };
}
function queueCreate(bindingId: string, issueId: string, state: "queued" | "retry" = "queued", attempts = 0, operation: "create" | "update" = "create") {
  return prisma.integrationSyncWork.create({ data: { bindingId, entityType: "issue", entityId: issueId, direction: "outbound", operation, dedupeKey: `reconcile:${issueId}:${state}:${operation}`, laneKey: `issue:${issueId}`, actorKey: "member:owner", actorKind: "user", payload: {}, correlationId: `reconcile:${issueId}:${state}:${operation}`, state, attempts, epoch: 0 } });
}
describe("Redmine reconciliation recommendations", () => {
  beforeEach(async () => {
    await prisma.integrationReconciliationRecommendation.deleteMany();
    await cleanDatabase();
  });
  afterAll(async () => Promise.all([disconnectTestDb(), concurrentPrisma.$disconnect()]));
  it("materializes the top three replay-safely while retaining decisions and cleaning obsolete pending rows", async () => {
    const { owner, connection, binding, issues, run } = await fixture();
    const hydrated = await run();
    expect(hydrated).toMatchObject({
      remote: { id: "42", title: "Alpha sync issue", sourceVersion: SOURCE },
      manualCandidate: null,
    });
    expect(hydrated.recommendations[0]).toMatchObject({ localIssue: { id: issues[0]!.id, key: issues[0]!.key, title: issues[0]!.title } });
    expect(hydrated.recommendations).toHaveLength(3);
    expect(JSON.stringify(hydrated)).not.toContain("shared body");
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
    const replay = await run();
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { bindingId: binding.id } })).resolves.toBe(3);
    await expect(prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id: decided.id } })).resolves.toMatchObject({ decisionState: "rejected", decisionKind: "owner-review" });
    expect(replay.recommendations.find(({ id }) => id === decided.id)).toMatchObject({ decisionState: "rejected", decisionKind: "owner-review", decidedById: owner.id, decidedAt: createdAt });
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
  it("hydrates an unpersisted manual candidate and rejects foreign or current-connection-linked issues", async () => {
    const context = await fixture();
    const otherConnection = await prisma.integrationConnection.create({ data: { provider: "jira", baseUrl: "https://jira.test", workspaceId: context.workspace.id, lifecycle: "paused" } });
    const otherBinding = await prisma.integrationProjectBinding.create({ data: { connectionId: otherConnection.id, projectId: context.project.id, remoteProjectId: "jira-7", readMap: {}, writeMap: {}, lifecycle: "paused" } });
    await prisma.externalRef.create({ data: { connectionId: otherConnection.id, bindingId: otherBinding.id, entityType: "issue", entityId: context.issues[3]!.id, externalId: "jira-999" } });
    const hydrated = await context.run({}, context.issues[3]!.id);
    expect(hydrated.manualCandidate).toMatchObject({ localIssue: { id: context.issues[3]!.id, key: context.issues[3]!.key, title: "unrelated" }, factorEvidence: { localFingerprint: expect.stringMatching(/^sha256:/), remoteFingerprint: expect.stringMatching(/^sha256:/) } });
    expect(hydrated.recommendations).toHaveLength(3);
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { bindingId: context.binding.id } })).resolves.toBe(3);
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { bindingId: context.binding.id, candidateIssueId: context.issues[3]!.id } })).resolves.toBe(0);

    const foreignProject = await seedTestProject(context.workspace.id);
    const foreign = await prisma.issue.create({ data: { projectId: foreignProject.id, key: `${foreignProject.key}-1`, sequenceNum: 1, title: "Foreign" } });
    await expect(context.run({}, foreign.id)).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_CANDIDATE_INVALID" });
    await prisma.externalRef.create({ data: { connectionId: context.connection.id, bindingId: context.binding.id, entityType: "issue", entityId: context.issues[3]!.id, externalId: "999" } });
    await expect(context.run({}, context.issues[3]!.id)).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_CANDIDATE_LINKED" });
  });
  it("reviews persisted preview candidates in stable bounded pages", async () => {
    const context = await fixture();
    const candidates = Array.from({ length: 7 }, (_, index) => ({ remoteId: `${42 + index}`, sourceVersion: SOURCE }));
    await prisma.integrationProjectBinding.update({ where: { id: context.binding.id }, data: { bootstrapPageToken: previewEvidence({ candidates }) } });
    const calls: string[] = [];
    const loadRemoteIssue = async (remoteIssueId: string) => { calls.push(remoteIssueId); return { ...context.remote, remoteIssueId, title: `Remote ${remoteIssueId}` }; };
    const request = { connectionId: context.connection.id, bindingId: context.binding.id, userId: context.owner.userId };
    const first = await reviewRedmineReconciliationPage(request, { loadRemoteIssue, limit: 5 });
    expect(first).toMatchObject({ previewIdentity: PREVIEW_ID, processedCandidateCount: 5, remainingCandidateCount: 2, hiddenCount: 0, linkedCount: 0 });
    expect(first.items.map(({ remote }) => remote.id)).toEqual(["42", "43", "44", "45", "46"]);
    expect(calls).toEqual(["42", "43", "44", "45", "46"]);
    const second = await reviewRedmineReconciliationPage(request, { loadRemoteIssue, cursor: first.nextCursor!, limit: 5 });
    expect(second.items.map(({ remote }) => remote.id)).toEqual(["47", "48"]);
    expect(second).toMatchObject({ processedCandidateCount: 2, remainingCandidateCount: 0, nextCursor: null });
    expect(calls.slice(5)).toEqual(["47", "48"]);
  });
  it("rejects stale or out-of-range review cursors before loading providers", async () => {
    const context = await fixture();
    const request = { connectionId: context.connection.id, bindingId: context.binding.id, userId: context.owner.userId };
    const loadRemoteIssue = vi.fn(async () => context.remote);
    const cursor = (previewIdentity: string, offset: number) => Buffer.from(JSON.stringify({ previewIdentity, offset })).toString("base64url");
    await expect(reviewRedmineReconciliationPage(request, { loadRemoteIssue, cursor: "" })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_CURSOR_INVALID" });
    await expect(reviewRedmineReconciliationPage(request, { loadRemoteIssue, cursor: cursor("20000000-0000-4000-8000-000000000002", 0) })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_CURSOR_STALE" });
    await expect(reviewRedmineReconciliationPage(request, { loadRemoteIssue, cursor: cursor(PREVIEW_ID, 1) })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_CURSOR_INVALID" });
    await prisma.integrationProjectBinding.update({ where: { id: context.binding.id }, data: { bootstrapPageToken: previewEvidence({ mode: "future_only" }) } });
    await expect(reviewRedmineReconciliationPage(request, { loadRemoteIssue })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_PREVIEW_REQUIRED" });
    expect(loadRemoteIssue).not.toHaveBeenCalled();
  });
  it("consumes hidden and linked slots without disclosure or unnecessary provider calls", async () => {
    const context = await fixture();
    const candidates = Array.from({ length: 6 }, (_, index) => ({ remoteId: `${42 + index}`, sourceVersion: SOURCE }));
    await prisma.integrationProjectBinding.update({ where: { id: context.binding.id }, data: { bootstrapPageToken: previewEvidence({ candidates }) } });
    await prisma.externalRef.create({ data: { connectionId: context.connection.id, bindingId: context.binding.id, entityType: "issue", entityId: context.issues[0]!.id, externalId: "43" } });
    const loadRemoteIssue = vi.fn(async (remoteIssueId: string) => ({ ...context.remote, remoteIssueId, sourceVersion: remoteIssueId === "44" ? OTHER_HASH : SOURCE, visible: remoteIssueId !== "44", title: remoteIssueId === "44" ? "Private secret" : `Remote ${remoteIssueId}` }));
    const page = await reviewRedmineReconciliationPage({ connectionId: context.connection.id, bindingId: context.binding.id, userId: context.owner.userId }, { loadRemoteIssue });
    expect(page).toMatchObject({ processedCandidateCount: 5, remainingCandidateCount: 1, hiddenCount: 1, linkedCount: 1, nextCursor: expect.any(String) });
    expect(page.items.map(({ remote }) => remote.id)).toEqual(["42", "45", "46"]);
    expect(loadRemoteIssue.mock.calls.map(([id]) => id)).toEqual(["42", "44", "45", "46"]);
    expect(JSON.stringify(page)).not.toContain("Private secret");
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { bindingId: context.binding.id, remoteIssueId: "44" } })).resolves.toBe(0);
  });
  it("durably skips hidden and already-linked candidates before activation", async () => {
    const context = await fixture();
    const candidates = ["42", "43"].map((remoteId) => ({ remoteId, sourceVersion: SOURCE }));
    await prisma.integrationProjectBinding.update({ where: { id: context.binding.id }, data: { bootstrapPageToken: previewEvidence({ candidates }) } });
    await prisma.integrationReconciliationDisposition.create({ data: { bindingId: context.binding.id, previewIdentity: PREVIEW_ID, remoteIssueId: "43", remoteSourceVersion: SOURCE } });
    await prisma.externalRef.create({ data: { connectionId: context.connection.id, bindingId: context.binding.id, entityType: "issue", entityId: context.issues[0]!.id, externalId: "43" } });
    const loadRemoteIssue = vi.fn(async (remoteIssueId: string) => ({ ...context.remote, remoteIssueId, visible: false, title: null }));

    await expect(reviewRedmineReconciliationPage({ connectionId: context.connection.id, bindingId: context.binding.id, userId: context.owner.userId }, { loadRemoteIssue })).resolves.toMatchObject({ processedCandidateCount: 2, remainingCandidateCount: 0, hiddenCount: 1, linkedCount: 1 });
    await expect(prisma.integrationReconciliationDisposition.findMany({ where: { bindingId: context.binding.id }, orderBy: { remoteIssueId: "asc" }, select: { remoteIssueId: true, state: true, decisionKind: true } })).resolves.toEqual([
      { remoteIssueId: "42", state: "skipped", decisionKind: "system-not-visible" },
      { remoteIssueId: "43", state: "skipped", decisionKind: "system-already-linked" },
    ]);
    const get = vi.fn(async () => { throw new Error("activation must not read skipped candidates"); });
    await expect(activateRedmineIssueImport(context.connection.id, context.binding.id, context.owner.userId, { now: () => decidedAt, decrypt: () => "key", client: () => ({ get }) })).resolves.toMatchObject({ importedCount: 0, complete: true, remainingCount: 0 });
    expect(get).not.toHaveBeenCalled();
  });
  it("keeps earlier writes and decisions replay-safe after a partial review-page failure", async () => {
    const context = await fixture();
    const candidates = ["42", "43", "44"].map((remoteId) => ({ remoteId, sourceVersion: SOURCE }));
    await prisma.integrationProjectBinding.update({ where: { id: context.binding.id }, data: { bootstrapPageToken: previewEvidence({ candidates }) } });
    let fail = true;
    const loadRemoteIssue = async (remoteIssueId: string) => { if (remoteIssueId === "43" && fail) throw new Error("provider failed"); return { ...context.remote, remoteIssueId }; };
    const request = { connectionId: context.connection.id, bindingId: context.binding.id, userId: context.owner.userId };
    await expect(reviewRedmineReconciliationPage(request, { loadRemoteIssue })).rejects.toThrow("provider failed");
    const decided = await prisma.integrationReconciliationRecommendation.findFirstOrThrow({ where: { bindingId: context.binding.id, remoteIssueId: "42" } });
    await prisma.integrationReconciliationRecommendation.update({ where: { id: decided.id }, data: { decisionState: "rejected", decisionKind: "owner-reject", decidedById: context.owner.id, decidedAt } });
    fail = false;
    await expect(reviewRedmineReconciliationPage(request, { loadRemoteIssue })).resolves.toMatchObject({ processedCandidateCount: 3, remainingCandidateCount: 0 });
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { bindingId: context.binding.id } })).resolves.toBe(9);
    await expect(prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id: decided.id } })).resolves.toMatchObject({ decisionState: "rejected", decisionKind: "owner-reject", decidedById: context.owner.id });
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
  it("rejects credential drift under the decision locks before link mutation", async () => {
    const context = await fixture();
    const materialized = await context.run();
    await prisma.memberIntegrationCredential.update({ where: { id: context.credential.id }, data: { encryptedKey: "cipher-two" } });

    await expect(context.decide({ kind: "accept", recommendationId: materialized.recommendations[0]!.id })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_SCOPE_STALE" });
    await expect(prisma.externalRef.count({ where: { connectionId: context.connection.id } })).resolves.toBe(0);
    await expect(prisma.integrationInboundApplication.count({ where: { bindingId: context.binding.id } })).resolves.toBe(0);
    await expect(prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id: materialized.recommendations[0]!.id } })).resolves.toMatchObject({ decisionState: "pending", acceptedRefId: null });
    await expect(prisma.integrationReconciliationDisposition.findFirstOrThrow({ where: { bindingId: context.binding.id, remoteIssueId: "42" } })).resolves.toMatchObject({ state: "pending", acceptedRefId: null });
  });
  it("loads the provider before locking and rejects scope drift before link mutation", async () => {
    const context = await fixture();
    const materialized = await context.run();
    const changedReadMap = { "priority:3": "urgent" };
    const loadRemoteIssue = vi.fn(async () => {
      await concurrentPrisma.$transaction(async (transaction) => {
        await transaction.$executeRawUnsafe("SET LOCAL lock_timeout = '250ms'");
        await transaction.integrationProjectBinding.update({ where: { id: context.binding.id }, data: { readMap: changedReadMap } });
      });
      return context.remote;
    });

    await expect(decideRedmineReconciliationRecommendations(context.request, { kind: "accept", recommendationId: materialized.recommendations[0]!.id }, { loadRemoteIssue, now: () => decidedAt })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_SCOPE_STALE" });
    expect(loadRemoteIssue).toHaveBeenCalledOnce();
    await expect(prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: context.binding.id } })).resolves.toMatchObject({ readMap: changedReadMap });
    await expect(prisma.externalRef.count({ where: { connectionId: context.connection.id } })).resolves.toBe(0);
    await expect(prisma.integrationInboundApplication.count({ where: { bindingId: context.binding.id } })).resolves.toBe(0);
    await expect(prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id: materialized.recommendations[0]!.id } })).resolves.toMatchObject({ decisionState: "pending", acceptedRefId: null });
    await expect(prisma.integrationReconciliationDisposition.findFirstOrThrow({ where: { bindingId: context.binding.id, remoteIssueId: "42" } })).resolves.toMatchObject({ state: "pending", acceptedRefId: null });
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
  it("returns a non-empty strict public recommendation page without preview identity", async () => {
    const context = await fixture();
    await context.run();
    const page = await listRedmineReconciliationRecommendations(context.request);
    expect(page.items).toHaveLength(3);
    expect(page.items[0]).not.toHaveProperty("previewIdentity");
    expect(() => redmineReconciliationRecommendationPageSchema.parse({
      ...page,
      items: page.items.map((item) => ({ ...item, decidedAt: item.decidedAt?.toISOString() ?? null, createdAt: item.createdAt.toISOString(), updatedAt: item.updatedAt.toISOString() })),
    })).not.toThrow();
  });
  it("audits reject and reject-all idempotently without rewriting prior decisions", async () => {
    const context = await fixture();
    await context.run();
    const recommendations = await prisma.integrationReconciliationRecommendation.findMany({ where: { bindingId: context.binding.id }, orderBy: { score: "desc" } });
    const decision = { kind: "reject", recommendationId: recommendations[0]!.id } as const;
    await context.decide(decision);
    const rejected = await prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id: recommendations[0]!.id } });
    await expect(context.decide(decision)).resolves.toMatchObject({ replayed: true });
    expect(await prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id: rejected.id } })).toMatchObject({ decisionState: "rejected", decisionKind: "owner-reject", decidedById: context.owner.id, decidedAt, updatedAt: rejected.updatedAt });
    await expect(context.decide({ kind: "reject-all" })).resolves.toMatchObject({ rejectedCount: 2 });
    const all = await prisma.integrationReconciliationRecommendation.findMany({ where: { bindingId: context.binding.id } });
    expect(all).toHaveLength(3);
    expect(all.every(({ decisionState, decidedById, decidedAt: at }) => decisionState === "rejected" && decidedById === context.owner.id && at?.getTime() === decidedAt.getTime())).toBe(true);
  });
  it("settles an unmaterialized remote through reject-all without retaining provider content", async () => {
    const context = await fixture();
    await expect(context.decide({ kind: "reject-all" })).resolves.toMatchObject({ rejectedCount: 0 });
    await expect(prisma.integrationReconciliationDisposition.findFirstOrThrow({ where: { bindingId: context.binding.id, previewIdentity: PREVIEW_ID, remoteIssueId: "42" } })).resolves.toMatchObject({ state: "import_as_new", decisionKind: "owner-reject-all", decidedById: context.owner.id, decidedAt });
  });
  it("preserves terminal disposition audit metadata and rejects conflicting terminal commands", async () => {
    const context = await fixture();
    await context.decide({ kind: "reject-all" });
    const settled = await prisma.integrationReconciliationDisposition.findFirstOrThrow({ where: { bindingId: context.binding.id, previewIdentity: PREVIEW_ID, remoteIssueId: "42" } });
    await expect(context.decide({ kind: "reject-all" })).resolves.toMatchObject({ replayed: true });
    await expect(prisma.integrationReconciliationDisposition.findUniqueOrThrow({ where: { id: settled.id } })).resolves.toMatchObject({ state: "import_as_new", decisionKind: settled.decisionKind, decidedById: settled.decidedById, decidedAt: settled.decidedAt });
    const manual = rankRedmineReconciliationCandidates({ id: "42", projectId: context.project.id, title: context.remote.title, description: context.remote.description, createdAt: context.remote.createdAt, mappedAssigneeId: context.remote.mappedAssigneeId, mappedState: context.remote.mappedState }, [context.issues[0]!])[0]!;
    await expect(context.decide({ kind: "manual-link", candidateIssueId: context.issues[0]!.id, localFingerprint: manual.evidence.localFingerprint, remoteFingerprint: manual.evidence.remoteFingerprint })).rejects.toMatchObject({ statusCode: 409 });
  });
  it("accepts a suggestion atomically with baseline, replay guard, and alternative audits", async () => {
    const context = await fixture();
    await context.run();
    const recommendations = await prisma.integrationReconciliationRecommendation.findMany({ where: { bindingId: context.binding.id }, orderBy: { score: "desc" } });
    const selected = recommendations[0]!;
    const before = await prisma.issue.findUniqueOrThrow({ where: { id: selected.candidateIssueId } });
    await expect(context.decide({ kind: "accept", recommendationId: selected.id })).resolves.toMatchObject({ replayed: false, candidateIssueId: selected.candidateIssueId });
    expect(await prisma.issue.findUniqueOrThrow({ where: { id: selected.candidateIssueId } })).toEqual(before);
    const ref = await prisma.externalRef.findUniqueOrThrow({ where: { connectionId_entityType_entityId: { connectionId: context.connection.id, entityType: "issue", entityId: selected.candidateIssueId } } });
    expect(ref.metadata).toMatchObject({ remoteVersion: SOURCE, baseline: { version: 1, sourceVersion: SOURCE, fields: { title: context.remote.title, description: context.remote.description, state: "in_progress", priority: "medium", assigneeId: context.owner.id, startDate: null, dueDate: null, progress: 0 } } });
    await expect(prisma.integrationInboundApplication.findFirstOrThrow({ where: { refId: ref.id } })).resolves.toMatchObject({ state: "applied", sourceVersion: SOURCE, remoteId: "42", outcome: { provenance: "reconciliation-link" } });
    expect(await prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id: selected.id } })).toMatchObject({ decisionState: "accepted", decisionKind: "owner-accept-suggested", decidedById: context.owner.id, acceptedRefId: ref.id });
    const alternatives = await prisma.integrationReconciliationRecommendation.findMany({ where: { bindingId: context.binding.id, id: { not: selected.id } } });
    expect(alternatives.every(({ decisionState, decisionKind, decidedById }) => decisionState === "rejected" && decisionKind === "owner-link-alternative" && decidedById === context.owner.id)).toBe(true);
    await expect(context.decide({ kind: "accept", recommendationId: selected.id })).resolves.toMatchObject({ replayed: true, refId: ref.id });
    const other = alternatives[0]!;
    await expect(context.decide({ kind: "manual-link", candidateIssueId: other.candidateIssueId, localFingerprint: other.localFingerprint, remoteFingerprint: other.remoteFingerprint })).rejects.toMatchObject({ statusCode: 409, code: "REDMINE_RECONCILIATION_LINK_CONFLICT" });
  });
  it("manual-links outside the top three, scopes links by connection, and cancels only safe creates", async () => {
    const context = await fixture();
    const otherConnection = await prisma.integrationConnection.create({ data: { provider: "jira", baseUrl: "https://jira.test", workspaceId: context.workspace.id, lifecycle: "paused" } });
    const otherBinding = await prisma.integrationProjectBinding.create({ data: { connectionId: otherConnection.id, projectId: context.project.id, remoteProjectId: "jira-7", readMap: {}, writeMap: {}, lifecycle: "paused" } });
    await prisma.externalRef.createMany({ data: [context.issues[0]!, context.issues[3]!].map((issue, index) => ({ connectionId: otherConnection.id, bindingId: otherBinding.id, entityType: "issue", entityId: issue.id, externalId: `${100 + index}` })) });
    await context.run();
    const redmineCandidates = await prisma.integrationReconciliationRecommendation.findMany({ where: { bindingId: context.binding.id } });
    expect(redmineCandidates.map(({ candidateIssueId }) => candidateIssueId)).toContain(context.issues[0]!.id);
    expect(redmineCandidates.map(({ candidateIssueId }) => candidateIssueId)).not.toContain(context.issues[3]!.id);
    const manual = rankRedmineReconciliationCandidates({ id: "42", projectId: context.project.id, title: context.remote.title, description: context.remote.description, createdAt: context.remote.createdAt, mappedAssigneeId: context.remote.mappedAssigneeId, mappedState: context.remote.mappedState }, [context.issues[3]!])[0]!;
    const work = await queueCreate(context.binding.id, context.issues[3]!.id, "queued", 0, "update");
    const before = await prisma.issue.findUniqueOrThrow({ where: { id: context.issues[3]!.id } });
    const linked = await context.decide({ kind: "manual-link", candidateIssueId: context.issues[3]!.id, localFingerprint: manual.evidence.localFingerprint, remoteFingerprint: manual.evidence.remoteFingerprint });
    expect(await prisma.issue.findUniqueOrThrow({ where: { id: context.issues[3]!.id } })).toEqual(before);
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({ state: "superseded", skippedReason: "reconciliation-linked" });
    await expect(prisma.integrationReconciliationRecommendation.findFirstOrThrow({ where: { bindingId: context.binding.id, candidateIssueId: context.issues[3]!.id } })).resolves.toMatchObject({ decisionState: "accepted", decisionKind: "owner-manual-link", acceptedRefId: linked.refId });
    await expect(prisma.externalRef.count({ where: { entityType: "issue", entityId: context.issues[3]!.id } })).resolves.toBe(2);
  });
  it("rejects source or local drift and uncertain outbound creates without partial decisions", async () => {
    const context = await fixture();
    await context.run();
    const selected = await prisma.integrationReconciliationRecommendation.findFirstOrThrow({ where: { bindingId: context.binding.id }, orderBy: { score: "desc" } });
    await expect(context.decide({ kind: "accept", recommendationId: selected.id }, { sourceVersion: OTHER_HASH })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_SOURCE_STALE" });
    await prisma.issue.update({ where: { id: selected.candidateIssueId }, data: { title: "local drift" } });
    await expect(context.decide({ kind: "accept", recommendationId: selected.id })).rejects.toMatchObject({ code: "REDMINE_RECONCILIATION_LOCAL_STALE" });
    const uncertain = await fixture();
    await uncertain.run();
    const candidate = await prisma.integrationReconciliationRecommendation.findFirstOrThrow({ where: { bindingId: uncertain.binding.id }, orderBy: { score: "desc" } });
    const work = await queueCreate(uncertain.binding.id, candidate.candidateIssueId, "retry", 1, "update");
    await expect(uncertain.decide({ kind: "accept", recommendationId: candidate.id })).rejects.toMatchObject({ statusCode: 409, code: "REDMINE_RECONCILIATION_OUTBOUND_CREATE_UNCERTAIN" });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).resolves.toMatchObject({ state: "retry", attempts: 1 });
    await expect(prisma.externalRef.count({ where: { connectionId: uncertain.connection.id } })).resolves.toBe(0);
    await expect(prisma.integrationReconciliationRecommendation.findUniqueOrThrow({ where: { id: candidate.id } })).resolves.toMatchObject({ decisionState: "pending" });
  });
  it("serializes competing local pairings into one success and one deterministic conflict", async () => {
    const context = await fixture();
    await context.run();
    const recommendations = await prisma.integrationReconciliationRecommendation.findMany({ where: { bindingId: context.binding.id }, orderBy: { score: "desc" }, take: 2 });
    const results = await Promise.allSettled(recommendations.map(({ id }) => context.decide({ kind: "accept", recommendationId: id })));
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    const rejected = results.find(({ status }) => status === "rejected") as PromiseRejectedResult;
    expect(rejected.reason).toMatchObject({ statusCode: 409, code: "REDMINE_RECONCILIATION_LINK_CONFLICT" });
    await expect(prisma.externalRef.count({ where: { connectionId: context.connection.id, externalId: "42" } })).resolves.toBe(1);
    await expect(prisma.integrationReconciliationRecommendation.count({ where: { bindingId: context.binding.id, decisionState: "accepted" } })).resolves.toBe(1);
  });
});
