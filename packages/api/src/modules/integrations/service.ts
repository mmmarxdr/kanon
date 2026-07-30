import { Prisma } from "@prisma/client";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { decrypt as decryptCredential, encrypt as encryptCredential } from "./core/crypto.js";
import type { DiscoveredProject, DiscoveredStatus, DiscoveredUser } from "./core/types.js";
import { RedmineProviderAdapter } from "./providers/redmine/adapter.js";
import { RedmineHttpClient } from "./providers/redmine/http-client.js";

const WRITABLE_STATES = ["backlog", "analysis", "todo", "in_progress", "review", "done"] as const;

interface RemoteDiscovery {
  whoAmI(): Promise<DiscoveredUser>;
  listStatuses(): Promise<readonly DiscoveredStatus[]>;
  listProjects(): Promise<readonly DiscoveredProject[]>;
}

export interface ConnectionServiceDeps {
  remote(baseUrl: string, apiKey: string): RemoteDiscovery;
  encrypt(apiKey: string): string;
  decrypt(ciphertext: string): string;
}

const defaultDeps: ConnectionServiceDeps = {
  remote(baseUrl, apiKey) {
    return new RedmineProviderAdapter(new RedmineHttpClient(baseUrl, apiKey), {
      writeMap: {},
      resolveExternalId: async () => null,
    });
  },
  encrypt: encryptCredential,
  decrypt: decryptCredential,
};

type Database = Pick<
  Prisma.TransactionClient,
  "member" | "project" | "integrationConnection" | "integrationProjectBinding" | "memberIntegrationCredential"
>;

async function requireOwner(database: Database, workspaceId: string, userId: string) {
  const member = await database.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true, role: true },
  });
  if (!member || member.role !== "owner") {
    throw new AppError(403, "FORBIDDEN", "Only a workspace owner can configure integrations");
  }
  return member;
}

async function ownedConnection(database: Database, connectionId: string, userId: string) {
  const connection = await database.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration connection not found");
  await requireOwner(database, connection.workspaceId, userId);
  return connection;
}

async function serviceCredential(database: Database, connection: { id: string; serviceCredentialId: string | null }) {
  const credential = connection.serviceCredentialId
    ? await database.memberIntegrationCredential.findUnique({ where: { id: connection.serviceCredentialId } })
    : null;
  if (!credential || credential.connectionId !== connection.id || credential.revokedAt) {
    throw new AppError(409, "INTEGRATION_NOT_READY", "A valid service credential is required");
  }
  return credential;
}

export async function createConnection(
  input: { workspaceId: string; baseUrl: string; apiKey: string },
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  await requireOwner(prisma, input.workspaceId, userId);
  const existing = await prisma.integrationConnection.findUnique({
    where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: "redmine" } },
    select: { lifecycle: true },
  });
  if (existing && existing.lifecycle !== "draft") {
    throw new AppError(409, "INTEGRATION_ALREADY_CONFIGURED", "Only a draft connection can be bootstrapped again");
  }
  const remote = deps.remote(input.baseUrl, input.apiKey);
  const [identity, statuses, projects] = await Promise.all([
    remote.whoAmI(),
    remote.listStatuses(),
    remote.listProjects(),
  ]);
  const encryptedKey = deps.encrypt(input.apiKey);
  const discoveredStatuses = statuses.map(({ id, name, writable }) => ({ id, name, writable }));

  const connection = await prisma.$transaction(async (transaction) => {
    const owner = await requireOwner(transaction, input.workspaceId, userId);
    const current = await transaction.integrationConnection.findUnique({
      where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: "redmine" } },
      select: { lifecycle: true },
    });
    if (current && current.lifecycle !== "draft") {
      throw new AppError(409, "INTEGRATION_ALREADY_CONFIGURED", "Only a draft connection can be bootstrapped again");
    }
    const draft = await transaction.integrationConnection.upsert({
      where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: "redmine" } },
      create: {
        workspaceId: input.workspaceId,
        provider: "redmine",
        baseUrl: input.baseUrl,
        discoveredStatuses,
      },
      update: { baseUrl: input.baseUrl, discoveredStatuses },
    });
    const credential = await transaction.memberIntegrationCredential.upsert({
      where: { memberId_connectionId: { memberId: owner.id, connectionId: draft.id } },
      create: {
        memberId: owner.id,
        connectionId: draft.id,
        encryptedKey,
        externalUserId: identity.id,
        externalLogin: identity.login ?? null,
        lastValidatedAt: new Date(),
        lastAuthStatus: "valid",
      },
      update: {
        encryptedKey,
        externalUserId: identity.id,
        externalLogin: identity.login ?? null,
        lastValidatedAt: new Date(),
        lastAuthStatus: "valid",
        revokedAt: null,
      },
    });
    return transaction.integrationConnection.update({
      where: { id: draft.id },
      data: { serviceCredentialId: credential.id },
    });
  });

  return { connection, discovery: { statuses, projects } };
}

async function lockConnection(transaction: Prisma.TransactionClient, connectionId: string) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "integration_connections" WHERE "id" = ${connectionId}::uuid FOR UPDATE`,
  );
}

export async function getConnectionDiscovery(
  connectionId: string,
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const connection = await ownedConnection(prisma, connectionId, userId);
  const credential = await serviceCredential(prisma, connection);
  const remote = deps.remote(connection.baseUrl, deps.decrypt(credential.encryptedKey));
  const [statuses, projects] = await Promise.all([remote.listStatuses(), remote.listProjects()]);
  const discoveredStatuses = statuses.map(({ id, name, writable }) => ({ id, name, writable }));
  await ownedConnection(prisma, connectionId, userId);
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: { discoveredStatuses },
  });
  return { statuses, projects };
}

export async function configureConnection(
  connectionId: string,
  input: {
    projectId: string;
    remoteProjectId: string;
    readMap: Readonly<Record<string, string>>;
    writeMap: Readonly<Record<string, string>>;
  },
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const connection = await ownedConnection(prisma, connectionId, userId);
  const credential = await serviceCredential(prisma, connection);
  const remote = deps.remote(connection.baseUrl, deps.decrypt(credential.encryptedKey));
  const [projects, statuses] = await Promise.all([remote.listProjects(), remote.listStatuses()]);
  if (!projects.some(({ id }) => id === input.remoteProjectId)) {
    throw new AppError(400, "REMOTE_PROJECT_NOT_FOUND", "Select a project returned by discovery");
  }
  const statusIds = new Set(statuses.map(({ id }) => id));
  const writableStatusIds = new Set(statuses.filter(({ writable }) => writable).map(({ id }) => id));
  const validState = (value: string) => WRITABLE_STATES.includes(value as (typeof WRITABLE_STATES)[number]);
  if (
    Object.entries(input.readMap).some(([remoteId, state]) => !statusIds.has(remoteId) || !validState(state)) ||
    Object.entries(input.writeMap).some(
      ([state, remoteId]) => !validState(state) || !writableStatusIds.has(remoteId),
    )
  ) {
    throw new AppError(400, "INVALID_STATUS_MAP", "Status maps must use discovered statuses and Kanon states");
  }

  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const current = await ownedConnection(transaction, connectionId, userId);
    const project = await transaction.project.findFirst({
      where: { id: input.projectId, workspaceId: current.workspaceId },
      select: { id: true },
    });
    if (!project) throw new AppError(400, "PROJECT_NOT_FOUND", "Project does not belong to this workspace");
    const binding = await transaction.integrationProjectBinding.upsert({
      where: { connectionId_projectId: { connectionId, projectId: project.id } },
      create: {
        connectionId,
        projectId: project.id,
        remoteProjectId: input.remoteProjectId,
        readMap: input.readMap as Prisma.InputJsonValue,
        writeMap: input.writeMap as Prisma.InputJsonValue,
      },
      update: {
        remoteProjectId: input.remoteProjectId,
        readMap: input.readMap as Prisma.InputJsonValue,
        writeMap: input.writeMap as Prisma.InputJsonValue,
        lifecycle: "draft",
        lifecycleEpoch: { increment: 1 },
      },
    });
    if (current.lifecycle !== "draft") {
      await transaction.integrationConnection.update({
        where: { id: connectionId },
        data: { lifecycle: "draft", lifecycleEpoch: { increment: 1 } },
      });
    }
    return binding;
  });
}

async function assertActivationReady(database: Database, connection: Awaited<ReturnType<typeof ownedConnection>>) {
  const bindings = await database.integrationProjectBinding.findMany({ where: { connectionId: connection.id } });
  const credential = await serviceCredential(database, connection);
  if (
    credential.lastAuthStatus !== "valid" ||
    !credential.externalUserId ||
    bindings.length === 0 ||
    !bindings.every((binding) => hasCompleteMaps(binding, connection.discoveredStatuses))
  ) {
    throw new AppError(409, "INTEGRATION_NOT_READY", "Binding, confirmed maps, and valid credentials are required");
  }
  return credential;
}

function hasCompleteMaps(
  binding: { readMap: unknown; writeMap: unknown },
  discoveredStatuses: unknown,
): boolean {
  if (!binding.readMap || typeof binding.readMap !== "object" || Array.isArray(binding.readMap)) return false;
  if (!binding.writeMap || typeof binding.writeMap !== "object" || Array.isArray(binding.writeMap)) return false;
  if (!Array.isArray(discoveredStatuses) || discoveredStatuses.length === 0) return false;
  const statuses = discoveredStatuses.filter(
    (status): status is { id: string; writable: boolean } =>
      !!status &&
      typeof status === "object" &&
      typeof (status as { id?: unknown }).id === "string" &&
      typeof (status as { writable?: unknown }).writable === "boolean",
  );
  if (statuses.length !== discoveredStatuses.length) return false;
  const readMap = binding.readMap as Record<string, unknown>;
  if (
    statuses.some(
      ({ id }) =>
        typeof readMap[id] !== "string" ||
        !WRITABLE_STATES.includes(readMap[id] as (typeof WRITABLE_STATES)[number]),
    )
  )
    return false;
  const writeMap = binding.writeMap as Record<string, unknown>;
  const writableIds = new Set(statuses.filter(({ writable }) => writable).map(({ id }) => id));
  return WRITABLE_STATES.every(
    (state) => typeof writeMap[state] === "string" && writableIds.has(writeMap[state] as string),
  );
}

export async function setConnectionLifecycle(
  connectionId: string,
  lifecycle: "active" | "paused" | "disabled",
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const current = await ownedConnection(prisma, connectionId, userId);
  if (lifecycle === "active") {
    const credential = await assertActivationReady(prisma, current);
    await deps.remote(current.baseUrl, deps.decrypt(credential.encryptedKey)).whoAmI();
  }

  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const locked = await ownedConnection(transaction, connectionId, userId);
    if (lifecycle === "active") await assertActivationReady(transaction, locked);
    const connection = await transaction.integrationConnection.update({
      where: { id: connectionId },
      data: { lifecycle, lifecycleEpoch: { increment: 1 } },
    });
    await transaction.integrationProjectBinding.updateMany({
      where: { connectionId },
      data: {
        lifecycle,
        lifecycleEpoch: { increment: 1 },
        pollLeaseToken: null,
        pollLeaseUntil: null,
      },
    });
    return connection;
  });
}
