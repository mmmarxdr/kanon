import { Prisma } from "@prisma/client";
import { env } from "../../config/env.js";
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

type Database = Pick<
  Prisma.TransactionClient,
  | "member"
  | "project"
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

async function upsertExternalIdentities(
  database: Database,
  connectionId: string,
  memberId: string,
  remoteUserId: string,
  remoteLogin: string | null,
) {
  const bindings = await database.integrationProjectBinding.findMany({
    where: { connectionId },
    select: { id: true },
  });
  for (const binding of bindings) {
    await database.integrationExternalIdentity.upsert({
      where: { bindingId_memberId: { bindingId: binding.id, memberId } },
      create: { bindingId: binding.id, memberId, remoteUserId, remoteLogin },
      update: { remoteUserId, remoteLogin },
    });
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
  if (current.lifecycle === lifecycle) return current;
  if (lifecycle === "active") {
    const credential = await assertActivationReady(prisma, current);
    await deps.remote(current.baseUrl, deps.decrypt(credential.encryptedKey)).whoAmI();
  }

  return prisma.$transaction(async (transaction) => {
    await lockConnection(transaction, connectionId);
    const locked = await ownedConnection(transaction, connectionId, userId);
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
  const { connection } = await memberConnection(prisma, connectionId, userId);
  const identity = await deps.remote(connection.baseUrl, apiKey).whoAmI();
  const encryptedKey = deps.encrypt(apiKey);
  const validatedAt = new Date();

  try {
    const credential = await prisma.$transaction(async (transaction) => {
      const current = await memberConnection(transaction, connectionId, userId);
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
      );
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

export async function getConnection(connectionId: string, userId: string) {
  const { connection, member } = await memberConnection(prisma, connectionId, userId);
  const [credential, bindings, workspaceMembers, validCredentials, externalIdentities] =
    await Promise.all([
      prisma.memberIntegrationCredential.findUnique({
        where: { memberId_connectionId: { memberId: member.id, connectionId } },
      }),
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
      prisma.memberIntegrationCredential.count({
        where: { connectionId, lastAuthStatus: "valid", revokedAt: null },
      }),
      prisma.integrationExternalIdentity.count({
        where: { binding: { connectionId } },
      }),
    ]);
  return {
    id: connection.id,
    workspaceId: connection.workspaceId,
    provider: connection.provider,
    baseUrl: connection.baseUrl,
    lifecycle: connection.lifecycle,
    lifecycleEpoch: connection.lifecycleEpoch,
    serviceFallbackEnabled: connection.serviceFallbackEnabled,
    discoveredStatuses: connection.discoveredStatuses,
    bindings,
    callerCredential: publicCredential(credential),
    counts: { workspaceMembers, validCredentials, externalIdentities },
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
