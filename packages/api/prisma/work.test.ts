/**
 * DB-backed durable integration work contract (KAN-182 A1.4).
 *
 * RED: the durable sync-work enums and model do not exist before this slice.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";

const { datamodel } = Prisma.dmmf;
const execFileAsync = promisify(execFile);
const prismaDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = dirname(prismaDirectory);
const migrationsDirectory = join(prismaDirectory, "migrations");
const lifecycleMigrationName = "20260720_pm_lifecycle_binding";
const identityMigrationName = "20260721_pm_identity_health";
const workMigrationName = "20260722_pm_work_outbox";
const workspaces = new Set<string>();
const users = new Set<string>();

const upgradeFixture = {
  workspaceId: "00000000-0000-4000-8000-000000000301",
  projectId: "00000000-0000-4000-8000-000000000302",
  userId: "00000000-0000-4000-8000-000000000303",
  memberId: "00000000-0000-4000-8000-000000000304",
  connectionId: "00000000-0000-4000-8000-000000000305",
  credentialId: "00000000-0000-4000-8000-000000000306",
  bindingId: "00000000-0000-4000-8000-000000000307",
  identityId: "00000000-0000-4000-8000-000000000308",
  refId: "00000000-0000-4000-8000-000000000309",
  entityId: "00000000-0000-4000-8000-000000000310",
};

const legacyEncryptedKey = "gcm.v1:bGVnYWN5LW5vbmNl:bGVnYWN5LWNpcGhlcnRleHQ:MDEyMzQ1Njc4OWFiY2RlZg==";

function model(name: string) {
  return datamodel.models.find((candidate) => candidate.name === name);
}

function field(modelName: string, fieldName: string) {
  return model(modelName)?.fields.find((candidate) => candidate.name === fieldName);
}

async function createWorkspace() {
  const workspace = await prisma.workspace.create({
    data: { name: "Work Test Workspace", slug: `work-${randomUUID()}` },
  });
  workspaces.add(workspace.id);
  return workspace;
}

async function createProject(workspaceId: string, name = "Work Test Project") {
  return prisma.project.create({
    data: {
      key: `W${randomUUID().slice(0, 5).toUpperCase()}`,
      name,
      workspaceId,
    },
  });
}

async function createMember(workspaceId: string) {
  const user = await prisma.user.create({
    data: { email: `work-${randomUUID()}@kanon.test`, passwordHash: "unused" },
  });
  users.add(user.id);
  return prisma.member.create({
    data: {
      username: `member-${randomUUID().slice(0, 8)}`,
      userId: user.id,
      workspaceId,
    },
  });
}

async function createConnection(workspaceId: string) {
  return prisma.integrationConnection.create({
    data: { provider: "redmine", baseUrl: "https://pm.example.test", workspaceId },
  });
}

async function createBinding(connectionId: string, projectId: string, remoteProjectId: string) {
  return prisma.integrationProjectBinding.create({
    data: {
      connectionId,
      projectId,
      remoteProjectId,
      readMap: { "remote-open": "todo" },
      writeMap: { todo: "remote-open" },
    },
  });
}

async function listMigrationNames() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function prepareMigrationWorkspace(temporaryDirectory: string, migrationNames: string[]) {
  const temporaryMigrationsDirectory = join(temporaryDirectory, "migrations");
  await mkdir(temporaryMigrationsDirectory, { recursive: true });
  await cp(
    join(migrationsDirectory, "migration_lock.toml"),
    join(temporaryMigrationsDirectory, "migration_lock.toml")
  );
  await cp(join(prismaDirectory, "schema.prisma"), join(temporaryDirectory, "schema.prisma"));

  for (const migrationName of migrationNames) {
    await cp(
      join(migrationsDirectory, migrationName),
      join(temporaryMigrationsDirectory, migrationName),
      { recursive: true }
    );
  }
}

async function deployMigrations(temporaryDirectory: string, databaseUrl: string) {
  await execFileAsync(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--schema", join(temporaryDirectory, "schema.prisma")],
    {
      cwd: apiDirectory,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 10 * 1024 * 1024,
    }
  );
}

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function seedPreWorkRows(database: PrismaClient) {
  const f = upgradeFixture;
  await database.workspace.create({ data: { id: f.workspaceId, name: "A1.4 upgrade", slug: "a14-upgrade" } });
  await database.user.create({ data: { id: f.userId, email: "a14-upgrade@kanon.test", passwordHash: "unused" } });
  await database.member.create({
    data: { id: f.memberId, username: "a14-member", userId: f.userId, workspaceId: f.workspaceId },
  });
  await database.project.create({
    data: { id: f.projectId, key: "UPG14", name: "A1.4 project", workspaceId: f.workspaceId },
  });
  await database.integrationConnection.create({
    data: { id: f.connectionId, provider: "redmine", baseUrl: "https://pm.example.test", workspaceId: f.workspaceId },
  });
  await database.memberIntegrationCredential.create({
    data: {
      id: f.credentialId,
      encryptedKey: legacyEncryptedKey,
      externalUserId: "legacy-a14-user",
      externalLogin: "legacy-a14-login",
      memberId: f.memberId,
      connectionId: f.connectionId,
    },
  });
  await database.$executeRaw(Prisma.sql`
    INSERT INTO "integration_project_bindings" (
      "id", "remote_project_id", "read_map", "write_map", "updated_at", "connection_id", "project_id"
    ) VALUES (
      ${f.bindingId}::uuid, 'remote-a14-project', '{"remote-open":"todo"}'::jsonb,
      '{"todo":"remote-open"}'::jsonb, CURRENT_TIMESTAMP, ${f.connectionId}::uuid, ${f.projectId}::uuid
    )
  `);
  await database.$executeRaw(Prisma.sql`
    INSERT INTO "integration_external_identities" (
      "id", "remote_user_id", "remote_login", "updated_at", "binding_id", "member_id"
    ) VALUES (
      ${f.identityId}::uuid, 'remote-a14-user', 'a14-remote-login', CURRENT_TIMESTAMP,
      ${f.bindingId}::uuid, ${f.memberId}::uuid
    )
  `);
  await database.externalRef.create({
    data: {
      id: f.refId,
      entityType: "issue",
      entityId: f.entityId,
      externalId: "remote-a14-issue",
      metadata: { source: "pre-a1.4" },
      connectionId: f.connectionId,
      bindingId: f.bindingId,
    },
  });
}

async function runWorkUpgradePath() {
  const baseDatabaseUrl = new URL(
    process.env["DATABASE_URL"] ?? "postgresql://kanon:kanon@127.0.0.1:5433/kanon_e2e"
  );
  const schemaName = `work_upgrade_${randomUUID().replaceAll("-", "")}`;
  const adminDatabaseUrl = new URL(baseDatabaseUrl);
  adminDatabaseUrl.searchParams.set("schema", "public");
  const isolatedDatabaseUrl = new URL(baseDatabaseUrl);
  isolatedDatabaseUrl.searchParams.set("schema", schemaName);
  const admin = new PrismaClient({ datasourceUrl: adminDatabaseUrl.toString() });
  let database: PrismaClient | undefined;
  let temporaryDirectory: string | undefined;

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);

    const migrationNames = await listMigrationNames();
    const lifecycleMigrationIndex = migrationNames.indexOf(lifecycleMigrationName);
    const identityMigrationIndex = migrationNames.indexOf(identityMigrationName);
    const workMigrationIndex = migrationNames.indexOf(workMigrationName);
    if (
      lifecycleMigrationIndex < 0 ||
      identityMigrationIndex !== lifecycleMigrationIndex + 1 ||
      workMigrationIndex !== identityMigrationIndex + 1
    ) {
      throw new Error(
        `Expected ${lifecycleMigrationName}, ${identityMigrationName}, and ${workMigrationName} to be adjacent`
      );
    }

    temporaryDirectory = await mkdtemp(join(tmpdir(), "kanon-work-upgrade-"));
    await prepareMigrationWorkspace(
      temporaryDirectory,
      migrationNames.slice(0, workMigrationIndex)
    );
    await deployMigrations(temporaryDirectory, isolatedDatabaseUrl.toString());

    const preMigrationDatabase = new PrismaClient({
      datasourceUrl: isolatedDatabaseUrl.toString(),
    });
    database = preMigrationDatabase;
    await seedPreWorkRows(preMigrationDatabase);
    await preMigrationDatabase.$disconnect();
    database = undefined;

    for (const migrationName of migrationNames.slice(workMigrationIndex)) {
      await cp(
        join(migrationsDirectory, migrationName),
        join(temporaryDirectory, "migrations", migrationName),
        { recursive: true }
      );
    }
    await deployMigrations(temporaryDirectory, isolatedDatabaseUrl.toString());

    const upgradedDatabase = new PrismaClient({
      datasourceUrl: isolatedDatabaseUrl.toString(),
    });
    database = upgradedDatabase;

    const existingCredential = await upgradedDatabase.memberIntegrationCredential.findUnique({
      where: { id: upgradeFixture.credentialId },
    });
    expect(existingCredential).toMatchObject({
      id: upgradeFixture.credentialId,
      encryptedKey: legacyEncryptedKey,
      externalUserId: "legacy-a14-user",
      externalLogin: "legacy-a14-login",
      lastValidatedAt: null,
      lastAuthStatus: "unknown",
      revokedAt: null,
    });

    const existingIdentity = await upgradedDatabase.integrationExternalIdentity.findUnique({
      where: { id: upgradeFixture.identityId },
    });
    expect(existingIdentity).toMatchObject({
      bindingId: upgradeFixture.bindingId,
      memberId: upgradeFixture.memberId,
      remoteUserId: "remote-a14-user",
      remoteLogin: "a14-remote-login",
    });

    const existingRef = await upgradedDatabase.externalRef.findUnique({
      where: { id: upgradeFixture.refId },
    });
    expect(existingRef).toMatchObject({
      id: upgradeFixture.refId,
      bindingId: upgradeFixture.bindingId,
      localVersion: 0n,
      lastCorrelationId: null,
      metadata: { source: "pre-a1.4" },
    });

    const work = await upgradedDatabase.integrationSyncWork.create({
      data: {
        entityType: "issue",
        entityId: upgradeFixture.entityId,
        direction: "outbound",
        operation: "create",
        dedupeKey: "a14-upgrade-work",
        laneKey: `binding:${upgradeFixture.bindingId}:issue:upgrade`,
        actorKey: "remote:unknown",
        actorKind: "system",
        payload: { source: "post-a1.4" },
        correlationId: "a14-upgrade-correlation",
        epoch: 0,
        bindingId: upgradeFixture.bindingId,
        authCredentialId: upgradeFixture.credentialId,
        refId: upgradeFixture.refId,
      },
    });
    expect(work).toMatchObject({
      bindingId: upgradeFixture.bindingId,
      state: "queued",
      attempts: 0,
      fence: 0,
      authCredentialId: upgradeFixture.credentialId,
      refId: upgradeFixture.refId,
    });
    expect(work.sequence).toBeGreaterThan(0n);
  } finally {
    if (database) {
      await database.$disconnect().catch(() => undefined);
    }
    await admin
      .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
      .catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
    if (temporaryDirectory) {
      await rm(temporaryDirectory, { recursive: true, force: true }).catch(() => undefined);
    }
  }
}

afterEach(async () => {
  for (const id of workspaces) {
    await prisma.workspace.delete({ where: { id } });
  }
  workspaces.clear();
  for (const id of users) {
    await prisma.user.delete({ where: { id } });
  }
  users.clear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("integration sync work schema", () => {
  it("defines durable work states, directional operations, and lane identity", () => {
    const enums = [
      ["SyncDirection", ["outbound", "inbound"]],
      ["SyncOperation", ["create", "update", "delete", "close"]],
      ["SyncWorkState", ["queued", "leased", "retry", "superseded", "ambiguous", "dead", "done", "skipped"]],
      ["ActorKind", ["user", "system", "ai", "remote"]],
    ] as const;
    for (const [name, values] of enums) {
      expect(datamodel.enums.find((item) => item.name === name)?.values.map(({ name: value }) => value)).toEqual(values);
    }

    expect(model("IntegrationSyncWork")).toBeDefined();
    const requiredFields = [
      ["entityType", "String"], ["entityId", "String"], ["direction", "SyncDirection"],
      ["operation", "SyncOperation"], ["sequence", "BigInt"], ["dedupeKey", "String"],
      ["laneKey", "String"], ["actorKey", "String"], ["actorKind", "ActorKind"],
      ["payload", "Json"], ["correlationId", "String"], ["state", "SyncWorkState"],
      ["attempts", "Int"], ["availableAt", "DateTime"], ["fence", "Int"], ["epoch", "Int"],
      ["bindingId", "String"],
    ] as const;
    for (const [name, type] of requiredFields) {
      expect(field("IntegrationSyncWork", name)).toMatchObject({ type, isRequired: true });
    }
    for (const [name, value] of Object.entries({ state: "queued", attempts: 0, fence: 0 })) {
      expect(field("IntegrationSyncWork", name)?.default).toBe(value);
    }
    expect(field("IntegrationSyncWork", "sequence")).toMatchObject({ isUnique: true });
    expect(field("IntegrationSyncWork", "dedupeKey")).toMatchObject({ isUnique: true });
  });

  it("keeps retry links and outcome markers nullable with the approved relations", () => {
    const nullableFields = ["leaseToken", "leaseUntil", "authCredentialId", "refId", "marker", "skippedReason", "requestedStatus", "actualStatus"];
    for (const fieldName of nullableFields) {
      expect(field("IntegrationSyncWork", fieldName), `${fieldName} must be nullable`).toMatchObject({
        isRequired: false,
      });
    }

    expect(field("IntegrationSyncWork", "payload")).toMatchObject({
      type: "Json",
      isRequired: true,
    });
    expect(field("IntegrationSyncWork", "sequence")?.default).toBeDefined();
    expect(field("IntegrationSyncWork", "availableAt")?.default).toBeDefined();
    expect(field("IntegrationSyncWork", "createdAt")?.default).toBeDefined();

    const relations = [
      ["IntegrationSyncWork", "binding", "IntegrationProjectBinding", false, true],
      ["IntegrationSyncWork", "authCredential", "MemberIntegrationCredential", false, false],
      ["IntegrationSyncWork", "ref", "ExternalRef", false, false],
      ["IntegrationProjectBinding", "works", "IntegrationSyncWork", true, true],
      ["MemberIntegrationCredential", "works", "IntegrationSyncWork", true, true],
      ["ExternalRef", "works", "IntegrationSyncWork", true, true],
    ] as const;
    for (const [modelName, name, type, isList, isRequired] of relations) {
      expect(field(modelName, name)).toMatchObject({ type, isList, isRequired });
    }
  });

  it("persists queued work with stable lane sequencing and lease fields", async () => {
    const workspace = await createWorkspace();
    const project = await createProject(workspace.id);
    const member = await createMember(workspace.id);
    const connection = await createConnection(workspace.id);
    const binding = await createBinding(connection.id, project.id, "remote-work-project");
    const credential = await prisma.memberIntegrationCredential.create({
      data: { encryptedKey: "ciphertext", memberId: member.id, connectionId: connection.id },
    });
    const externalRef = await prisma.externalRef.create({
      data: {
        entityType: "issue",
        entityId: randomUUID(),
        externalId: "remote-issue-1",
        connectionId: connection.id,
        bindingId: binding.id,
      },
    });

    const first = await prisma.integrationSyncWork.create({
      data: {
        entityType: "issue",
        entityId: randomUUID(),
        direction: "outbound",
        operation: "update",
        dedupeKey: "work-dedupe-1",
        laneKey: `binding:${binding.id}:issue:1`,
        actorKey: member.id,
        actorKind: "user",
        payload: { fields: ["state"] },
        correlationId: "work-correlation-1",
        epoch: binding.lifecycleEpoch,
        bindingId: binding.id,
        authCredentialId: credential.id,
        refId: externalRef.id,
        requestedStatus: "remote-closed",
      },
    });
    const second = await prisma.integrationSyncWork.create({
      data: {
        entityType: "issue",
        entityId: randomUUID(),
        direction: "outbound",
        operation: "update",
        dedupeKey: "work-dedupe-2",
        laneKey: first.laneKey,
        actorKey: member.id,
        actorKind: "user",
        payload: { fields: ["estimate"] },
        correlationId: "work-correlation-2",
        epoch: binding.lifecycleEpoch,
        bindingId: binding.id,
      },
    });

    expect(first).toMatchObject({
      direction: "outbound",
      operation: "update",
      state: "queued",
      attempts: 0,
      fence: 0,
      leaseToken: null,
      leaseUntil: null,
      authCredentialId: credential.id,
      refId: externalRef.id,
      requestedStatus: "remote-closed",
      actualStatus: null,
    });
    expect(first.sequence).toBeGreaterThan(0n);
    expect(first.availableAt).toBeInstanceOf(Date);
    expect(second.sequence).toBeGreaterThan(first.sequence);
    expect(second.laneKey).toBe(first.laneKey);

    const leased = await prisma.integrationSyncWork.update({
      where: { id: first.id },
      data: {
        state: "leased",
        attempts: 1,
        leaseToken: "lease-token-1",
        leaseUntil: new Date("2026-07-27T12:00:00.000Z"),
        fence: 1,
      },
    });
    expect(leased).toMatchObject({
      state: "leased",
      attempts: 1,
      leaseToken: "lease-token-1",
      leaseUntil: new Date("2026-07-27T12:00:00.000Z"),
      fence: 1,
    });
  });

  it("enforces dedupe identity and preserves history when optional links are deleted", async () => {
    const workspace = await createWorkspace();
    const project = await createProject(workspace.id);
    const member = await createMember(workspace.id);
    const connection = await createConnection(workspace.id);
    const binding = await createBinding(connection.id, project.id, "remote-work-links");
    const credential = await prisma.memberIntegrationCredential.create({
      data: { encryptedKey: "ciphertext", memberId: member.id, connectionId: connection.id },
    });
    const externalRef = await prisma.externalRef.create({
      data: {
        entityType: "issue",
        entityId: randomUUID(),
        externalId: "remote-issue-links",
        connectionId: connection.id,
        bindingId: binding.id,
      },
    });

    const workData = {
      entityType: "issue",
      entityId: randomUUID(),
      direction: "outbound" as const,
      operation: "create" as const,
      dedupeKey: "work-dedupe-unique",
      laneKey: `binding:${binding.id}:issue:links`,
      actorKey: member.id,
      actorKind: "user" as const,
      payload: { title: "Durable work" },
      correlationId: "work-correlation-links",
      epoch: binding.lifecycleEpoch,
      bindingId: binding.id,
      authCredentialId: credential.id,
      refId: externalRef.id,
    };
    const work = await prisma.integrationSyncWork.create({ data: workData });

    await expect(
      prisma.integrationSyncWork.create({
        data: { ...workData, entityId: randomUUID() },
      })
    ).rejects.toMatchObject({ code: "P2002" });

    await prisma.memberIntegrationCredential.delete({ where: { id: credential.id } });
    await prisma.externalRef.delete({ where: { id: externalRef.id } });
    expect(
      await prisma.integrationSyncWork.findUnique({ where: { id: work.id } })
    ).toMatchObject({ authCredentialId: null, refId: null });

    await prisma.integrationProjectBinding.delete({ where: { id: binding.id } });
    expect(
      await prisma.integrationSyncWork.findUnique({ where: { id: work.id } })
    ).toBeNull();
  });

  it("creates the lane-order and due-work indexes", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexname: string }>>`
      SELECT indexname
      FROM pg_indexes
      WHERE tablename = 'integration_sync_work'
        AND indexname IN (
          'integration_sync_work_binding_id_lane_key_sequence_idx',
          'integration_sync_work_state_available_at_idx'
        )
    `;

    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "integration_sync_work_binding_id_lane_key_sequence_idx",
        "integration_sync_work_state_available_at_idx",
      ])
    );
  });

  it(
    "upgrades pre-A1.4 rows without losing identity, links, or ciphertext",
    { timeout: 120000 },
    async () => {
      await runWorkUpgradePath();
    }
  );
});
