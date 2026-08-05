import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { FastifyInstance } from "fastify";
import { integrationConnectionSchema } from "@kanon/shared";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../config/prisma.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import {
  cleanDatabase,
  createTestApp,
  disconnectTestDb,
  seedTestMemberWithRole,
  seedTestProject,
  seedTestWorkspace,
} from "../../test/helpers.js";
import { decodeKey, decrypt, encrypt, generateEncryptionKey } from "./core/crypto.js";
import {
  clearCredential,
  configureConnection,
  connectCredential,
  createConnection,
  getConnection,
  getConnectionDiscovery,
  getWorkspaceConnection,
  reencryptCredentials,
  replaceServiceCredential,
  type ConnectionServiceDeps,
} from "./service.js";

const remote = {
  whoAmI: vi.fn(async () => ({ id: "remote-user", displayName: "Remote user", login: "remote" })),
  listStatuses: vi.fn(async () => [{ id: "new", name: "New", writable: true }]),
  listPriorities: vi.fn(async () => [{ id: "normal", name: "Normal" }]),
  listProjects: vi.fn(async () => [{ id: "remote-project", name: "Remote project" }]),
  listTimeEntryActivities: vi.fn(async () => [
    { id: "9", name: "Development", isDefault: true },
  ]),
};
const deps: ConnectionServiceDeps = {
  remote: vi.fn(() => remote),
  encrypt: vi.fn((value) => `encrypted:${value}`),
  decrypt: vi.fn((value) => value.replace(/^encrypted:/, "")),
};
const writeMap = {
  backlog: "new",
  analysis: "new",
  todo: "new",
  in_progress: "new",
  review: "new",
  done: "new",
};
const priorityReadMap = { normal: "medium" } as const;
const priorityWriteMap = {
  critical: "normal",
  high: "normal",
  medium: "normal",
  low: "normal",
} as const;

function blockedWorkData(input: {
  bindingId: string;
  credentialId: string;
  entityId: string;
  actorKey: string;
  actorKind?: "user" | "system" | "ai";
  state?: "dead" | "ambiguous";
  skippedReason?: string;
  operation?: "create" | "update" | "delete" | "close";
  attempts?: number;
  refId?: string | null;
  payload?: Prisma.InputJsonValue;
}): Prisma.IntegrationSyncWorkCreateManyInput {
  const id = randomUUID();
  return {
    id,
    bindingId: input.bindingId,
    entityType: "issue",
    entityId: input.entityId,
    direction: "outbound",
    operation: input.operation ?? "update",
    dedupeKey: `credential-recovery:${id}`,
    laneKey: `issue:${input.entityId}`,
    actorKey: input.actorKey,
    actorKind: input.actorKind ?? "user",
    payload: input.payload ?? { version: 1 },
    correlationId: `correlation:${id}`,
    state: input.state ?? "dead",
    attempts: input.attempts ?? 3,
    availableAt: new Date("2999-01-01T00:00:00.000Z"),
    epoch: 0,
    authCredentialId: input.credentialId,
    refId: input.refId ?? null,
    skippedReason: input.skippedReason ?? "credential_invalid",
  };
}

describe("integration credentials", () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    app = await createTestApp();
  });
  beforeEach(async () => {
    await cleanDatabase();
    await prisma.instanceSettings.update({
      where: { id: INSTANCE_SETTINGS_ID },
      data: { redmineBaseUrl: "https://redmine.example.test" },
    });
    vi.clearAllMocks();
  });
  afterAll(async () => {
    await app.close();
    await disconnectTestDb();
  });

  it("connects, replaces, reports, and clears only the caller credential", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "owner-key" },
      owner.userId,
      deps,
    );
    await configureConnection(
      connection.id,
      {
        projectId: project.id,
        remoteProjectId: "remote-project",
        timeActivityId: "9",
        readMap: { new: "backlog" },
        writeMap,
        priorityReadMap,
        priorityWriteMap,
      },
      owner.userId,
      deps,
    );

    remote.whoAmI.mockResolvedValueOnce({
      id: "member-remote",
      displayName: "Member remote",
      login: "member-remote",
    });
    const connected = await connectCredential(connection.id, "member-key", member.userId, deps);
    const original = await prisma.memberIntegrationCredential.findUniqueOrThrow({
      where: { memberId_connectionId: { memberId: member.id, connectionId: connection.id } },
    });
    expect(connected).toMatchObject({
      connected: true,
      externalUserId: "member-remote",
      externalLogin: "member-remote",
    });
    expect(original).toMatchObject({ encryptedKey: "encrypted:member-key", lastAuthStatus: "valid", revokedAt: null });
    await expect(
      prisma.integrationExternalIdentity.findUniqueOrThrow({
        where: { bindingId_memberId: { bindingId: (await prisma.integrationProjectBinding.findFirstOrThrow()).id, memberId: member.id } },
      }),
    ).resolves.toMatchObject({ remoteUserId: "member-remote", remoteLogin: "member-remote" });

    remote.whoAmI.mockResolvedValueOnce({ id: "remote-user-2", displayName: "Remote user 2", login: "remote-2" });
    await connectCredential(connection.id, "replacement-key", member.userId, deps);
    const replaced = await prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: original.id } });
    expect(replaced).toMatchObject({ encryptedKey: "encrypted:replacement-key", externalUserId: "remote-user-2" });

    remote.whoAmI.mockRejectedValueOnce(new Error("invalid replacement"));
    await expect(connectCredential(connection.id, "bad-key", member.userId, deps)).rejects.toMatchObject({
      statusCode: 502,
      code: "REDMINE_CONNECTION_FAILED",
    });
    await expect(prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: original.id } })).resolves.toMatchObject({
      encryptedKey: "encrypted:replacement-key",
      externalUserId: "remote-user-2",
    });

    await clearCredential(connection.id, member.userId);
    const detail = await getConnection(connection.id, member.userId);
    expect(detail).toMatchObject({
      id: connection.id,
      callerCredential: { connected: false, status: "revoked", externalLogin: "remote-2" },
      counts: { workspaceMembers: 2, validCredentials: 1, externalIdentities: 2 },
    });
    expect(JSON.stringify(detail)).not.toContain("encryptedKey");
    await expect(
      prisma.memberIntegrationCredential.findUniqueOrThrow({
        where: { memberId_connectionId: { memberId: owner.id, connectionId: connection.id } },
      }),
    ).resolves.toMatchObject({ lastAuthStatus: "valid", revokedAt: null });

    const response = await app.inject({
      method: "GET",
      url: `/api/integrations/connections/${connection.id}`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ callerCredential: { connected: false, status: "revoked" } });
    expect(response.body).not.toContain("encryptedKey");
    const cleared = await app.inject({
      method: "DELETE",
      url: `/api/integrations/connections/${connection.id}/credential`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(cleared.statusCode).toBe(204);

    await clearCredential(connection.id, owner.userId);
    await expect(getConnectionDiscovery(connection.id, owner.userId, deps)).rejects.toMatchObject({
      statusCode: 409,
      code: "INTEGRATION_NOT_READY",
    });
  });

  it("does not write or redrive when replacement validation fails", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.example.test" },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: { connectionId: connection.id, projectId: project.id, remoteProjectId: "remote-project", readMap: {}, writeMap: {} },
    });
    const credential = await prisma.memberIntegrationCredential.create({
      data: {
        connectionId: connection.id,
        memberId: member.id,
        encryptedKey: "encrypted:rejected-key",
        externalUserId: "remote-user",
        lastAuthStatus: "invalid",
      },
    });
    const work = await prisma.integrationSyncWork.create({
      data: blockedWorkData({
        bindingId: binding.id,
        credentialId: credential.id,
        entityId: project.id,
        actorKey: `member:${member.id}`,
      }),
    });
    const before = await prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } });
    remote.whoAmI.mockRejectedValueOnce(new Error("rejected secret: replacement-key"));

    await expect(
      connectCredential(connection.id, "replacement-key", member.userId, deps),
    ).rejects.toMatchObject({
      statusCode: 502,
      code: "REDMINE_CONNECTION_FAILED",
      message: expect.not.stringContaining("replacement-key"),
    });

    expect(deps.encrypt).not.toHaveBeenCalled();
    await expect(
      prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: credential.id } }),
    ).resolves.toMatchObject({ encryptedKey: "encrypted:rejected-key", lastAuthStatus: "invalid" });
    expect(await prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: work.id } })).toEqual(before);
  });

  it("atomically redrives only personal work blocked by the replaced credential", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.example.test" },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: { connectionId: connection.id, projectId: project.id, remoteProjectId: "remote-project", readMap: {}, writeMap: {} },
    });
    const credential = await prisma.memberIntegrationCredential.create({
      data: {
        connectionId: connection.id,
        memberId: member.id,
        encryptedKey: "encrypted:old-key",
        externalUserId: "member-remote",
        lastAuthStatus: "invalid",
      },
    });
    const ref = await prisma.externalRef.create({
      data: {
        connectionId: connection.id,
        bindingId: binding.id,
        entityType: "issue",
        entityId: project.id,
        externalId: "remote-issue",
      },
    });
    const personal = `member:${member.id}`;
    const [dead, ambiguous, otherDead, serviceDead] = await Promise.all([
      prisma.integrationSyncWork.create({
        data: blockedWorkData({
          bindingId: binding.id,
          credentialId: credential.id,
          entityId: project.id,
          actorKey: personal,
          operation: "create",
          attempts: 5,
          refId: ref.id,
          payload: { version: 1, title: "preserved" },
        }),
      }),
      prisma.integrationSyncWork.create({
        data: blockedWorkData({
          bindingId: binding.id,
          credentialId: credential.id,
          entityId: project.id,
          actorKey: personal,
          state: "ambiguous",
        }),
      }),
      prisma.integrationSyncWork.create({
        data: blockedWorkData({
          bindingId: binding.id,
          credentialId: credential.id,
          entityId: project.id,
          actorKey: personal,
          skippedReason: "provider_failure",
        }),
      }),
      prisma.integrationSyncWork.create({
        data: blockedWorkData({
          bindingId: binding.id,
          credentialId: credential.id,
          entityId: project.id,
          actorKey: "system:scheduler",
          actorKind: "system",
        }),
      }),
    ]);
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { lifecycleEpoch: 2 },
    });
    remote.whoAmI.mockResolvedValueOnce({
      id: "member-remote",
      displayName: "Member Remote",
      login: "member",
    });
    const startedAt = Date.now();

    await connectCredential(connection.id, "replacement-key", member.userId, deps);

    await expect(
      prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: credential.id } }),
    ).resolves.toMatchObject({ encryptedKey: "encrypted:replacement-key", lastAuthStatus: "valid" });
    const recoveredDead = await prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: dead.id } });
    expect(recoveredDead).toMatchObject({
      id: dead.id,
      dedupeKey: dead.dedupeKey,
      correlationId: dead.correlationId,
      operation: dead.operation,
      payload: dead.payload,
      actorKey: dead.actorKey,
      actorKind: dead.actorKind,
      refId: dead.refId,
      attempts: dead.attempts,
      state: "retry",
      epoch: 2,
      skippedReason: null,
      authCredentialId: credential.id,
    });
    expect(recoveredDead.availableAt.getTime()).toBeGreaterThanOrEqual(startedAt);
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: ambiguous.id } }),
    ).resolves.toMatchObject({
      state: "ambiguous",
      epoch: 2,
      skippedReason: null,
      attempts: ambiguous.attempts,
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: otherDead.id } }),
    ).resolves.toMatchObject({ state: "dead", skippedReason: "provider_failure" });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: serviceDead.id } }),
    ).resolves.toMatchObject({ state: "dead", skippedReason: "credential_invalid" });
  });

  it("lets only an instance admin replace and rebind the service credential", async () => {
    const workspace = await seedTestWorkspace();
    const previousAdmin = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const replacementAdmin = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const nonAdminOwner = await seedTestMemberWithRole(workspace.id, "owner");
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.example.test" },
    });
    const previousCredential = await prisma.memberIntegrationCredential.create({
      data: {
        connectionId: connection.id,
        memberId: previousAdmin.id,
        encryptedKey: "encrypted:old-service-key",
        externalUserId: "remote-user",
        lastAuthStatus: "invalid",
      },
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { serviceCredentialId: previousCredential.id },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: { connectionId: connection.id, projectId: project.id, remoteProjectId: "remote-project", readMap: {}, writeMap: {} },
    });
    const identity = await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: binding.id,
        memberId: previousAdmin.id,
        remoteUserId: "remote-user",
        remoteLogin: "remote",
      },
    });
    const replacementPersonalCredential = await prisma.memberIntegrationCredential.create({
      data: {
        connectionId: connection.id,
        memberId: replacementAdmin.id,
        encryptedKey: "encrypted:old-personal-key",
        lastAuthStatus: "invalid",
      },
    });
    const [dead, ambiguous, personal, replacementPersonal, orphaned] = await Promise.all([
      prisma.integrationSyncWork.create({
        data: blockedWorkData({
          bindingId: binding.id,
          credentialId: previousCredential.id,
          entityId: project.id,
          actorKey: "system:scheduler",
          actorKind: "system",
        }),
      }),
      prisma.integrationSyncWork.create({
        data: blockedWorkData({
          bindingId: binding.id,
          credentialId: previousCredential.id,
          entityId: project.id,
          actorKey: "ai:agent",
          actorKind: "ai",
          state: "ambiguous",
        }),
      }),
      prisma.integrationSyncWork.create({
        data: blockedWorkData({
          bindingId: binding.id,
          credentialId: previousCredential.id,
          entityId: project.id,
          actorKey: `member:${previousAdmin.id}`,
        }),
      }),
      prisma.integrationSyncWork.create({
        data: blockedWorkData({
          bindingId: binding.id,
          credentialId: replacementPersonalCredential.id,
          entityId: project.id,
          actorKey: `member:${replacementAdmin.id}`,
        }),
      }),
      prisma.integrationSyncWork.create({
        data: {
          ...blockedWorkData({
            bindingId: binding.id,
            credentialId: previousCredential.id,
            entityId: project.id,
            actorKey: "system:orphaned",
            actorKind: "system",
          }),
          authCredentialId: null,
        },
      }),
    ]);
    await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { lifecycleEpoch: 3 },
    });

    const forbidden = await app.inject({
      method: "PUT",
      url: `/api/integrations/connections/${connection.id}/service-credential`,
      headers: { authorization: `Bearer ${nonAdminOwner.token}` },
      payload: { apiKey: "replacement-service-key" },
    });
    expect(forbidden.statusCode).toBe(403);
    expect((await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } })).serviceCredentialId).toBe(previousCredential.id);

    await replaceServiceCredential(connection.id, "replacement-service-key", replacementAdmin.userId, deps);

    const replacement = await prisma.memberIntegrationCredential.findUniqueOrThrow({
      where: { memberId_connectionId: { memberId: replacementAdmin.id, connectionId: connection.id } },
    });
    expect(replacement).toMatchObject({
      encryptedKey: "encrypted:replacement-service-key",
      externalUserId: "remote-user",
      lastAuthStatus: "valid",
    });
    expect((await prisma.integrationConnection.findUniqueOrThrow({ where: { id: connection.id } })).serviceCredentialId).toBe(replacement.id);
    await expect(
      prisma.integrationExternalIdentity.findUniqueOrThrow({ where: { id: identity.id } }),
    ).resolves.toMatchObject({ memberId: replacementAdmin.id, remoteUserId: "remote-user" });
    await expect(prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: dead.id } })).resolves.toMatchObject({
      state: "retry",
      epoch: 3,
      skippedReason: null,
      authCredentialId: replacement.id,
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: ambiguous.id } }),
    ).resolves.toMatchObject({
      state: "ambiguous",
      epoch: 3,
      skippedReason: null,
      authCredentialId: replacement.id,
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: personal.id } }),
    ).resolves.toMatchObject({
      state: "dead",
      skippedReason: "credential_invalid",
      authCredentialId: previousCredential.id,
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: replacementPersonal.id } }),
    ).resolves.toMatchObject({
      state: "retry",
      epoch: 3,
      skippedReason: null,
      authCredentialId: replacement.id,
    });
    await expect(
      prisma.integrationSyncWork.findUniqueOrThrow({ where: { id: orphaned.id } }),
    ).resolves.toMatchObject({
      state: "retry",
      epoch: 3,
      skippedReason: null,
      authCredentialId: replacement.id,
    });

    await prisma.user.update({
      where: { id: replacementAdmin.userId },
      data: { isInstanceAdmin: false },
    });
    vi.clearAllMocks();
    await expect(
      connectCredential(connection.id, "unauthorized-service-key", replacementAdmin.userId, deps),
    ).rejects.toMatchObject({ statusCode: 403, code: "FORBIDDEN" });
    expect(deps.remote).not.toHaveBeenCalled();
  });

  it("caps blocked-work health details and redacts them from regular members", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner");
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id);
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.example.test" },
    });
    const credential = await prisma.memberIntegrationCredential.create({
      data: {
        connectionId: connection.id,
        memberId: owner.id,
        encryptedKey: "encrypted:must-not-leak",
        externalUserId: "remote-user",
        lastAuthStatus: "invalid",
      },
    });
    await prisma.integrationConnection.update({
      where: { id: connection.id },
      data: { serviceCredentialId: credential.id },
    });
    const binding = await prisma.integrationProjectBinding.create({
      data: { connectionId: connection.id, projectId: project.id, remoteProjectId: "remote-project", readMap: {}, writeMap: {} },
    });
    await prisma.integrationSyncWork.createMany({
      data: Array.from({ length: 22 }, () =>
        blockedWorkData({
          bindingId: binding.id,
          credentialId: credential.id,
          entityId: project.id,
          actorKey: `member:${owner.id}`,
          payload: { apiKey: "raw-api-key-must-not-leak" },
        }),
      ),
    });
    await prisma.integrationSyncWork.create({
      data: blockedWorkData({
        bindingId: binding.id,
        credentialId: credential.id,
        entityId: project.id,
        actorKey: `member:${owner.id}`,
        skippedReason: "provider_failure",
      }),
    });

    const ownerResponse = await app.inject({
      method: "GET",
      url: `/api/integrations/connections/${connection.id}`,
      headers: { authorization: `Bearer ${owner.token}` },
    });
    const ownerDetail = integrationConnectionSchema.parse(ownerResponse.json());
    expect(ownerDetail.serviceCredentialStatus).toBe("invalid");
    expect(ownerDetail.syncHealth).toMatchObject({
      status: "credential_blocked",
      blockedWork: { total: 22 },
    });
    expect(ownerDetail.syncHealth.blockedWork?.items).toHaveLength(20);
    expect(Object.keys(ownerDetail.syncHealth.blockedWork!.items[0]!).sort()).toEqual([
      "entityId",
      "entityType",
      "id",
      "operation",
      "state",
      "updatedAt",
    ]);

    const memberResponse = await app.inject({
      method: "GET",
      url: `/api/integrations/connections/${connection.id}`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    const memberDetail = integrationConnectionSchema.parse(memberResponse.json());
    expect(memberDetail.syncHealth).toEqual({ status: "credential_blocked", blockedWork: null });
    expect(memberResponse.body).not.toContain("must-not-leak");
    expect(memberResponse.body).not.toContain("actorKey");
    expect(memberResponse.body).not.toContain("correlationId");
  });

  it("allows only one member to reattach a preserved remote identity", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const former = await seedTestMemberWithRole(workspace.id, "member");
    const project = await seedTestProject(workspace.id);
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "owner-key" },
      owner.userId,
      deps,
    );
    await configureConnection(
      connection.id,
      {
        projectId: project.id,
        remoteProjectId: "remote-project",
        timeActivityId: "9",
        readMap: { new: "backlog" },
        writeMap,
        priorityReadMap,
        priorityWriteMap,
      },
      owner.userId,
      deps,
    );
    remote.whoAmI.mockResolvedValue({
      id: "returning-remote-user",
      displayName: "Returning User",
      login: "returning",
    });
    await connectCredential(connection.id, "former-key", former.userId, deps);
    const identity = await prisma.integrationExternalIdentity.findFirstOrThrow({
      where: { memberId: former.id, remoteUserId: "returning-remote-user" },
    });

    await prisma.member.delete({ where: { id: former.id } });
    const returning = await seedTestMemberWithRole(workspace.id, "member");
    const competitor = await seedTestMemberWithRole(workspace.id, "member");
    const candidates = [returning, competitor];
    const attempts = await Promise.allSettled(
      candidates.map((candidate) =>
        connectCredential(connection.id, "returning-key", candidate.userId, deps),
      ),
    );
    const winner = candidates[attempts.findIndex(({ status }) => status === "fulfilled")]!;

    expect(attempts.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(attempts.find(({ status }) => status === "rejected")).toMatchObject({
      reason: { code: "REMOTE_IDENTITY_ALREADY_CONNECTED" },
    });

    await expect(
      prisma.integrationExternalIdentity.findUniqueOrThrow({ where: { id: identity.id } }),
    ).resolves.toMatchObject({
      memberId: winner.id,
      remoteUserId: "returning-remote-user",
      remoteDisplayName: "Returning User",
    });
    await expect(
      prisma.integrationExternalIdentity.count({
        where: { bindingId: identity.bindingId, remoteUserId: "returning-remote-user" },
      }),
    ).resolves.toBe(1);
    await expect(
      prisma.memberIntegrationCredential.count({
        where: { connectionId: connection.id, memberId: { in: candidates.map(({ id }) => id) } },
      }),
    ).resolves.toBe(1);
  });

  it("rejects malformed credential requests at the HTTP boundary", async () => {
    const workspace = await seedTestWorkspace();
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const response = await app.inject({
      method: "POST",
      url: "/api/integrations/credentials",
      headers: { authorization: `Bearer ${member.token}` },
      payload: { connectionId: "not-a-uuid", apiKey: "" },
    });
    expect(response.statusCode).toBe(400);
    const serviceResponse = await app.inject({
      method: "PUT",
      url: `/api/integrations/connections/${randomUUID()}/service-credential`,
      headers: { authorization: `Bearer ${member.token}` },
      payload: { apiKey: "" },
    });
    expect(serviceResponse.statusCode).toBe(400);
  });

  it("finds the Redmine connection by workspace only for workspace members", async () => {
    const workspace = await seedTestWorkspace();
    const owner = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const member = await seedTestMemberWithRole(workspace.id, "member");
    const otherWorkspace = await seedTestWorkspace();
    const outsider = await seedTestMemberWithRole(otherWorkspace.id, "owner");

    await expect(getWorkspaceConnection(workspace.id, owner.userId)).resolves.toBeNull();
    const { connection } = await createConnection(
      { workspaceId: workspace.id, apiKey: "owner-key" },
      owner.userId,
      deps,
    );

    const response = await app.inject({
      method: "GET",
      url: `/api/integrations/connections?workspaceId=${workspace.id}`,
      headers: { authorization: `Bearer ${member.token}` },
    });
    expect(response.statusCode).toBe(200);
    const detail = integrationConnectionSchema.parse(response.json());
    expect(detail).toMatchObject({
      id: connection.id,
      connectedMemberIds: [owner.id],
      counts: { workspaceMembers: 2, validCredentials: 1 },
    });
    await expect(getWorkspaceConnection(workspace.id, outsider.userId)).rejects.toMatchObject({
      statusCode: 403,
      code: "FORBIDDEN",
    });
  });

  it("dry-runs, rotates, reruns, and reverses mixed-key credentials", async () => {
    const workspace = await seedTestWorkspace();
    const first = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const second = await seedTestMemberWithRole(workspace.id, "member");
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.example.test" },
    });
    const oldKey = decodeKey(generateEncryptionKey());
    const newKey = decodeKey(generateEncryptionKey());
    const oldCredential = await prisma.memberIntegrationCredential.create({
      data: { connectionId: connection.id, memberId: first.id, encryptedKey: encrypt("first-secret", oldKey) },
    });
    const newCredential = await prisma.memberIntegrationCredential.create({
      data: { connectionId: connection.id, memberId: second.id, encryptedKey: encrypt("second-secret", newKey) },
    });
    const before = await prisma.memberIntegrationCredential.findMany({ orderBy: { id: "asc" } });

    await expect(
      reencryptCredentials({ oldKey, newKey, dryRun: true, batchSize: 1 }),
    ).resolves.toEqual({ total: 2, pending: 1, alreadyRotated: 1, updated: 0 });
    expect(await prisma.memberIntegrationCredential.findMany({ orderBy: { id: "asc" } })).toEqual(before);

    await expect(reencryptCredentials({ oldKey, newKey, batchSize: 1 })).resolves.toEqual({
      total: 2,
      pending: 1,
      alreadyRotated: 1,
      updated: 1,
    });
    expect(decrypt((await prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: oldCredential.id } })).encryptedKey, newKey)).toBe("first-secret");
    expect(decrypt((await prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: newCredential.id } })).encryptedKey, newKey)).toBe("second-secret");
    await expect(reencryptCredentials({ oldKey, newKey })).resolves.toMatchObject({ pending: 0, updated: 0 });
    await expect(reencryptCredentials({ oldKey: newKey, newKey: oldKey, batchSize: 1 })).resolves.toMatchObject({
      pending: 2,
      updated: 2,
    });
  });

  it("reports every undecryptable row before writing any rotation", async () => {
    const workspace = await seedTestWorkspace();
    const first = await seedTestMemberWithRole(workspace.id, "owner", { isInstanceAdmin: true });
    const second = await seedTestMemberWithRole(workspace.id, "member");
    const connection = await prisma.integrationConnection.create({
      data: { workspaceId: workspace.id, provider: "redmine", baseUrl: "https://redmine.example.test" },
    });
    const oldKey = decodeKey(generateEncryptionKey());
    const newKey = decodeKey(generateEncryptionKey());
    const valid = await prisma.memberIntegrationCredential.create({
      data: { connectionId: connection.id, memberId: first.id, encryptedKey: encrypt("valid", oldKey) },
    });
    const invalid = await prisma.memberIntegrationCredential.create({
      data: { connectionId: connection.id, memberId: second.id, encryptedKey: "not-ciphertext" },
    });
    const original = valid.encryptedKey;

    await expect(reencryptCredentials({ oldKey, newKey, batchSize: 1 })).rejects.toThrow(invalid.id);
    await expect(prisma.memberIntegrationCredential.findUniqueOrThrow({ where: { id: valid.id } })).resolves.toMatchObject({
      encryptedKey: original,
    });
  });
});
