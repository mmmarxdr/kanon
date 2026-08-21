import { createHash, randomUUID } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  generateTestToken,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { prisma } from "../../config/prisma.js";
import { retryRedmineIssueImport } from "./inbound.js";
import { decrypt } from "./core/crypto.js";
import { decodeRedmineIssueDetail } from "./providers/redmine/decoder.js";
import { RedmineHttpClient } from "./providers/redmine/http-client.js";
import { activateRedmineIssueImport, previewRedmineIssueImport } from "./redmine-import.js";
import {
  decideRedmineReconciliationRecommendations,
  materializeRedmineReconciliationRecommendations,
} from "./redmine-reconciliation.js";
import { auditHealthForScope, getBindingAuditHealth } from "./service.js";
import { createAuditScopeFingerprint } from "./core/audit-evidence.js";

vi.mock("./inbound.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./inbound.js")>()),
  retryRedmineIssueImport: vi.fn(),
}));
vi.mock("./core/crypto.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./core/crypto.js")>()),
  decrypt: vi.fn(() => "api-key"),
}));
vi.mock("./redmine-import.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redmine-import.js")>()),
  activateRedmineIssueImport: vi.fn(),
  previewRedmineIssueImport: vi.fn(),
}));
vi.mock("./redmine-reconciliation.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./redmine-reconciliation.js")>()),
  decideRedmineReconciliationRecommendations: vi.fn(),
  materializeRedmineReconciliationRecommendations: vi.fn(),
}));

const retry = vi.mocked(retryRedmineIssueImport);
const activate = vi.mocked(activateRedmineIssueImport);
const preview = vi.mocked(previewRedmineIssueImport);
const decide = vi.mocked(decideRedmineReconciliationRecommendations);
const materialize = vi.mocked(materializeRedmineReconciliationRecommendations);
const decryptCredential = vi.mocked(decrypt);
const remoteGet = vi.spyOn(RedmineHttpClient.prototype, "get");
const hash = `sha256:${"a".repeat(64)}`;
const remotePayload = { issue: { id: 7, project: { id: 42, name: "Project" }, tracker: { id: 1, name: "Task" }, status: { id: 1, name: "New" }, priority: { id: 2, name: "High" }, author: { id: 3, name: "Owner", login: "owner" }, assigned_to: null, subject: "Match", description: "Body", start_date: null, due_date: null, done_ratio: 0, is_private: false, created_on: "2026-08-20T10:00:00Z", updated_on: "2026-08-21T10:00:00Z", closed_on: null, journals: [] } };
const sourceVersion = decodeRedmineIssueDetail(remotePayload, "42", "7").issue.sourceVersion;
async function reconciliationFixture() {
  const workspace = await seedTestWorkspace();
  const owner = await seedTestMemberWithRole(workspace.id, "owner");
  const project = await seedTestProject(workspace.id);
  const connection = await prisma.integrationConnection.create({
    data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test" },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "42",
      readMap: { "1": "todo", "priority:2": "high" },
      writeMap: {},
      bootstrapState: "previewed",
      bootstrapCutoff: new Date("2026-08-21T12:00:00Z"),
      bootstrapPageToken: {
        version: 2,
        complete: true,
        mode: "full",
        previewIdentity: randomUUID(),
        scopeFingerprint: hash,
        candidates: [{ remoteId: "7", sourceVersion }],
      },
    },
  });
  const credential = await prisma.memberIntegrationCredential.create({ data: { connectionId: connection.id, memberId: owner.id, encryptedKey: "cipher", lastAuthStatus: "valid" } });
  await prisma.integrationConnection.update({ where: { id: connection.id }, data: { serviceCredentialId: credential.id } });
  return {
    workspace,
    owner,
    project,
    connection,
    binding,
    previewIdentity: (binding.bootstrapPageToken as { previewIdentity: string }).previewIdentity,
    base: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/bindings/${binding.id}`,
  };
}

describe("integration retry route", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    retry.mockReset();
    await cleanDatabase();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  it("requires authentication and validates the application identifier", async () => {
    const connectionId = randomUUID();
    const bindingId = randomUUID();
    const applicationId = randomUUID();
    const workspaceId = randomUUID();
    const path = `/api/integrations/workspaces/${workspaceId}/connections/${connectionId}/bindings/${bindingId}/inbound/applications/${applicationId}/retry`;

    const unauthenticated = await app.inject({ method: "POST", url: path });
    expect(unauthenticated.statusCode).toBe(401);
    expect(retry).not.toHaveBeenCalled();

    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const invalid = await app.inject({
      method: "POST",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connectionId}/bindings/${bindingId}/inbound/applications/not-a-uuid/retry`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    expect(invalid.statusCode).toBe(400);
    expect(retry).not.toHaveBeenCalled();
  });

  it("wires identifiers, user scope, and the successful response", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test" },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: project.id,
        remoteProjectId: "remote-project",
        readMap: {},
        writeMap: {},
      },
    });
    const applicationId = randomUUID();
    const allowedProjectId = randomUUID();
    const token = generateTestToken({
      userId: owner.userId,
      allowedProjectIds: [allowedProjectId],
    });
    const result = { applicationId, state: "applied" as const, issueKey: "KAN-1" };
    retry.mockResolvedValue(result);

    const response = await app.inject({
      method: "POST",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/bindings/${binding.id}/inbound/applications/${applicationId}/retry`,
      headers: { authorization: `Bearer ${token}` },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual(result);
    expect(retry).toHaveBeenCalledWith(connection.id, binding.id, applicationId, owner.userId, {
      workspaceId: workspace.id,
      allowedProjectIds: [allowedProjectId],
    });
  });

  it("prevents a scoped owner from controlling the workspace or another project binding", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const [allowed, denied] = await Promise.all([
      seedTestProject(workspace.id),
      seedTestProject(workspace.id),
    ]);
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test" },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: denied.id,
        remoteProjectId: "remote-project",
        readMap: {},
        writeMap: {},
      },
    });
    const allowedBinding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: allowed.id,
        remoteProjectId: "allowed-remote-project",
        readMap: {},
        writeMap: {},
      },
    });
    const token = generateTestToken({
      userId: owner.userId,
      email: owner.email,
      allowedProjectIds: [allowed.id],
    });
    const headers = { authorization: `Bearer ${token}` };

    const create = await app.inject({
      method: "POST",
      url: `/api/integrations/workspaces/${workspace.id}/connections`,
      headers,
      payload: { apiKey: "secret" },
    });
    const mapping = await app.inject({
      method: "PUT",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/mapping`,
      headers,
      payload: {
        projectId: allowed.id,
        remoteProjectId: "remote-project",
        timeActivityId: "9",
        readMap: {},
        writeMap: {},
      },
    });
    const credential = await app.inject({
      method: "POST",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/credential`,
      headers,
      payload: { apiKey: "secret" },
    });
    const unbind = await app.inject({
      method: "DELETE",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/bindings/${binding.id}`,
      headers,
    });
    const allowedUnbind = await app.inject({
      method: "DELETE",
      url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/bindings/${allowedBinding.id}`,
      headers,
    });

    expect(create.statusCode).toBe(403);
    expect(mapping.statusCode).toBe(403);
    expect(credential.statusCode).toBe(403);
    expect(unbind.statusCode).toBe(404);
    expect(allowedUnbind.statusCode).toBe(200);
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: binding.id } }),
    ).resolves.toMatchObject({ releasedAt: null });
    await expect(
      prisma.integrationProjectBinding.findUniqueOrThrow({ where: { id: allowedBinding.id } }),
    ).resolves.toMatchObject({ releasedAt: expect.any(Date) });
  });

  it("lets only the workspace owner change binding comment rollout", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test" },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: {
        connectionId: connection.id,
        projectId: project.id,
        remoteProjectId: "remote-project",
        readMap: {},
        writeMap: {},
      },
    });
    const url = `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/bindings/${binding.id}/comment-rollout`;

    const denied = await app.inject({
      method: "PATCH",
      url,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { commentCaptureEnabled: true, commentDispatchEnabled: false },
    });
    const invalid = await app.inject({
      method: "PATCH",
      url,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { commentCaptureEnabled: false, commentDispatchEnabled: true },
    });
    const inactive = await app.inject({
      method: "PATCH",
      url,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { commentCaptureEnabled: true, commentDispatchEnabled: true },
    });
    await Promise.all([
      prisma.integrationConnection.update({
        where: { id: connection.id },
        data: { lifecycle: "active" },
      }),
      prisma.integrationProjectBinding.update({
        where: { id: binding.id },
        data: { lifecycle: "active" },
      }),
    ]);
    const enabled = await app.inject({
      method: "PATCH",
      url,
      headers: { authorization: `Bearer ${owner.token}` },
      payload: { commentCaptureEnabled: true, commentDispatchEnabled: true },
    });

    expect(denied.statusCode).toBe(403);
    expect(invalid.statusCode).toBe(400);
    expect(inactive.statusCode).toBe(409);
    expect(enabled.statusCode).toBe(200);
    expect(enabled.json()).toMatchObject({
      id: binding.id,
      commentCaptureEnabled: true,
      commentDispatchEnabled: true,
    });
  });
});

describe("Redmine reconciliation routes", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => {
    [activate, preview, decide, materialize].forEach((mock) => mock.mockReset());
    decryptCredential.mockReset().mockReturnValue("api-key");
    remoteGet.mockReset();
    await cleanDatabase();
  });
  afterAll(async () => { await app.close(); });
  it("forwards explicit preview mode, keeps legacy omission, and returns activation progress", async () => {
    const scope = await reconciliationFixture();
    const headers = { authorization: `Bearer ${scope.owner.token}` };
    const progress = {
      previewIdentity: randomUUID(), mode: "full" as const, cutoff: "2026-08-21T12:00:00.000Z",
      checkpoint: null, complete: true, scannedCount: 1, remainingCount: 0,
      eligibleUnlinkedCount: 1, excludedPrivateCount: 0, linkedCount: 0,
      mappingGaps: { statusIds: [], priorityIds: [], assigneeRemoteUserIds: [] },
    };
    preview.mockResolvedValue(progress as never);
    activate.mockResolvedValue({ importedCount: 0, issueKeys: [], replayed: false, complete: true, processedCount: 0, remainingCount: 0 });

    expect((await app.inject({ method: "POST", url: `${scope.base}/inbound/preview`, headers, payload: { mode: "full" } })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${scope.base}/inbound/preview`, headers })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `${scope.base}/inbound/preview`, headers, payload: { mode: "all" } })).statusCode).toBe(400);
    const applied = await app.inject({ method: "POST", url: `${scope.base}/inbound/activate`, headers });

    expect(preview.mock.calls.map((call) => call[4])).toEqual(["full", undefined]);
    expect(applied.json()).toMatchObject({ complete: true, remainingCount: 0 });
  });

  it("forwards owner materialization and audited decisions without exposing remote content", async () => {
    const scope = await reconciliationFixture();
    const headers = { authorization: `Bearer ${scope.owner.token}` };
    remoteGet.mockResolvedValue(remotePayload);
    materialize.mockImplementation(async (request, dependencies) => {
      const detail = await dependencies.loadRemoteIssue(request.remoteIssueId);
      expect(detail).toMatchObject({ remoteIssueId: "7", sourceVersion, previewIdentity: scope.previewIdentity, scopeFingerprint: hash, mappedState: "todo", mappedPriority: "high", mappedAssigneeId: null });
      return { remoteIssueId: "7", recommendationCount: 3 };
    });
    decide.mockResolvedValue({ remoteIssueId: "7", rejectedCount: 1, replayed: false });

    const made = await app.inject({ method: "POST", url: `${scope.base}/reconciliation/recommendations/materialize`, headers, payload: { remoteIssueId: "7" } });
    const decided = await app.inject({ method: "POST", url: `${scope.base}/reconciliation/issues/7/decision`, headers, payload: { kind: "reject-all" } });

    expect(made.json()).toEqual({ remoteIssueId: "7", recommendationCount: 3 });
    expect(decided.json()).toEqual({ remoteIssueId: "7", rejectedCount: 1, replayed: false });
    expect(remoteGet).toHaveBeenCalledWith("/issues/7.json?include=journals");
    expect(materialize).toHaveBeenCalledWith(
      { connectionId: scope.connection.id, bindingId: scope.binding.id, userId: scope.owner.userId, remoteIssueId: "7" },
      expect.objectContaining({ workspaceId: scope.workspace.id, allowedProjectIds: null, loadRemoteIssue: expect.any(Function) }),
    );
    expect(decide).toHaveBeenCalledWith(expect.objectContaining({ remoteIssueId: "7" }), { kind: "reject-all" }, expect.objectContaining({ workspaceId: scope.workspace.id, allowedProjectIds: null }));
    expect(JSON.stringify([made.json(), decided.json()])).not.toContain("title");
  });

  it("denies members before materialization and rejects malformed manual links", async () => {
    const scope = await reconciliationFixture();
    const member = await seedTestMemberWithRole(scope.workspace.id, "member");
    const url = `${scope.base}/reconciliation/recommendations/materialize`;
    expect((await app.inject({ method: "POST", url, headers: { authorization: `Bearer ${member.token}` }, payload: { remoteIssueId: "7" } })).statusCode).toBe(403);
    expect(materialize).not.toHaveBeenCalled();
    expect(remoteGet).not.toHaveBeenCalled();
    const invalid = await app.inject({ method: "POST", url: `${scope.base}/reconciliation/issues/7/decision`, headers: { authorization: `Bearer ${scope.owner.token}` }, payload: { kind: "manual-link", candidateIssueId: randomUUID(), localFingerprint: "bad", remoteFingerprint: hash } });
    expect(invalid.statusCode).toBe(400);
    expect(decide).not.toHaveBeenCalled();
  });

  it("lists bounded recommendations and fails closed for another project scope", async () => {
    const scope = await reconciliationFixture();
    const ownerHeaders = { authorization: `Bearer ${scope.owner.token}` };
    const listed = await app.inject({ method: "GET", url: `${scope.base}/reconciliation/recommendations?limit=1&state=pending`, headers: ownerHeaders });
    const scoped = generateTestToken({ userId: scope.owner.userId, email: scope.owner.email, allowedProjectIds: [randomUUID()] });
    const denied = await app.inject({ method: "GET", url: `${scope.base}/reconciliation/recommendations`, headers: { authorization: `Bearer ${scoped}` } });
    const invalid = await app.inject({ method: "GET", url: `${scope.base}/reconciliation/recommendations?limit=51`, headers: ownerHeaders });
    expect(listed.statusCode).toBe(200);
    expect(listed.json()).toEqual({ items: [], nextCursor: null });
    expect(denied.statusCode).toBe(404);
    expect(invalid.statusCode).toBe(400);
  });
});

describe("integration audit health route", () => {
  let app: FastifyInstance;
  beforeAll(async () => { app = await createTestApp(); });
  beforeEach(async () => { await cleanDatabase(); });
  afterAll(async () => { await app.close(); });

  it("returns only safe state to an unscoped owner", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({ data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test" } });
    const binding = await prisma.integrationProjectBinding.create({ data: { connectionId: connection.id, projectId: project.id, remoteProjectId: "remote", readMap: {}, writeMap: {} } });
    const response = await app.inject({ method: "GET", url: `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/bindings/${binding.id}/audit-health`, headers: { authorization: `Bearer ${owner.token}` } });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ state: "unknown", completedAt: null, validUntil: null, fresh: false, reasonCode: null });
  });

  it("rejects non-owners and scoped owner tokens", async () => {
    const workspace = await seedTestWorkspace();
    const [owner, member] = await Promise.all([seedTestMemberWithRole(workspace.id, "owner"), seedTestMemberWithRole(workspace.id, "member")]);
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({ data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test" } });
    const binding = await prisma.integrationProjectBinding.create({ data: { connectionId: connection.id, projectId: project.id, remoteProjectId: "remote", readMap: {}, writeMap: {} } });
    const url = `/api/integrations/workspaces/${workspace.id}/connections/${connection.id}/bindings/${binding.id}/audit-health`;
    expect((await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${member.token}` } })).statusCode).toBe(403);
    const scoped = generateTestToken({ userId: owner.userId, allowedProjectIds: [project.id] });
    expect((await app.inject({ method: "GET", url, headers: { authorization: `Bearer ${scoped}` } })).statusCode).toBe(403);
  });
});


describe("audit health scope", () => {
  const current = { bindingId: "binding", connectionId: "connection", lifecycleEpoch: 7, baseUrl: "https://redmine.test", remoteProjectId: "42", credentialId: "credential", encryptedKey: "cipher" };
  const run = { state: "complete" as const, completedAt: new Date("2026-08-13T12:00:00Z"), validUntil: new Date("2026-08-13T12:05:00Z"), reasonCode: null };
  it("returns complete only for the exact current scope and database-fresh evidence", () => {
    const exactScope = createAuditScopeFingerprint({ bindingId: current.bindingId, connectionId: current.connectionId, lifecycleEpoch: current.lifecycleEpoch, normalizedBaseUrl: new URL(current.baseUrl).toString(), remoteProjectId: current.remoteProjectId, credentialId: current.credentialId, credentialFingerprint: createHash("sha256").update(current.encryptedKey).digest("hex") });
    const valid = auditHealthForScope(current, { ...run, scopeFingerprint: exactScope }, new Date("2026-08-13T12:04:59Z"));
    expect(valid).toMatchObject({ state: "complete", fresh: true });
    expect(auditHealthForScope({ ...current, remoteProjectId: "43" }, { ...run, scopeFingerprint: exactScope }, new Date("2026-08-13T12:04:59Z"))).toEqual({ state: "unknown", completedAt: null, validUntil: null, fresh: false, reasonCode: null });
    expect(auditHealthForScope({ ...current, lifecycleEpoch: 8 }, { ...run, scopeFingerprint: exactScope }, new Date("2026-08-13T12:04:59Z"))).toEqual({ state: "unknown", completedAt: null, validUntil: null, fresh: false, reasonCode: null });
    expect(auditHealthForScope(current, { ...run, scopeFingerprint: exactScope }, new Date("2026-08-13T12:05:00Z"))).toEqual({ state: "unknown", completedAt: null, validUntil: null, fresh: false, reasonCode: null });
  });

  it("waits for a credential replacement before reading audit evidence", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({ data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.test" } });
    const binding = await prisma.integrationProjectBinding.create({ data: { connectionId: connection.id, projectId: project.id, remoteProjectId: "remote", readMap: {}, writeMap: {} } });
    const credential = await prisma.memberIntegrationCredential.create({ data: { memberId: owner.id, connectionId: connection.id, encryptedKey: "old-key", lastAuthStatus: "valid" } });
    await prisma.integrationConnection.update({ where: { id: connection.id }, data: { serviceCredentialId: credential.id } });
    let healthResolved = false;
    let health: Promise<Awaited<ReturnType<typeof getBindingAuditHealth>>> | undefined;
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw(Prisma.sql`SELECT "id" FROM "integration_connections" WHERE "id" = ${connection.id}::uuid FOR UPDATE`);
      await transaction.memberIntegrationCredential.update({ where: { id: credential.id }, data: { encryptedKey: "new-key" } });
      health = getBindingAuditHealth(connection.id, binding.id, owner.userId, workspace.id).then((result) => {
        healthResolved = true;
        return result;
      });
      await new Promise((resolve) => setTimeout(resolve, 25));
      expect(healthResolved).toBe(false);
    });

    await expect(health).resolves.toEqual({ state: "unknown", completedAt: null, validUntil: null, fresh: false, reasonCode: null });
  });
});
