import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import { decrypt as decryptCredential, encrypt as encryptCredential } from "./core/crypto.js";
import {
  TIME_ENTRY_ACTIVITY_MAP_KEY,
  type DiscoveredProject,
  type DiscoveredStatus,
  type DiscoveredTimeEntryActivity,
  type DiscoveredUser,
} from "./core/types.js";
import { RedmineProviderAdapter } from "./providers/redmine/adapter.js";
import { RedmineHttpClient } from "./providers/redmine/http-client.js";

const WRITABLE_STATES = ["backlog", "analysis", "todo", "in_progress", "review", "done"] as const;

interface RemoteDiscovery {
  whoAmI(): Promise<DiscoveredUser>;
  listStatuses(): Promise<readonly DiscoveredStatus[]>;
  listProjects(): Promise<readonly DiscoveredProject[]>;
  listTimeEntryActivities(): Promise<readonly DiscoveredTimeEntryActivity[]>;
}

export interface ConnectionServiceDeps {
  remote(baseUrl: string, apiKey: string): RemoteDiscovery;
  encrypt(apiKey: string): string;
  decrypt(ciphertext: string): string;
}

const defaultDeps: ConnectionServiceDeps = {
  remote(baseUrl, apiKey) {
    return new RedmineProviderAdapter(
      new RedmineHttpClient(baseUrl, apiKey, {
        endpointAllowlist: env.REDMINE_ENDPOINT_ALLOWLIST,
      }),
      {
        writeMap: {},
        resolveExternalId: async () => null,
      },
    );
  },
  encrypt: encryptCredential,
  decrypt: decryptCredential,
};

async function queryRedmine<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch {
    throw new AppError(
      502,
      "REDMINE_CONNECTION_FAILED",
      "Redmine connection failed. Verify the API key or ask an instance admin to check the URL, endpoint allowlist, and network access",
    );
  }
}

type Database = Pick<
  Prisma.TransactionClient,
  | "member"
  | "project"
  | "user"
  | "integrationConnection"
  | "integrationProjectBinding"
  | "integrationExternalIdentity"
  | "memberIntegrationCredential"
>;

async function requireInstanceAdmin(database: Pick<Database, "user">, userId: string) {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { isInstanceAdmin: true },
  });
  if (!user?.isInstanceAdmin) {
    throw new AppError(403, "FORBIDDEN", "Instance-admin access required");
  }
}

async function isInstanceAdminUser(database: Pick<Database, "user">, userId: string) {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { isInstanceAdmin: true },
  });
  return !!user?.isInstanceAdmin;
}

async function requireOwner(database: Database, workspaceId: string, userId: string) {
  const member = await database.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true, role: true },
  });
  if (!member || member.role !== "owner") {
    throw new AppError(403, "FORBIDDEN", "Only a workspace owner can bind projects to Redmine");
  }
  return member;
}

/** Service credential holder must be the configuring admin's workspace membership. */
async function resolveServiceCredentialMember(
  database: Database,
  workspaceId: string,
  userId: string,
) {
  const caller = await database.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  });
  if (!caller) {
    throw new AppError(
      409,
      "WORKSPACE_MEMBERSHIP_REQUIRED",
      "Join the workspace before configuring its Redmine service credential",
    );
  }
  return caller;
}

async function adminConnection(database: Database, connectionId: string, userId: string) {
  const connection = await database.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration connection not found");
  await requireInstanceAdmin(database, userId);
  return connection;
}

async function ownedConnection(database: Database, connectionId: string, userId: string) {
  const connection = await database.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration connection not found");
  await requireOwner(database, connection.workspaceId, userId);
  return connection;
}

async function memberConnection(database: Database, connectionId: string, userId: string) {
  const connection = await database.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration connection not found");
  const member = await database.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: connection.workspaceId } },
    select: { id: true },
  });
  if (!member) throw new AppError(403, "FORBIDDEN", "Workspace membership is required");
  return { connection, member };
}

function providerMapsFromConnection(connection: {
  statusMapRead: unknown;
  statusMapWrite: unknown;
}) {
  const readMap =
    connection.statusMapRead &&
    typeof connection.statusMapRead === "object" &&
    !Array.isArray(connection.statusMapRead)
      ? (connection.statusMapRead as Record<string, string>)
      : null;
  const writeMap =
    connection.statusMapWrite &&
    typeof connection.statusMapWrite === "object" &&
    !Array.isArray(connection.statusMapWrite)
      ? (connection.statusMapWrite as Record<string, string>)
      : null;
  const timeActivityId =
    writeMap && typeof writeMap[TIME_ENTRY_ACTIVITY_MAP_KEY] === "string"
      ? writeMap[TIME_ENTRY_ACTIVITY_MAP_KEY]
      : null;
  return { readMap, writeMap, timeActivityId };
}

async function upsertExternalIdentities(
  database: Database,
  connectionId: string,
  memberId: string,
  remoteUserId: string,
  remoteLogin: string | null,
  remoteDisplayName?: string | null,
) {
  const bindings = await database.integrationProjectBinding.findMany({
    where: { connectionId },
    select: { id: true },
  });
  for (const binding of bindings) {
    const [remoteIdentity, memberIdentity] = await Promise.all([
      database.integrationExternalIdentity.findUnique({
        where: { bindingId_remoteUserId: { bindingId: binding.id, remoteUserId } },
        select: { id: true, memberId: true },
      }),
      database.integrationExternalIdentity.findUnique({
        where: { bindingId_memberId: { bindingId: binding.id, memberId } },
        select: { id: true },
      }),
    ]);
    try {
      if (remoteIdentity) {
        if (memberIdentity && memberIdentity.id !== remoteIdentity.id) {
          await database.integrationExternalIdentity.update({
            where: { id: memberIdentity.id },
            data: { memberId: null },
          });
        }
        const claimed = await database.integrationExternalIdentity.updateMany({
          where: {
            id: remoteIdentity.id,
            OR: [{ memberId: null }, { memberId }],
          },
          data: {
            memberId,
            remoteLogin,
            ...(remoteDisplayName === undefined ? {} : { remoteDisplayName }),
          },
        });
        if (claimed.count !== 1) {
          throw new AppError(
            409,
            "REMOTE_IDENTITY_ALREADY_CONNECTED",
            "This provider identity is already connected to another workspace member",
          );
        }
      } else if (memberIdentity) {
        await database.integrationExternalIdentity.update({
          where: { id: memberIdentity.id },
          data: {
            remoteUserId,
            remoteLogin,
            ...(remoteDisplayName === undefined ? {} : { remoteDisplayName }),
          },
        });
      } else {
        await database.integrationExternalIdentity.create({
          data: {
            bindingId: binding.id,
            memberId,
            remoteUserId,
            remoteLogin,
            remoteDisplayName: remoteDisplayName ?? null,
          },
        });
      }
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        throw new AppError(
          409,
          "REMOTE_IDENTITY_ALREADY_CONNECTED",
          "This provider identity is already connected to another workspace member",
        );
      }
      throw error;
    }
  }
}

async function serviceCredential(database: Database, connection: { id: string; serviceCredentialId: string | null }) {
  const credential = connection.serviceCredentialId
    ? await database.memberIntegrationCredential.findUnique({ where: { id: connection.serviceCredentialId } })
    : null;
  if (
    !credential ||
    credential.connectionId !== connection.id ||
    credential.lastAuthStatus !== "valid" ||
    credential.revokedAt
  ) {
    throw new AppError(409, "INTEGRATION_NOT_READY", "A valid service credential is required");
  }
  return credential;
}

export async function createConnection(
  input: { workspaceId: string; apiKey: string },
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  await requireInstanceAdmin(prisma, userId);
  const existing = await prisma.integrationConnection.findUnique({
    where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: "redmine" } },
    select: { lifecycle: true },
  });
  if (existing && existing.lifecycle !== "draft") {
    throw new AppError(409, "INTEGRATION_ALREADY_CONFIGURED", "Only a draft connection can be bootstrapped again");
  }
  const settings = await prisma.instanceSettings.findUnique({
    where: { id: INSTANCE_SETTINGS_ID },
    select: { redmineBaseUrl: true },
  });
  const baseUrl = settings?.redmineBaseUrl;
  if (!baseUrl) {
    throw new AppError(
      409,
      "REDMINE_NOT_CONFIGURED",
      "An instance admin must configure the Redmine URL first",
    );
  }
  const [identity, statuses, projects, timeEntryActivities] = await queryRedmine(() => {
    const remote = deps.remote(baseUrl, input.apiKey);
    return Promise.all([
      remote.whoAmI(),
      remote.listStatuses(),
      remote.listProjects(),
      remote.listTimeEntryActivities(),
    ]);
  });
  const encryptedKey = deps.encrypt(input.apiKey);
  const discoveredStatuses = statuses.map(({ id, name, writable }) => ({ id, name, writable }));

  const connection = await prisma.$transaction(async (transaction) => {
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "instance_settings" WHERE "id" = ${INSTANCE_SETTINGS_ID}::uuid FOR UPDATE`,
    );
    await requireInstanceAdmin(transaction, userId);
    const serviceMember = await resolveServiceCredentialMember(
      transaction,
      input.workspaceId,
      userId,
    );
    const current = await transaction.integrationConnection.findUnique({
      where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: "redmine" } },
      select: { lifecycle: true },
    });
    if (current && current.lifecycle !== "draft") {
      throw new AppError(409, "INTEGRATION_ALREADY_CONFIGURED", "Only a draft connection can be bootstrapped again");
    }
    const currentSettings = await transaction.instanceSettings.findUnique({
      where: { id: INSTANCE_SETTINGS_ID },
      select: { redmineBaseUrl: true },
    });
    if (currentSettings?.redmineBaseUrl !== baseUrl) {
      throw new AppError(409, "REDMINE_URL_CHANGED", "The Redmine URL changed; test the connection again");
    }
    const draft = await transaction.integrationConnection.upsert({
      where: { workspaceId_provider: { workspaceId: input.workspaceId, provider: "redmine" } },
      create: {
        workspaceId: input.workspaceId,
        provider: "redmine",
        baseUrl,
        discoveredStatuses,
      },
      update: { baseUrl, discoveredStatuses },
    });
    const credential = await transaction.memberIntegrationCredential.upsert({
      where: { memberId_connectionId: { memberId: serviceMember.id, connectionId: draft.id } },
      create: {
        memberId: serviceMember.id,
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

  return { connection, discovery: { statuses, projects, timeEntryActivities } };
}

async function lockConnection(transaction: Prisma.TransactionClient, connectionId: string) {
  await transaction.$queryRaw(
    Prisma.sql`SELECT "id" FROM "integration_connections" WHERE "id" = ${connectionId}::uuid FOR UPDATE`,
  );
}

async function redriveAuthBlockedWork(
  transaction: Prisma.TransactionClient,
  connectionId: string,
  replacementCredentialId: string,
  scope:
    | { kind: "personal"; memberId: string; rejectedCredentialId: string }
    | { kind: "service" },
) {
  const now = new Date();
  const where: Prisma.IntegrationSyncWorkWhereInput = {
    binding: { connectionId },
    skippedReason: "credential_invalid",
    ...(scope.kind === "personal"
      ? {
          actorKind: "user",
          actorKey: `member:${scope.memberId}`,
          authCredentialId: scope.rejectedCredentialId,
        }
      : { actorKind: { in: ["system", "ai"] } }),
  };
  const bindings = await transaction.integrationProjectBinding.findMany({
    where: { connectionId },
    select: { id: true, lifecycleEpoch: true },
  });
  for (const binding of bindings) {
    await transaction.integrationSyncWork.updateMany({
      where: { ...where, bindingId: binding.id, state: "dead" },
      data: {
        state: "retry",
        epoch: binding.lifecycleEpoch,
        availableAt: now,
        skippedReason: null,
        authCredentialId: replacementCredentialId,
      },
    });
    await transaction.integrationSyncWork.updateMany({
      where: { ...where, bindingId: binding.id, state: "ambiguous" },
      data: {
        epoch: binding.lifecycleEpoch,
        availableAt: now,
        skippedReason: null,
        authCredentialId: replacementCredentialId,
      },
    });
  }
}

export async function getConnectionDiscovery(
  connectionId: string,
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const connection = await prisma.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration connection not found");

  const admin = await isInstanceAdminUser(prisma, userId);
  if (!admin) {
    // Workspace owners may list remote projects only (for project association).
    await requireOwner(prisma, connection.workspaceId, userId);
  }

  const credential = await serviceCredential(prisma, connection);
  const [statuses, projects, timeEntryActivities] = await queryRedmine(() => {
    const remote = deps.remote(connection.baseUrl, deps.decrypt(credential.encryptedKey));
    return Promise.all([remote.listStatuses(), remote.listProjects(), remote.listTimeEntryActivities()]);
  });
  const discoveredStatuses = statuses.map(({ id, name, writable }) => ({ id, name, writable }));
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: { discoveredStatuses },
  });

  if (!admin) {
    return { projects, statuses: [], timeEntryActivities: [] };
  }
  return { statuses, projects, timeEntryActivities };
}

/** Instance-admin: persist global status/activity maps on the connection and cascade to bindings. */
export async function configureProviderMaps(
  connectionId: string,
  input: {
    timeActivityId: string;
    readMap: Readonly<Record<string, string>>;
    writeMap: Readonly<Record<string, string>>;
  },
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const connection = await adminConnection(prisma, connectionId, userId);
  const credential = await serviceCredential(prisma, connection);
  const [statuses, timeEntryActivities] = await queryRedmine(() => {
    const remote = deps.remote(connection.baseUrl, deps.decrypt(credential.encryptedKey));
    return Promise.all([remote.listStatuses(), remote.listTimeEntryActivities()]);
  });
  if (!timeEntryActivities.some(({ id }) => id === input.timeActivityId)) {
    throw new AppError(400, "REMOTE_TIME_ACTIVITY_NOT_FOUND", "Select a time activity returned by discovery");
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

  const writeMap = {
    ...input.writeMap,
    [TIME_ENTRY_ACTIVITY_MAP_KEY]: input.timeActivityId,
  };
  const discoveredStatuses = statuses.map(({ id, name, writable }) => ({ id, name, writable }));

  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const current = await adminConnection(transaction, connectionId, userId);
    const updated = await transaction.integrationConnection.update({
      where: { id: connectionId },
      data: {
        discoveredStatuses,
        statusMapRead: input.readMap as Prisma.InputJsonValue,
        statusMapWrite: writeMap as Prisma.InputJsonValue,
        ...(current.lifecycle !== "draft"
          ? { lifecycle: "draft" as const, lifecycleEpoch: { increment: 1 } }
          : {}),
      },
    });
    await transaction.integrationProjectBinding.updateMany({
      where: { connectionId, lifecycle: { not: "draft" } },
      data: {
        readMap: input.readMap as Prisma.InputJsonValue,
        writeMap: writeMap as Prisma.InputJsonValue,
        lifecycle: "draft",
        lifecycleEpoch: { increment: 1 },
      },
    });
    await transaction.integrationProjectBinding.updateMany({
      where: { connectionId, lifecycle: "draft" },
      data: {
        readMap: input.readMap as Prisma.InputJsonValue,
        writeMap: writeMap as Prisma.InputJsonValue,
      },
    });
    return updated;
  });
}

/** Workspace owner: associate a Kanon project with one discovered Redmine project. */
export async function bindProject(
  connectionId: string,
  input: { projectId: string; remoteProjectId: string },
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const connection = await ownedConnection(prisma, connectionId, userId);
  const maps = providerMapsFromConnection(connection);
  if (!maps.readMap || !maps.writeMap || !maps.timeActivityId) {
    throw new AppError(
      409,
      "PROVIDER_MAPS_REQUIRED",
      "An instance admin must configure Redmine status and activity maps first",
    );
  }
  const credential = await serviceCredential(prisma, connection);
  const projects = await queryRedmine(() =>
    deps.remote(connection.baseUrl, deps.decrypt(credential.encryptedKey)).listProjects(),
  );
  if (!projects.some(({ id }) => id === input.remoteProjectId)) {
    throw new AppError(400, "REMOTE_PROJECT_NOT_FOUND", "Select a project returned by discovery");
  }

  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const current = await ownedConnection(transaction, connectionId, userId);
    const currentMaps = providerMapsFromConnection(current);
    if (!currentMaps.readMap || !currentMaps.writeMap) {
      throw new AppError(
        409,
        "PROVIDER_MAPS_REQUIRED",
        "An instance admin must configure Redmine status and activity maps first",
      );
    }
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
        readMap: currentMaps.readMap as Prisma.InputJsonValue,
        writeMap: currentMaps.writeMap as Prisma.InputJsonValue,
      },
      update: {
        remoteProjectId: input.remoteProjectId,
        readMap: currentMaps.readMap as Prisma.InputJsonValue,
        writeMap: currentMaps.writeMap as Prisma.InputJsonValue,
        lifecycle: "draft",
        lifecycleEpoch: { increment: 1 },
      },
    });
    const credentials = await transaction.memberIntegrationCredential.findMany({
      where: { connectionId, externalUserId: { not: null } },
      select: { memberId: true, externalUserId: true, externalLogin: true },
    });
    for (const credential of credentials) {
      await upsertExternalIdentities(
        transaction,
        connectionId,
        credential.memberId,
        credential.externalUserId!,
        credential.externalLogin,
      );
    }
    if (current.lifecycle !== "draft") {
      await transaction.integrationConnection.update({
        where: { id: connectionId },
        data: { lifecycle: "draft", lifecycleEpoch: { increment: 1 } },
      });
    }
    return binding;
  });
}

/**
 * Instance-admin convenience: set provider maps and bind a project in one call.
 * Prefer configureProviderMaps + bindProject for the split UI flows.
 */
export async function configureConnection(
  connectionId: string,
  input: {
    projectId: string;
    remoteProjectId: string;
    timeActivityId: string;
    readMap: Readonly<Record<string, string>>;
    writeMap: Readonly<Record<string, string>>;
  },
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  await configureProviderMaps(
    connectionId,
    {
      timeActivityId: input.timeActivityId,
      readMap: input.readMap,
      writeMap: input.writeMap,
    },
    userId,
    deps,
  );
  // bindProject requires workspace owner; instance admin may not be owner — bind as admin path
  return bindProjectAsAdmin(connectionId, { projectId: input.projectId, remoteProjectId: input.remoteProjectId }, userId, deps);
}

async function bindProjectAsAdmin(
  connectionId: string,
  input: { projectId: string; remoteProjectId: string },
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const connection = await adminConnection(prisma, connectionId, userId);
  const maps = providerMapsFromConnection(connection);
  if (!maps.readMap || !maps.writeMap) {
    throw new AppError(
      409,
      "PROVIDER_MAPS_REQUIRED",
      "An instance admin must configure Redmine status and activity maps first",
    );
  }
  const credential = await serviceCredential(prisma, connection);
  const projects = await queryRedmine(() =>
    deps.remote(connection.baseUrl, deps.decrypt(credential.encryptedKey)).listProjects(),
  );
  if (!projects.some(({ id }) => id === input.remoteProjectId)) {
    throw new AppError(400, "REMOTE_PROJECT_NOT_FOUND", "Select a project returned by discovery");
  }

  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const current = await adminConnection(transaction, connectionId, userId);
    const currentMaps = providerMapsFromConnection(current);
    if (!currentMaps.readMap || !currentMaps.writeMap) {
      throw new AppError(
        409,
        "PROVIDER_MAPS_REQUIRED",
        "An instance admin must configure Redmine status and activity maps first",
      );
    }
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
        readMap: currentMaps.readMap as Prisma.InputJsonValue,
        writeMap: currentMaps.writeMap as Prisma.InputJsonValue,
      },
      update: {
        remoteProjectId: input.remoteProjectId,
        readMap: currentMaps.readMap as Prisma.InputJsonValue,
        writeMap: currentMaps.writeMap as Prisma.InputJsonValue,
        lifecycle: "draft",
        lifecycleEpoch: { increment: 1 },
      },
    });
    const credentials = await transaction.memberIntegrationCredential.findMany({
      where: { connectionId, externalUserId: { not: null } },
      select: { memberId: true, externalUserId: true, externalLogin: true },
    });
    for (const credential of credentials) {
      await upsertExternalIdentities(
        transaction,
        connectionId,
        credential.memberId,
        credential.externalUserId!,
        credential.externalLogin,
      );
    }
    if (current.lifecycle !== "draft") {
      await transaction.integrationConnection.update({
        where: { id: connectionId },
        data: { lifecycle: "draft", lifecycleEpoch: { increment: 1 } },
      });
    }
    return binding;
  });
}

async function assertActivationReady(database: Database, connection: { id: string; serviceCredentialId: string | null; discoveredStatuses: unknown }) {
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
  return (
    typeof writeMap[TIME_ENTRY_ACTIVITY_MAP_KEY] === "string" &&
    WRITABLE_STATES.every(
      (state) => typeof writeMap[state] === "string" && writableIds.has(writeMap[state] as string),
    )
  );
}

export async function setConnectionLifecycle(
  connectionId: string,
  lifecycle: "active" | "paused" | "disabled",
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const current = await adminConnection(prisma, connectionId, userId);
  if (current.lifecycle === lifecycle) return current;
  if (lifecycle === "active") {
    const credential = await assertActivationReady(prisma, current);
    await queryRedmine(() =>
      deps.remote(current.baseUrl, deps.decrypt(credential.encryptedKey)).whoAmI(),
    );
  }

  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const locked = await adminConnection(transaction, connectionId, userId);
    if (locked.lifecycle === lifecycle) return locked;
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
    const preservesPausedWork =
      (locked.lifecycle === "active" && lifecycle === "paused") ||
      (locked.lifecycle === "paused" && lifecycle === "active");
    if (preservesPausedWork) {
      await transaction.$executeRaw(
        Prisma.sql`
          UPDATE "integration_sync_work" AS work
          SET "epoch" = binding."lifecycle_epoch", "updated_at" = clock_timestamp()
          FROM "integration_project_bindings" AS binding
          WHERE work."binding_id" = binding."id"
            AND binding."connection_id" = ${connectionId}::uuid
            AND work."epoch" = binding."lifecycle_epoch" - 1
            AND work."state" IN (
              'queued'::"SyncWorkState",
              'retry'::"SyncWorkState",
              'leased'::"SyncWorkState",
              'ambiguous'::"SyncWorkState"
            )
        `,
      );
    }
    return connection;
  });
}

function publicCredential(
  credential: {
    externalUserId: string | null;
    externalLogin: string | null;
    lastValidatedAt: Date | null;
    lastAuthStatus: string;
    revokedAt: Date | null;
  } | null,
) {
  if (!credential) {
    return {
      connected: false,
      status: "missing",
      externalUserId: null,
      externalLogin: null,
      lastValidatedAt: null,
      revokedAt: null,
    };
  }
  return {
    connected: credential.lastAuthStatus === "valid" && credential.revokedAt === null,
    status: credential.lastAuthStatus,
    externalUserId: credential.externalUserId,
    externalLogin: credential.externalLogin,
    lastValidatedAt: credential.lastValidatedAt,
    revokedAt: credential.revokedAt,
  };
}

export async function connectCredential(
  connectionId: string,
  apiKey: string,
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const { connection, member } = await memberConnection(prisma, connectionId, userId);
  const existing = await prisma.memberIntegrationCredential.findUnique({
    where: { memberId_connectionId: { memberId: member.id, connectionId } },
    select: { id: true },
  });
  if (existing?.id === connection.serviceCredentialId) {
    return replaceServiceCredential(connectionId, apiKey, userId, deps);
  }
  const identity = await queryRedmine(() => deps.remote(connection.baseUrl, apiKey).whoAmI());
  const encryptedKey = deps.encrypt(apiKey);
  const validatedAt = new Date();

  try {
    const credential = await prisma.$transaction(async (transaction) => {
      await lockConnection(transaction, connectionId);
      const current = await memberConnection(transaction, connectionId, userId);
      const currentCredential = await transaction.memberIntegrationCredential.findUnique({
        where: {
          memberId_connectionId: { memberId: current.member.id, connectionId },
        },
        select: { id: true },
      });
      if (currentCredential?.id === current.connection.serviceCredentialId) {
        throw new AppError(
          409,
          "SERVICE_CREDENTIAL_REQUIRES_ADMIN",
          "Replace the service credential from instance administration",
        );
      }
      const saved = await transaction.memberIntegrationCredential.upsert({
        where: {
          memberId_connectionId: { memberId: current.member.id, connectionId },
        },
        create: {
          memberId: current.member.id,
          connectionId,
          encryptedKey,
          externalUserId: identity.id,
          externalLogin: identity.login ?? null,
          lastValidatedAt: validatedAt,
          lastAuthStatus: "valid",
        },
        update: {
          encryptedKey,
          externalUserId: identity.id,
          externalLogin: identity.login ?? null,
          lastValidatedAt: validatedAt,
          lastAuthStatus: "valid",
          revokedAt: null,
        },
      });
      await upsertExternalIdentities(
        transaction,
        connectionId,
        current.member.id,
        identity.id,
        identity.login ?? null,
        identity.displayName,
      );
      await redriveAuthBlockedWork(transaction, connectionId, saved.id, {
        kind: "personal",
        memberId: current.member.id,
        rejectedCredentialId: saved.id,
      });
      return saved;
    });
    return publicCredential(credential);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        409,
        "REMOTE_IDENTITY_ALREADY_CONNECTED",
        "This provider identity is already connected to another workspace member",
      );
    }
    throw error;
  }
}

export async function replaceServiceCredential(
  connectionId: string,
  apiKey: string,
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
) {
  const connection = await adminConnection(prisma, connectionId, userId);
  await resolveServiceCredentialMember(prisma, connection.workspaceId, userId);
  const identity = await queryRedmine(() => deps.remote(connection.baseUrl, apiKey).whoAmI());
  const encryptedKey = deps.encrypt(apiKey);
  const validatedAt = new Date();

  try {
    const credential = await prisma.$transaction(async (transaction) => {
      await lockConnection(transaction, connectionId);
      const current = await adminConnection(transaction, connectionId, userId);
      const serviceMember = await resolveServiceCredentialMember(
        transaction,
        current.workspaceId,
        userId,
      );
      const saved = await transaction.memberIntegrationCredential.upsert({
        where: { memberId_connectionId: { memberId: serviceMember.id, connectionId } },
        create: {
          memberId: serviceMember.id,
          connectionId,
          encryptedKey,
          externalUserId: identity.id,
          externalLogin: identity.login ?? null,
          lastValidatedAt: validatedAt,
          lastAuthStatus: "valid",
        },
        update: {
          encryptedKey,
          externalUserId: identity.id,
          externalLogin: identity.login ?? null,
          lastValidatedAt: validatedAt,
          lastAuthStatus: "valid",
          revokedAt: null,
        },
      });
      await transaction.integrationExternalIdentity.updateMany({
        where: {
          binding: { connectionId },
          memberId: { not: serviceMember.id },
          remoteUserId: identity.id,
        },
        data: { memberId: null },
      });
      await upsertExternalIdentities(
        transaction,
        connectionId,
        serviceMember.id,
        identity.id,
        identity.login ?? null,
        identity.displayName,
      );
      await transaction.integrationConnection.update({
        where: { id: connectionId },
        data: { serviceCredentialId: saved.id },
      });
      await redriveAuthBlockedWork(transaction, connectionId, saved.id, { kind: "service" });
      await redriveAuthBlockedWork(transaction, connectionId, saved.id, {
        kind: "personal",
        memberId: serviceMember.id,
        rejectedCredentialId: saved.id,
      });
      return saved;
    });
    return publicCredential(credential);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw new AppError(
        409,
        "REMOTE_IDENTITY_ALREADY_CONNECTED",
        "This provider identity is already connected to another workspace member",
      );
    }
    throw error;
  }
}

export async function clearCredential(connectionId: string, userId: string) {
  const { member } = await memberConnection(prisma, connectionId, userId);
  await prisma.memberIntegrationCredential.updateMany({
    where: { connectionId, memberId: member.id },
    data: { lastAuthStatus: "revoked", revokedAt: new Date() },
  });
  const credential = await prisma.memberIntegrationCredential.findUnique({
    where: { memberId_connectionId: { memberId: member.id, connectionId } },
  });
  return publicCredential(credential);
}

export async function getWorkspaceConnection(workspaceId: string, userId: string) {
  const admin = await isInstanceAdminUser(prisma, userId);
  if (!admin) {
    const member = await prisma.member.findUnique({
      where: { userId_workspaceId: { userId, workspaceId } },
      select: { id: true },
    });
    if (!member) throw new AppError(403, "FORBIDDEN", "Workspace membership is required");
  }
  const connection = await prisma.integrationConnection.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "redmine" } },
    select: { id: true },
  });
  return connection ? getConnection(connection.id, userId) : null;
}

export async function getConnection(connectionId: string, userId: string) {
  const admin = await isInstanceAdminUser(prisma, userId);
  const connection = await prisma.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection) throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration connection not found");

  const member = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: connection.workspaceId } },
    select: { id: true, role: true },
  });
  if (!admin && !member) {
    throw new AppError(403, "FORBIDDEN", "Workspace membership is required");
  }
  const memberId = member?.id ?? null;
  const operator = admin || member?.role === "owner";
  const authBlockedWhere = {
    binding: { connectionId },
    skippedReason: "credential_invalid",
    state: { in: ["dead", "ambiguous"] },
  } satisfies Prisma.IntegrationSyncWorkWhereInput;

  const [
    credential,
    bindings,
    workspaceMembers,
    externalIdentities,
    connectedCredentials,
    serviceCredentialRecord,
    blockedWorkTotal,
    blockedWork,
  ] = await Promise.all([
      memberId
        ? prisma.memberIntegrationCredential.findUnique({
            where: { memberId_connectionId: { memberId, connectionId } },
          })
        : Promise.resolve(null),
      prisma.integrationProjectBinding.findMany({
        where: { connectionId },
        orderBy: { id: "asc" },
        select: {
          id: true,
          projectId: true,
          remoteProjectId: true,
          readMap: true,
          writeMap: true,
          lifecycle: true,
          lifecycleEpoch: true,
        },
      }),
      prisma.member.count({ where: { workspaceId: connection.workspaceId } }),
      prisma.integrationExternalIdentity.count({
        where: { binding: { connectionId } },
      }),
      prisma.memberIntegrationCredential.findMany({
        where: { connectionId, lastAuthStatus: "valid", revokedAt: null },
        select: { memberId: true },
      }),
      connection.serviceCredentialId
        ? prisma.memberIntegrationCredential.findFirst({
            where: { id: connection.serviceCredentialId, connectionId },
            select: { lastAuthStatus: true, revokedAt: true },
          })
        : Promise.resolve(null),
      prisma.integrationSyncWork.count({ where: authBlockedWhere }),
      operator
        ? prisma.integrationSyncWork.findMany({
            where: authBlockedWhere,
            orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
            take: 20,
            select: {
              id: true,
              entityType: true,
              entityId: true,
              operation: true,
              state: true,
              updatedAt: true,
            },
          })
        : Promise.resolve([]),
    ]);
  const providerMaps = providerMapsFromConnection(connection);
  const serviceCredentialStatus = serviceCredentialRecord
    ? serviceCredentialRecord.revokedAt
      ? "revoked"
      : serviceCredentialRecord.lastAuthStatus
    : "missing";
  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    lifecycle: connection.lifecycle,
    lifecycleEpoch: connection.lifecycleEpoch,
    serviceFallbackEnabled: connection.serviceFallbackEnabled,
    serviceCredentialStatus,
    syncHealth: {
      status:
        serviceCredentialStatus !== "valid" || blockedWorkTotal > 0
          ? ("credential_blocked" as const)
          : ("healthy" as const),
      blockedWork: operator ? { total: blockedWorkTotal, items: blockedWork } : null,
    },
    discoveredStatuses: admin ? connection.discoveredStatuses : null,
    providerMaps: admin
      ? {
          readMap: providerMaps.readMap,
          writeMap: providerMaps.writeMap
            ? Object.fromEntries(
                Object.entries(providerMaps.writeMap).filter(([key]) => key !== TIME_ENTRY_ACTIVITY_MAP_KEY),
              )
            : null,
          timeActivityId: providerMaps.timeActivityId,
        }
      : null,
    bindings: bindings.map((binding) => ({
      id: binding.id,
      projectId: binding.projectId,
      remoteProjectId: binding.remoteProjectId,
      readMap: admin ? binding.readMap : {},
      writeMap: admin ? binding.writeMap : {},
      timeActivityId: admin
        ? binding.writeMap &&
          typeof binding.writeMap === "object" &&
          !Array.isArray(binding.writeMap) &&
          typeof binding.writeMap[TIME_ENTRY_ACTIVITY_MAP_KEY] === "string"
          ? binding.writeMap[TIME_ENTRY_ACTIVITY_MAP_KEY]
          : null
        : null,
      lifecycle: binding.lifecycle,
      lifecycleEpoch: binding.lifecycleEpoch,
    })),
    callerCredential: publicCredential(credential),
    connectedMemberIds: connectedCredentials.map(({ memberId }) => memberId),
    counts: {
      workspaceMembers,
      validCredentials: connectedCredentials.length,
      externalIdentities,
    },
  };
}

export async function reencryptCredentials(
  options: {
    oldKey: Buffer;
    newKey: Buffer;
    dryRun?: boolean;
    batchSize?: number;
  },
  database: typeof prisma = prisma,
) {
  if (options.oldKey.equals(options.newKey)) {
    throw new Error("Old and new integration encryption keys must differ");
  }
  const batchSize = options.batchSize ?? 100;
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("Batch size must be positive");
  const credentials = await database.memberIntegrationCredential.findMany({
    orderBy: { id: "asc" },
    select: { id: true, encryptedKey: true },
  });
  const pending: Array<{ id: string; encryptedKey: string }> = [];
  const invalid: string[] = [];
  let alreadyRotated = 0;

  for (const credential of credentials) {
    try {
      const plaintext = decryptCredential(credential.encryptedKey, options.oldKey);
      pending.push({ id: credential.id, encryptedKey: encryptCredential(plaintext, options.newKey) });
    } catch {
      try {
        decryptCredential(credential.encryptedKey, options.newKey);
        alreadyRotated += 1;
      } catch {
        invalid.push(credential.id);
      }
    }
  }
  if (invalid.length > 0) {
    throw new Error(`Undecryptable integration credentials: ${invalid.join(", ")}`);
  }
  if (options.dryRun) {
    return { total: credentials.length, pending: pending.length, alreadyRotated, updated: 0 };
  }
  for (let offset = 0; offset < pending.length; offset += batchSize) {
    const batch = pending.slice(offset, offset + batchSize);
    await database.$transaction(
      batch.map((credential) =>
        database.memberIntegrationCredential.update({
          where: { id: credential.id },
          data: { encryptedKey: credential.encryptedKey },
        }),
      ),
    );
  }
  return {
    total: credentials.length,
    pending: pending.length,
    alreadyRotated,
    updated: pending.length,
  };
}
