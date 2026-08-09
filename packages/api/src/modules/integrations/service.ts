import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
import { prisma } from "../../config/prisma.js";
import { AppError } from "../../shared/types.js";
import { INSTANCE_SETTINGS_ID } from "../../shared/constants.js";
import { decrypt as decryptCredential, encrypt as encryptCredential } from "./core/crypto.js";
import {
  TIME_ENTRY_ACTIVITY_MAP_KEY,
  type DiscoveredPriority,
  type DiscoveredProject,
  type DiscoveredStatus,
  type DiscoveredTimeEntryActivity,
  type DiscoveredUser,
} from "./core/types.js";
import { PRIORITY_MAP_PREFIX, priorityReadKey, priorityWriteKey } from "./issue-convergence.js";
import { RedmineProviderAdapter } from "./providers/redmine/adapter.js";
import { RedmineHttpClient } from "./providers/redmine/http-client.js";

const WRITABLE_STATES = ["backlog", "analysis", "todo", "in_progress", "review", "done"] as const;
const ISSUE_PRIORITIES = ["critical", "high", "medium", "low"] as const;

interface RemoteDiscovery {
  whoAmI(): Promise<DiscoveredUser>;
  listStatuses(): Promise<readonly DiscoveredStatus[]>;
  listPriorities?(): Promise<readonly DiscoveredPriority[]>;
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

async function requireOwner(database: Database, workspaceId: string, userId: string) {
  const member = await database.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true, role: true },
  });
  if (!member || member.role !== "owner") {
    throw new AppError(403, "FORBIDDEN", "Workspace owner access required");
  }
  return member;
}

/** Service credential holder must be the configuring owner's workspace membership. */
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

export async function ownedConnection(
  database: Database,
  connectionId: string,
  userId: string,
  workspaceId?: string,
) {
  const connection = await database.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection || (workspaceId && connection.workspaceId !== workspaceId)) {
    throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration connection not found");
  }
  await requireOwner(database, connection.workspaceId, userId);
  return connection;
}

async function memberConnection(
  database: Database,
  connectionId: string,
  userId: string,
  workspaceId?: string,
) {
  const connection = await database.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection || (workspaceId && connection.workspaceId !== workspaceId)) {
    throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration connection not found");
  }
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
    where: { connectionId, releaseRequestedAt: null, releasedAt: null },
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

export async function serviceCredential(
  database: Database,
  connection: {
    id: string;
    workspaceId: string;
    serviceCredentialId: string | null;
  },
) {
  const credential = connection.serviceCredentialId
    ? await database.memberIntegrationCredential.findUnique({
        where: { id: connection.serviceCredentialId },
        include: { member: { select: { workspaceId: true, role: true } } },
      })
    : null;
  if (
    !credential ||
    credential.connectionId !== connection.id ||
    credential.member.workspaceId !== connection.workspaceId ||
    credential.member.role !== "owner" ||
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
  await requireOwner(prisma, input.workspaceId, userId);
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
    await requireOwner(transaction, input.workspaceId, userId);
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

async function lockRemoteProject(
  transaction: Prisma.TransactionClient,
  connection: { provider: string; baseUrl: string },
  remoteProjectId: string,
) {
  const key = JSON.stringify([connection.provider, connection.baseUrl, remoteProjectId]);
  await transaction.$queryRaw(
    Prisma.sql`SELECT 1::int AS "locked" FROM (SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))) AS advisory_lock`,
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
    where: { connectionId, releasedAt: null },
    select: { id: true, lifecycleEpoch: true, releaseRequestedAt: true },
  });
  for (const binding of bindings) {
    if (binding.releaseRequestedAt) {
      await transaction.integrationSyncWork.updateMany({
        where: { ...where, bindingId: binding.id, state: "ambiguous" },
        data: {
          availableAt: now,
          skippedReason: null,
          authCredentialId: replacementCredentialId,
        },
      });
      continue;
    }
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
  workspaceId?: string,
) {
  const connection = await ownedConnection(prisma, connectionId, userId, workspaceId);

  const credential = await serviceCredential(prisma, connection);
  const [statuses, priorities, projects, timeEntryActivities] = await queryRedmine(() => {
    const remote = deps.remote(connection.baseUrl, deps.decrypt(credential.encryptedKey));
    return Promise.all([
      remote.listStatuses(),
      remote.listPriorities?.() ?? Promise.resolve([]),
      remote.listProjects(),
      remote.listTimeEntryActivities(),
    ]);
  });
  const discoveredStatuses = statuses.map(({ id, name, writable }) => ({ id, name, writable }));
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: { discoveredStatuses },
  });

  return { statuses, priorities, projects, timeEntryActivities };
}

/** Workspace owner: persist provider maps on the connection and current bindings. */
export async function configureProviderMaps(
  connectionId: string,
  input: {
    timeActivityId: string;
    readMap: Readonly<Record<string, string>>;
    writeMap: Readonly<Record<string, string>>;
    priorityReadMap?: Readonly<Record<string, string>>;
    priorityWriteMap?: Readonly<Record<string, string>>;
  },
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
  workspaceId?: string,
) {
  const connection = await ownedConnection(prisma, connectionId, userId, workspaceId);
  const credential = await serviceCredential(prisma, connection);
  const [statuses, priorities, timeEntryActivities] = await queryRedmine(() => {
    const remote = deps.remote(connection.baseUrl, deps.decrypt(credential.encryptedKey));
    return Promise.all([
      remote.listStatuses(),
      remote.listPriorities?.() ?? Promise.resolve([]),
      remote.listTimeEntryActivities(),
    ]);
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

  const existingMaps = providerMapsFromConnection(connection);
  const existingRead = existingMaps.readMap ?? {};
  const existingWrite = existingMaps.writeMap ?? {};
  const priorityReadMap =
    input.priorityReadMap ??
    Object.fromEntries(
      Object.entries(existingRead)
        .filter(([key]) => key.startsWith(PRIORITY_MAP_PREFIX))
        .map(([key, value]) => [key.slice(PRIORITY_MAP_PREFIX.length), value]),
    );
  const priorityWriteMap =
    input.priorityWriteMap ??
    Object.fromEntries(
      Object.entries(existingWrite)
        .filter(([key]) => key.startsWith(PRIORITY_MAP_PREFIX))
        .map(([key, value]) => [key.slice(PRIORITY_MAP_PREFIX.length), value]),
    );
  const priorityIds = new Set(priorities.map(({ id }) => id));
  const validPriority = (value: unknown) =>
    ISSUE_PRIORITIES.includes(value as (typeof ISSUE_PRIORITIES)[number]);
  if (
    priorities.length === 0 ||
    priorities.some(({ id }) => !validPriority(priorityReadMap[id])) ||
    ISSUE_PRIORITIES.some((priority) => {
      const remoteId = priorityWriteMap[priority];
      return typeof remoteId !== "string" || !priorityIds.has(remoteId);
    }) ||
    Object.entries(priorityReadMap).some(
      ([remoteId, priority]) => !priorityIds.has(remoteId) || !validPriority(priority),
    ) ||
    Object.entries(priorityWriteMap).some(
      ([priority, remoteId]) => !validPriority(priority) || !priorityIds.has(remoteId),
    )
  ) {
    throw new AppError(
      400,
      "INVALID_PRIORITY_MAP",
      "Priority maps must cover every discovered and Kanon priority",
    );
  }

  const readMap = {
    ...input.readMap,
    ...Object.fromEntries(
      Object.entries(priorityReadMap).map(([remoteId, priority]) => [priorityReadKey(remoteId), priority]),
    ),
  };

  const writeMap = {
    ...input.writeMap,
    ...Object.fromEntries(
      Object.entries(priorityWriteMap).map(([priority, remoteId]) => [
        priorityWriteKey(priority as (typeof ISSUE_PRIORITIES)[number]),
        remoteId,
      ]),
    ),
    [TIME_ENTRY_ACTIVITY_MAP_KEY]: input.timeActivityId,
  };
  const discoveredStatuses = statuses.map(({ id, name, writable }) => ({ id, name, writable }));

  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const current = await ownedConnection(transaction, connectionId, userId, workspaceId);
    const releasePending = await transaction.integrationProjectBinding.count({
      where: { connectionId, releaseRequestedAt: { not: null }, releasedAt: null },
    });
    if (releasePending > 0) {
      throw new AppError(
        409,
        "BINDING_RELEASE_IN_PROGRESS",
        "Wait for project disconnection to finish before changing provider maps",
      );
    }
    const updated = await transaction.integrationConnection.update({
      where: { id: connectionId },
      data: {
        discoveredStatuses,
        statusMapRead: readMap as Prisma.InputJsonValue,
        statusMapWrite: writeMap as Prisma.InputJsonValue,
        ...(current.lifecycle !== "draft"
          ? { lifecycle: "draft" as const, lifecycleEpoch: { increment: 1 } }
          : {}),
      },
    });
    await transaction.integrationProjectBinding.updateMany({
      where: {
        connectionId,
        releaseRequestedAt: null,
        releasedAt: null,
        lifecycle: { not: "draft" },
      },
      data: {
        readMap: readMap as Prisma.InputJsonValue,
        writeMap: writeMap as Prisma.InputJsonValue,
        lifecycle: "draft",
        lifecycleEpoch: { increment: 1 },
      },
    });
    await transaction.integrationProjectBinding.updateMany({
      where: { connectionId, releaseRequestedAt: null, releasedAt: null, lifecycle: "draft" },
      data: {
        readMap: readMap as Prisma.InputJsonValue,
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
  workspaceId?: string,
  allowedProjectIds?: string[] | null,
) {
  const connection = await ownedConnection(prisma, connectionId, userId, workspaceId);
  const maps = providerMapsFromConnection(connection);
  if (!maps.readMap || !maps.writeMap || !maps.timeActivityId) {
    throw new AppError(
      409,
      "PROVIDER_MAPS_REQUIRED",
      "A workspace owner must configure Redmine status and activity maps first",
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
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "instance_settings" WHERE "id" = ${INSTANCE_SETTINGS_ID}::uuid FOR SHARE`,
    );
    await lockConnection(transaction, connectionId);
    const current = await ownedConnection(transaction, connectionId, userId, workspaceId);
    const currentMaps = providerMapsFromConnection(current);
    if (!currentMaps.readMap || !currentMaps.writeMap) {
      throw new AppError(
        409,
        "PROVIDER_MAPS_REQUIRED",
        "A workspace owner must configure Redmine status and activity maps first",
      );
    }
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "projects" WHERE "id" = ${input.projectId}::uuid AND "workspace_id" = ${current.workspaceId}::uuid FOR UPDATE`,
    );
    const project = await transaction.project.findFirst({
      where: {
        id: input.projectId,
        workspaceId: current.workspaceId,
        archived: false,
        ...(allowedProjectIds ? { AND: { id: { in: allowedProjectIds } } } : {}),
      },
      select: { id: true },
    });
    if (!project) {
      throw new AppError(400, "PROJECT_NOT_FOUND", "Project is missing, archived, or outside this workspace");
    }

    await lockRemoteProject(transaction, current, input.remoteProjectId);
    const localBinding = await transaction.integrationProjectBinding.findFirst({
      where: { connectionId, projectId: project.id, releasedAt: null },
    });
    if (localBinding) {
      if (localBinding.remoteProjectId === input.remoteProjectId) return localBinding;
      throw new AppError(409, "PROJECT_ALREADY_BOUND", "Kanon project is already bound to Redmine");
    }
    const remoteBinding = await transaction.integrationProjectBinding.findFirst({
      where: {
        remoteProjectId: input.remoteProjectId,
        releasedAt: null,
        connection: { provider: current.provider, baseUrl: current.baseUrl },
      },
      select: { id: true },
    });
    if (remoteBinding) {
      throw new AppError(409, "REMOTE_PROJECT_ALREADY_BOUND", "Redmine project is already bound");
    }

    const historical = await transaction.integrationProjectBinding.findFirst({
      where: {
        connectionId,
        projectId: project.id,
        remoteProjectId: input.remoteProjectId,
        releasedAt: { not: null },
      },
      orderBy: { updatedAt: "desc" },
    });
    if (historical) {
      const unresolved = await transaction.integrationSyncWork.count({
        where: {
          bindingId: historical.id,
          state: { in: ["leased", "ambiguous"] },
        },
      });
      const openConflicts = await transaction.integrationConflict.count({
        where: { bindingId: historical.id, state: "open" },
      });
      if (unresolved > 0 || openConflicts > 0) {
        throw new AppError(
          409,
          "BINDING_HISTORY_UNRESOLVED",
          "Resolve retained synchronization conflicts before reconnecting this project",
        );
      }
    } else {
      const remapHistory = await transaction.integrationProjectBinding.findFirst({
        where: {
          connectionId,
          releasedAt: { not: null },
          OR: [{ projectId: project.id }, { remoteProjectId: input.remoteProjectId }],
        },
        select: { id: true },
      });
      if (remapHistory) {
        throw new AppError(
          409,
          "BINDING_HISTORY_CONFLICT",
          "Retained synchronization history prevents remapping this project in the same workspace",
        );
      }
    }
    const binding = historical
      ? await transaction.integrationProjectBinding.update({
          where: { id: historical.id },
          data: {
            releasedAt: null,
            releaseRequestedAt: null,
            readMap: currentMaps.readMap as Prisma.InputJsonValue,
            writeMap: currentMaps.writeMap as Prisma.InputJsonValue,
            lifecycle: "draft",
            lifecycleEpoch: { increment: 1 },
            inboundEnabled: false,
            bootstrapState: "not_required",
            bootstrapCutoff: null,
            bootstrapPageToken: Prisma.DbNull,
            bootstrapLeaseToken: null,
            bootstrapLeaseUntil: null,
            bootstrapFence: { increment: 1 },
            cursorUpdatedAt: null,
            cursorRemoteId: null,
            pageToken: null,
            pollLeaseToken: null,
            pollLeaseUntil: null,
            pollFence: { increment: 1 },
            auditCursorRemoteId: null,
            auditCompletedAt: null,
          },
        })
      : await transaction.integrationProjectBinding.create({
          data: {
            connectionId,
            projectId: project.id,
            remoteProjectId: input.remoteProjectId,
            readMap: currentMaps.readMap as Prisma.InputJsonValue,
            writeMap: currentMaps.writeMap as Prisma.InputJsonValue,
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

export async function unbindProject(
  connectionId: string,
  bindingId: string,
  userId: string,
  workspaceId?: string,
  allowedProjectIds?: string[] | null,
) {
  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const connection = await ownedConnection(transaction, connectionId, userId, workspaceId);
    await transaction.$queryRaw(
      Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${bindingId}::uuid FOR UPDATE`,
    );
    const binding = await transaction.integrationProjectBinding.findFirst({
      where: {
        id: bindingId,
        connectionId,
        project: { workspaceId: connection.workspaceId },
        ...(allowedProjectIds ? { projectId: { in: allowedProjectIds } } : {}),
      },
    });
    if (!binding) {
      throw new AppError(404, "INTEGRATION_BINDING_NOT_FOUND", "Integration project binding not found");
    }
    if (binding.releasedAt) return { status: "released" as const, binding };

    await lockRemoteProject(transaction, connection, binding.remoteProjectId);
    const existingUnresolvedWork = await transaction.integrationSyncWork.count({
      where: { bindingId, state: { in: ["leased", "ambiguous"] } },
    });
    if (
      existingUnresolvedWork > 0 &&
      (connection.lifecycle !== "active" || binding.lifecycle !== "active")
    ) {
      throw new AppError(
        409,
        "INTEGRATION_NOT_ACTIVE",
        "Resume synchronization before disconnecting outstanding work",
      );
    }
    const releaseRequested = await transaction.integrationProjectBinding.update({
      where: { id: binding.id },
      data: {
        releaseRequestedAt: binding.releaseRequestedAt ?? new Date(),
        ...(binding.releaseRequestedAt
          ? {}
          : {
              inboundEnabled: false,
              pollLeaseToken: null,
              pollLeaseUntil: null,
              pollFence: { increment: 1 },
              bootstrapLeaseToken: null,
              bootstrapLeaseUntil: null,
              bootstrapFence: { increment: 1 },
            }),
      },
    });
    const unresolvedWork = await transaction.integrationSyncWork.count({
      where: { bindingId, state: { in: ["leased", "ambiguous"] } },
    });
    if (unresolvedWork > 0) {
      return { status: "draining" as const, binding: releaseRequested };
    }

    const released = await transaction.integrationProjectBinding.update({
      where: { id: binding.id },
      data: {
        lifecycle: "disabled",
        lifecycleEpoch: { increment: 1 },
        releasedAt: new Date(),
      },
    });
    const currentBindings = await transaction.integrationProjectBinding.count({
      where: { connectionId, releasedAt: null },
    });
    if (currentBindings === 0 && connection.lifecycle !== "draft") {
      await transaction.integrationConnection.update({
        where: { id: connectionId },
        data: { lifecycle: "draft", lifecycleEpoch: { increment: 1 } },
      });
    }
    return { status: "released" as const, binding: released };
  });
}

export async function finalizeDrainedBindingReleases(
  database: typeof prisma = prisma,
  limit = 100,
) {
  const candidates = await database.integrationProjectBinding.findMany({
    where: {
      releaseRequestedAt: { not: null },
      releasedAt: null,
      works: { none: { state: { in: ["leased", "ambiguous"] } } },
    },
    orderBy: { releaseRequestedAt: "asc" },
    take: limit,
    select: { id: true, connectionId: true },
  });
  let released = 0;
  for (const candidate of candidates) {
    released += await database.$transaction(async (transaction) => {
      await lockConnection(transaction, candidate.connectionId);
      await transaction.$queryRaw(
        Prisma.sql`SELECT "id" FROM "integration_project_bindings" WHERE "id" = ${candidate.id}::uuid FOR UPDATE`,
      );
      const current = await transaction.integrationProjectBinding.findUnique({
        where: { id: candidate.id },
      });
      if (!current?.releaseRequestedAt || current.releasedAt) return 0;
      const unresolved = await transaction.integrationSyncWork.count({
        where: { bindingId: current.id, state: { in: ["leased", "ambiguous"] } },
      });
      if (unresolved > 0) return 0;
      await transaction.integrationProjectBinding.update({
        where: { id: current.id },
        data: {
          lifecycle: "disabled",
          lifecycleEpoch: { increment: 1 },
          releasedAt: new Date(),
        },
      });
      const currentBindings = await transaction.integrationProjectBinding.count({
        where: { connectionId: current.connectionId, releasedAt: null },
      });
      if (currentBindings === 0) {
        await transaction.integrationConnection.updateMany({
          where: { id: current.connectionId, lifecycle: { not: "draft" } },
          data: { lifecycle: "draft", lifecycleEpoch: { increment: 1 } },
        });
      }
      return 1;
    });
  }
  return released;
}

/** Owner convenience retained for tests and API consumers. */
export async function configureConnection(
  connectionId: string,
  input: {
    projectId: string;
    remoteProjectId: string;
    timeActivityId: string;
    readMap: Readonly<Record<string, string>>;
    writeMap: Readonly<Record<string, string>>;
    priorityReadMap?: Readonly<Record<string, string>>;
    priorityWriteMap?: Readonly<Record<string, string>>;
  },
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
  workspaceId?: string,
  allowedProjectIds?: string[] | null,
) {
  await configureProviderMaps(
    connectionId,
    {
      timeActivityId: input.timeActivityId,
      readMap: input.readMap,
      writeMap: input.writeMap,
      priorityReadMap: input.priorityReadMap,
      priorityWriteMap: input.priorityWriteMap,
    },
    userId,
    deps,
    workspaceId,
  );
  return bindProject(
    connectionId,
    { projectId: input.projectId, remoteProjectId: input.remoteProjectId },
    userId,
    deps,
    workspaceId,
    allowedProjectIds,
  );
}

async function assertActivationReady(
  database: Database,
  connection: {
    id: string;
    workspaceId: string;
    serviceCredentialId: string | null;
    discoveredStatuses: unknown;
  },
) {
  const bindings = await database.integrationProjectBinding.findMany({
    where: {
      connectionId: connection.id,
      releaseRequestedAt: null,
      releasedAt: null,
    },
  });
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
  if (
    typeof writeMap[TIME_ENTRY_ACTIVITY_MAP_KEY] !== "string" ||
    !WRITABLE_STATES.every(
      (state) => typeof writeMap[state] === "string" && writableIds.has(writeMap[state] as string),
    )
  ) {
    return false;
  }
  const priorityIds = new Set(
    Object.entries(readMap)
      .filter(([key, priority]) => key.startsWith(PRIORITY_MAP_PREFIX) && ISSUE_PRIORITIES.includes(priority as (typeof ISSUE_PRIORITIES)[number]))
      .map(([key]) => key.slice(PRIORITY_MAP_PREFIX.length)),
  );
  return (
    priorityIds.size > 0 &&
    ISSUE_PRIORITIES.every((priority) => {
      const remoteId = writeMap[priorityWriteKey(priority)];
      return typeof remoteId === "string" && priorityIds.has(remoteId);
    })
  );
}

export async function setConnectionLifecycle(
  connectionId: string,
  lifecycle: "active" | "paused" | "disabled",
  userId: string,
  deps: ConnectionServiceDeps = defaultDeps,
  workspaceId?: string,
) {
  const current = await ownedConnection(prisma, connectionId, userId, workspaceId);
  if (current.lifecycle === lifecycle) return current;
  const releasePending = await prisma.integrationProjectBinding.count({
    where: { connectionId, releaseRequestedAt: { not: null }, releasedAt: null },
  });
  if (releasePending > 0) {
    throw new AppError(
      409,
      "BINDING_RELEASE_IN_PROGRESS",
      "Wait for project disconnection to finish before changing integration lifecycle",
    );
  }
  if (lifecycle === "active") {
    const credential = await assertActivationReady(prisma, current);
    await queryRedmine(() =>
      deps.remote(current.baseUrl, deps.decrypt(credential.encryptedKey)).whoAmI(),
    );
  }

  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const locked = await ownedConnection(transaction, connectionId, userId, workspaceId);
    if (locked.lifecycle === lifecycle) return locked;
    const lockedReleasePending = await transaction.integrationProjectBinding.count({
      where: { connectionId, releaseRequestedAt: { not: null }, releasedAt: null },
    });
    if (lockedReleasePending > 0) {
      throw new AppError(
        409,
        "BINDING_RELEASE_IN_PROGRESS",
        "Wait for project disconnection to finish before changing integration lifecycle",
      );
    }
    if (lifecycle === "active") await assertActivationReady(transaction, locked);
    const connection = await transaction.integrationConnection.update({
      where: { id: connectionId },
      data: { lifecycle, lifecycleEpoch: { increment: 1 } },
    });
    await transaction.integrationProjectBinding.updateMany({
      where: { connectionId, releaseRequestedAt: null, releasedAt: null },
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
            AND binding."released_at" IS NULL
            AND binding."release_requested_at" IS NULL
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
  workspaceId?: string,
) {
  const { connection, member } = await memberConnection(
    prisma,
    connectionId,
    userId,
    workspaceId,
  );
  const existing = await prisma.memberIntegrationCredential.findUnique({
    where: { memberId_connectionId: { memberId: member.id, connectionId } },
    select: { id: true },
  });
  if (existing?.id === connection.serviceCredentialId) {
    return replaceServiceCredential(connectionId, apiKey, userId, deps, workspaceId);
  }
  const identity = await queryRedmine(() => deps.remote(connection.baseUrl, apiKey).whoAmI());
  const encryptedKey = deps.encrypt(apiKey);
  const validatedAt = new Date();

  try {
    const credential = await prisma.$transaction(async (transaction) => {
      await lockConnection(transaction, connectionId);
      const current = await memberConnection(transaction, connectionId, userId, workspaceId);
      const currentCredential = await transaction.memberIntegrationCredential.findUnique({
        where: {
          memberId_connectionId: { memberId: current.member.id, connectionId },
        },
        select: { id: true },
      });
      if (currentCredential?.id === current.connection.serviceCredentialId) {
        throw new AppError(
          409,
          "SERVICE_CREDENTIAL_REQUIRES_OWNER",
          "Replace the service credential from workspace settings",
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
  workspaceId?: string,
) {
  const connection = await ownedConnection(prisma, connectionId, userId, workspaceId);
  await resolveServiceCredentialMember(prisma, connection.workspaceId, userId);
  const identity = await queryRedmine(() => deps.remote(connection.baseUrl, apiKey).whoAmI());
  const encryptedKey = deps.encrypt(apiKey);
  const validatedAt = new Date();

  try {
    const credential = await prisma.$transaction(async (transaction) => {
      await lockConnection(transaction, connectionId);
      const current = await ownedConnection(transaction, connectionId, userId, workspaceId);
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
          binding: { connectionId, releaseRequestedAt: null, releasedAt: null },
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

export async function clearCredential(
  connectionId: string,
  userId: string,
  workspaceId?: string,
) {
  const { connection, member } = await memberConnection(
    prisma,
    connectionId,
    userId,
    workspaceId,
  );
  const existing = await prisma.memberIntegrationCredential.findUnique({
    where: { memberId_connectionId: { memberId: member.id, connectionId } },
    select: { id: true },
  });
  if (existing?.id === connection.serviceCredentialId) {
    throw new AppError(
      409,
      "SERVICE_CREDENTIAL_REQUIRES_REPLACEMENT",
      "Replace the workspace service credential before disconnecting this account",
    );
  }
  await prisma.memberIntegrationCredential.updateMany({
    where: { connectionId, memberId: member.id },
    data: { lastAuthStatus: "revoked", revokedAt: new Date() },
  });
  const credential = await prisma.memberIntegrationCredential.findUnique({
    where: { memberId_connectionId: { memberId: member.id, connectionId } },
  });
  return publicCredential(credential);
}

export async function getWorkspaceConnection(
  workspaceId: string,
  userId: string,
  allowedProjectIds?: string[] | null,
) {
  const member = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
    select: { id: true },
  });
  if (!member) throw new AppError(403, "FORBIDDEN", "Workspace membership is required");
  const connection = await prisma.integrationConnection.findUnique({
    where: { workspaceId_provider: { workspaceId, provider: "redmine" } },
    select: { id: true },
  });
  return connection ? getConnection(connection.id, userId, workspaceId, allowedProjectIds) : null;
}

export async function getConnection(
  connectionId: string,
  userId: string,
  workspaceId?: string,
  allowedProjectIds?: string[] | null,
) {
  const connection = await prisma.integrationConnection.findUnique({ where: { id: connectionId } });
  if (!connection || (workspaceId && connection.workspaceId !== workspaceId)) {
    throw new AppError(404, "INTEGRATION_NOT_FOUND", "Integration connection not found");
  }

  const member = await prisma.member.findUnique({
    where: { userId_workspaceId: { userId, workspaceId: connection.workspaceId } },
    select: { id: true, role: true },
  });
  if (!member) {
    throw new AppError(403, "FORBIDDEN", "Workspace membership is required");
  }
  const memberId = member.id;
  const operator = member.role === "owner" && !allowedProjectIds;
  const authBlockedWhere = {
    binding: { connectionId, releasedAt: null },
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
        where: {
          connectionId,
          releasedAt: null,
          ...(allowedProjectIds ? { projectId: { in: allowedProjectIds } } : {}),
        },
        orderBy: { id: "asc" },
        select: {
          id: true,
          projectId: true,
          remoteProjectId: true,
          readMap: true,
          writeMap: true,
          lifecycle: true,
          lifecycleEpoch: true,
          releaseRequestedAt: true,
        },
      }),
      prisma.member.count({ where: { workspaceId: connection.workspaceId } }),
      prisma.integrationExternalIdentity.count({
        where: { binding: { connectionId, releasedAt: null } },
      }),
      prisma.memberIntegrationCredential.findMany({
        where: { connectionId, lastAuthStatus: "valid", revokedAt: null },
        select: { memberId: true },
      }),
      connection.serviceCredentialId
        ? prisma.memberIntegrationCredential.findFirst({
            where: { id: connection.serviceCredentialId, connectionId },
            select: {
              lastAuthStatus: true,
              revokedAt: true,
              member: { select: { role: true, workspaceId: true } },
            },
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
    ? serviceCredentialRecord.member.role !== "owner" ||
      serviceCredentialRecord.member.workspaceId !== connection.workspaceId
      ? "invalid"
      : serviceCredentialRecord.revokedAt
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
    serviceCredentialIsCaller: credential?.id === connection.serviceCredentialId,
    syncHealth: {
      status:
        serviceCredentialStatus !== "valid" || blockedWorkTotal > 0
          ? ("credential_blocked" as const)
          : connection.lifecycle !== "active"
            ? ("inactive" as const)
          : ("healthy" as const),
      blockedWork: operator ? { total: blockedWorkTotal, items: blockedWork } : null,
    },
    discoveredStatuses: operator ? connection.discoveredStatuses : null,
    providerMaps: operator
      ? {
          readMap: providerMaps.readMap
            ? Object.fromEntries(
                Object.entries(providerMaps.readMap).filter(
                  ([key]) => !key.startsWith(PRIORITY_MAP_PREFIX),
                ),
              )
            : null,
          writeMap: providerMaps.writeMap
            ? Object.fromEntries(
                Object.entries(providerMaps.writeMap).filter(
                  ([key]) =>
                    key !== TIME_ENTRY_ACTIVITY_MAP_KEY && !key.startsWith(PRIORITY_MAP_PREFIX),
                ),
              )
            : null,
          priorityReadMap: providerMaps.readMap
            ? Object.fromEntries(
                Object.entries(providerMaps.readMap)
                  .filter(([key]) => key.startsWith(PRIORITY_MAP_PREFIX))
                  .map(([key, value]) => [key.slice(PRIORITY_MAP_PREFIX.length), value]),
              )
            : null,
          priorityWriteMap: providerMaps.writeMap
            ? Object.fromEntries(
                Object.entries(providerMaps.writeMap)
                  .filter(([key]) => key.startsWith(PRIORITY_MAP_PREFIX))
                  .map(([key, value]) => [key.slice(PRIORITY_MAP_PREFIX.length), value]),
              )
            : null,
          timeActivityId: providerMaps.timeActivityId,
        }
      : null,
    bindings: bindings.map((binding) => ({
      id: binding.id,
      projectId: binding.projectId,
      remoteProjectId: binding.remoteProjectId,
      readMap:
        operator && binding.readMap && typeof binding.readMap === "object" && !Array.isArray(binding.readMap)
          ? Object.fromEntries(
              Object.entries(binding.readMap).filter(
                ([key]) => !key.startsWith(PRIORITY_MAP_PREFIX),
              ),
            )
          : {},
      writeMap:
        operator && binding.writeMap && typeof binding.writeMap === "object" && !Array.isArray(binding.writeMap)
          ? Object.fromEntries(
              Object.entries(binding.writeMap).filter(
                ([key]) =>
                  key !== TIME_ENTRY_ACTIVITY_MAP_KEY && !key.startsWith(PRIORITY_MAP_PREFIX),
              ),
            )
          : {},
      timeActivityId: operator
        ? binding.writeMap &&
          typeof binding.writeMap === "object" &&
          !Array.isArray(binding.writeMap) &&
          typeof binding.writeMap[TIME_ENTRY_ACTIVITY_MAP_KEY] === "string"
          ? binding.writeMap[TIME_ENTRY_ACTIVITY_MAP_KEY]
          : null
        : null,
      lifecycle: binding.lifecycle,
      lifecycleEpoch: binding.lifecycleEpoch,
      releasePending: binding.releaseRequestedAt !== null,
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
