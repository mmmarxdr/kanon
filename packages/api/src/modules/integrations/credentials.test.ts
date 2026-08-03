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
  type ConnectionServiceDeps,
} from "./service.js";

const remote = {
  whoAmI: vi.fn(async () => ({ id: "remote-user", displayName: "Remote user", login: "remote" })),
  listStatuses: vi.fn(async () => [{ id: "new", name: "New", writable: true }]),
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
      { projectId: project.id, remoteProjectId: "remote-project", timeActivityId: "9", readMap: { new: "backlog" }, writeMap },
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
