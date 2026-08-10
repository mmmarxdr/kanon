/**
 * DB-backed inbound application and conflict contract (KAN-182 A1.5).
 *
 * RED: durable inbound application and conflict persistence do not exist
 * before this slice. The upgrade regression applies the exact checked-in
 * migration after A1.4 and preserves every existing linked row.
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
const workMigrationName = "20260722_pm_work_outbox";
const applicationMigrationName = "20260723_pm_inbound_application_conflict";
const workspaces = new Set<string>();
const users = new Set<string>();

const upgradeFixture = {
  workspaceId: "00000000-0000-4000-8000-000000000401",
  projectId: "00000000-0000-4000-8000-000000000402",
  userId: "00000000-0000-4000-8000-000000000403",
  memberId: "00000000-0000-4000-8000-000000000404",
  connectionId: "00000000-0000-4000-8000-000000000405",
  credentialId: "00000000-0000-4000-8000-000000000406",
  bindingId: "00000000-0000-4000-8000-000000000407",
  identityId: "00000000-0000-4000-8000-000000000408",
  refId: "00000000-0000-4000-8000-000000000409",
  entityId: "00000000-0000-4000-8000-000000000410",
  workId: "00000000-0000-4000-8000-000000000411",
};
const legacyEncryptedKey =
  "gcm.v1:bGVnYWN5LW5vbmNl:bGVnYWN5LWNpcGhlcnRleHQ:MDEyMzQ1Njc4OWFiY2RlZg==";

function model(name: string) {
  return datamodel.models.find((candidate) => candidate.name === name);
}

function field(modelName: string, fieldName: string) {
  return model(modelName)?.fields.find((candidate) => candidate.name === fieldName);
}

async function createFixture() {
  const workspace = await prisma.workspace.create({
    data: { name: "Application Test Workspace", slug: `application-${randomUUID()}` },
  });
  workspaces.add(workspace.id);
  const project = await prisma.project.create({
    data: {
      key: `A${randomUUID().slice(0, 5).toUpperCase()}`,
      name: "Application Project",
      workspaceId: workspace.id,
    },
  });
  const connection = await prisma.integrationConnection.create({
    data: { provider: "redmine", baseUrl: "https://pm.example.test", workspaceId: workspace.id },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: `remote-project-${randomUUID()}`,
      readMap: { "remote-open": "todo" },
      writeMap: { todo: "remote-open" },
    },
  });
  const externalRef = await prisma.externalRef.create({
    data: {
      entityType: "issue",
      entityId: randomUUID(),
      externalId: `remote-issue-${randomUUID()}`,
      connectionId: connection.id,
      bindingId: binding.id,
    },
  });
  const work = await prisma.integrationSyncWork.create({
    data: {
      entityType: "issue",
      entityId: randomUUID(),
      direction: "inbound",
      operation: "close",
      dedupeKey: `application-work-${randomUUID()}`,
      laneKey: `binding:${binding.id}:issue:application`,
      actorKey: "remote:redmine-user",
      actorKind: "remote",
      payload: { state: "done" },
      correlationId: "inbound-work-correlation",
      epoch: binding.lifecycleEpoch,
      bindingId: binding.id,
      refId: externalRef.id,
    },
  });
  return { workspace, project, connection, binding, externalRef, work };
}

async function listMigrationNames() {
  const entries = await readdir(migrationsDirectory, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
}

async function prepareMigrationWorkspace(directory: string, migrationNames: string[]) {
  const migrations = join(directory, "migrations");
  await mkdir(migrations, { recursive: true });
  await cp(
    join(migrationsDirectory, "migration_lock.toml"),
    join(migrations, "migration_lock.toml")
  );
  await cp(join(prismaDirectory, "schema.prisma"), join(directory, "schema.prisma"));
  for (const name of migrationNames) {
    await cp(join(migrationsDirectory, name), join(migrations, name), { recursive: true });
  }
}

async function deployMigrations(directory: string, databaseUrl: string) {
  await execFileAsync(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--schema", join(directory, "schema.prisma")],
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

async function seedPreApplicationRows(database: PrismaClient) {
  const f = upgradeFixture;
  await database.workspace.create({
    data: { id: f.workspaceId, name: "A1.5 upgrade", slug: "a15-upgrade" },
  });
  await database.user.create({
    data: { id: f.userId, email: "a15-upgrade@kanon.test", passwordHash: "unused" },
  });
  // Raw insert: pre-application schema has no project_access (KAN-222), but the
  // generated Prisma client always targets the current schema.
  await database.$executeRaw(Prisma.sql`
    INSERT INTO "members" (
      "id", "username", "role", "is_agent", "created_at", "updated_at", "user_id", "workspace_id"
    ) VALUES (
      ${f.memberId}::uuid, 'a15-member', 'member', false, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP,
      ${f.userId}::uuid, ${f.workspaceId}::uuid
    )
  `);
  await database.project.create({
    data: { id: f.projectId, key: "UPG15", name: "A1.5 project", workspaceId: f.workspaceId },
  });
  await database.integrationConnection.create({
    data: {
      id: f.connectionId,
      provider: "redmine",
      baseUrl: "https://pm.example.test",
      workspaceId: f.workspaceId,
    },
  });
  await database.memberIntegrationCredential.create({
    data: {
      id: f.credentialId,
      encryptedKey: legacyEncryptedKey,
      externalUserId: "legacy-a15-user",
      externalLogin: "legacy-a15-login",
      memberId: f.memberId,
      connectionId: f.connectionId,
    },
  });
  await database.$executeRaw(Prisma.sql`
    INSERT INTO "integration_project_bindings" (
      "id", "remote_project_id", "read_map", "write_map", "updated_at", "connection_id", "project_id"
    ) VALUES (
      ${f.bindingId}::uuid, 'remote-a15-project', '{"remote-open":"todo"}'::jsonb,
      '{"todo":"remote-open"}'::jsonb, CURRENT_TIMESTAMP, ${f.connectionId}::uuid, ${f.projectId}::uuid
    )
  `);
  await database.$executeRaw(Prisma.sql`
    INSERT INTO "integration_external_identities" (
      "id", "remote_user_id", "remote_login", "updated_at", "binding_id", "member_id"
    ) VALUES (
      ${f.identityId}::uuid, 'remote-a15-user', 'a15-remote-login', CURRENT_TIMESTAMP,
      ${f.bindingId}::uuid, ${f.memberId}::uuid
    )
  `);
  await database.externalRef.create({
    data: {
      id: f.refId,
      entityType: "issue",
      entityId: f.entityId,
      externalId: "remote-a15-issue",
      metadata: { source: "pre-a1.5" },
      connectionId: f.connectionId,
      bindingId: f.bindingId,
    },
  });
  await database.integrationSyncWork.create({
    data: {
      id: f.workId,
      entityType: "issue",
      entityId: f.entityId,
      direction: "outbound",
      operation: "update",
      dedupeKey: "a15-upgrade-work",
      laneKey: `binding:${f.bindingId}:issue:upgrade`,
      actorKey: "remote:unknown",
      actorKind: "system",
      payload: { source: "pre-a1.5" },
      correlationId: "a15-upgrade-correlation",
      epoch: 0,
      bindingId: f.bindingId,
      authCredentialId: f.credentialId,
      refId: f.refId,
    },
  });
}

async function runApplicationUpgradePath() {
  const baseUrl = new URL(
    process.env["DATABASE_URL"] ?? "postgresql://kanon:kanon@127.0.0.1:5433/kanon_e2e"
  );
  const schemaName = `application_upgrade_${randomUUID().replaceAll("-", "")}`;
  const adminUrl = new URL(baseUrl);
  adminUrl.searchParams.set("schema", "public");
  const isolatedUrl = new URL(baseUrl);
  isolatedUrl.searchParams.set("schema", schemaName);
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  let database: PrismaClient | undefined;
  let temporaryDirectory: string | undefined;
  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    const names = await listMigrationNames();
    const workIndex = names.indexOf(workMigrationName);
    const applicationIndex = names.indexOf(applicationMigrationName);
    if (workIndex < 0 || applicationIndex !== workIndex + 1) {
      throw new Error(
        `Expected ${workMigrationName} to immediately precede ${applicationMigrationName}`
      );
    }
    temporaryDirectory = await mkdtemp(join(tmpdir(), "kanon-application-upgrade-"));
    await prepareMigrationWorkspace(temporaryDirectory, names.slice(0, applicationIndex));
    await deployMigrations(temporaryDirectory, isolatedUrl.toString());
    database = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });
    await seedPreApplicationRows(database);
    await database.$disconnect();
    database = undefined;
    for (const migrationName of names.slice(applicationIndex)) {
      await cp(
        join(migrationsDirectory, migrationName),
        join(temporaryDirectory, "migrations", migrationName),
        { recursive: true },
      );
    }
    await deployMigrations(temporaryDirectory, isolatedUrl.toString());
    database = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });

    await expect(
      database.memberIntegrationCredential.findUnique({
        where: { id: upgradeFixture.credentialId },
      })
    ).resolves.toMatchObject({
      encryptedKey: legacyEncryptedKey,
      externalUserId: "legacy-a15-user",
      lastAuthStatus: "unknown",
      revokedAt: null,
    });
    await expect(
      database.integrationExternalIdentity.findUnique({ where: { id: upgradeFixture.identityId } })
    ).resolves.toMatchObject({
      bindingId: upgradeFixture.bindingId,
      memberId: upgradeFixture.memberId,
      remoteUserId: "remote-a15-user",
      remoteLogin: "a15-remote-login",
    });
    await expect(
      database.externalRef.findUnique({ where: { id: upgradeFixture.refId } })
    ).resolves.toMatchObject({
      bindingId: upgradeFixture.bindingId,
      localVersion: 0n,
      lastCorrelationId: null,
      metadata: { source: "pre-a1.5" },
    });
    const work = await database.integrationSyncWork.findUnique({
      where: { id: upgradeFixture.workId },
    });
    expect(work).toMatchObject({
      bindingId: upgradeFixture.bindingId,
      authCredentialId: upgradeFixture.credentialId,
      refId: upgradeFixture.refId,
      state: "queued",
      attempts: 0,
      fence: 0,
      payload: { source: "pre-a1.5" },
    });
    expect(work?.sequence).toBeGreaterThan(0n);

    const application = await database.integrationInboundApplication.create({
      data: {
        remoteEntityType: "issue",
        remoteId: "remote-a15-inbound",
        remoteUpdatedAt: new Date("2026-07-27T12:00:00.000Z"),
        applicationKey: "a15-upgrade-application",
        correlationId: "a15-upgrade-correlation",
        bindingId: upgradeFixture.bindingId,
        refId: upgradeFixture.refId,
        workId: upgradeFixture.workId,
      },
    });
    expect(application).toMatchObject({
      bindingId: upgradeFixture.bindingId,
      refId: upgradeFixture.refId,
      workId: upgradeFixture.workId,
      state: "claimed",
      fence: 0,
      outcome: null,
    });
  } finally {
    await database?.$disconnect().catch(() => undefined);
    await admin
      .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
      .catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
    await (
      temporaryDirectory
        ? rm(temporaryDirectory, { recursive: true, force: true })
        : Promise.resolve()
    ).catch(() => undefined);
  }
}

afterEach(async () => {
  for (const id of workspaces) await prisma.workspace.delete({ where: { id } });
  workspaces.clear();
  for (const id of users) await prisma.user.delete({ where: { id } });
  users.clear();
});
afterAll(async () => prisma.$disconnect());

describe("integration inbound application and conflict schema", () => {
  it("defines tuple replay and conflict evidence contracts", () => {
    expect(
      datamodel.enums
        .find((item) => item.name === "InboundApplicationState")
        ?.values.map(({ name }) => name)
    ).toEqual(["claimed", "applied", "conflict", "skipped"]);
    expect(
      datamodel.enums.find((item) => item.name === "ConflictState")?.values.map(({ name }) => name)
    ).toEqual(["open", "resolved"]);
    expect(model("IntegrationInboundApplication")).toBeDefined();
    expect(model("IntegrationConflict")).toBeDefined();
    for (const [name, type] of [
      ["remoteEntityType", "String"],
      ["remoteId", "String"],
      ["remoteUpdatedAt", "DateTime"],
      ["applicationKey", "String"],
      ["correlationId", "String"],
      ["state", "InboundApplicationState"],
      ["fence", "Int"],
      ["bindingId", "String"],
    ] as const) {
      expect(field("IntegrationInboundApplication", name)).toMatchObject({
        type,
        isRequired: true,
      });
    }
    for (const name of ["leaseToken", "leaseUntil", "refId", "workId", "outcome"])
      expect(field("IntegrationInboundApplication", name)).toMatchObject({ isRequired: false });
    expect(field("IntegrationInboundApplication", "state")?.default).toBe("claimed");
    expect(field("IntegrationInboundApplication", "fence")?.default).toBe(0);
    expect(field("IntegrationInboundApplication", "applicationKey")?.isUnique).toBe(true);
    expect(model("IntegrationInboundApplication")?.uniqueFields).toEqual(
      expect.arrayContaining([
        [
          "bindingId",
          "remoteEntityType",
          "remoteParentType",
          "remoteParentId",
          "remoteId",
          "sourceVersion",
        ],
      ]),
    );
    expect(field("IntegrationInboundApplication", "sourceVersion")?.isRequired).toBe(false);
    expect(field("IntegrationInboundApplication", "remoteParentType")?.default).toBe("");
    expect(field("IntegrationInboundApplication", "remoteParentId")?.default).toBe("");
    for (const [name, type] of [
      ["kind", "String"],
      ["state", "ConflictState"],
      ["localEvidence", "Json"],
      ["remoteEvidence", "Json"],
      ["bindingId", "String"],
    ] as const) {
      expect(field("IntegrationConflict", name)).toMatchObject({ type, isRequired: true });
    }
    for (const name of ["workId", "refId", "applicationId"])
      expect(field("IntegrationConflict", name)).toMatchObject({ isRequired: false });
    expect(field("IntegrationConflict", "state")?.default).toBe("open");
  });

  it("persists source-keyed replay state and conflict evidence", async () => {
    const { binding, externalRef, work } = await createFixture();
    const remoteUpdatedAt = new Date("2026-07-27T12:30:00.000Z");
    const application = await prisma.integrationInboundApplication.create({
      data: {
        remoteEntityType: "issue",
        remoteId: "remote-application-issue",
        remoteUpdatedAt,
        sourceVersion: "sha256:version-1",
        applicationKey: "application-key-1",
        correlationId: "remote-correlation-1",
        leaseToken: "application-lease-1",
        leaseUntil: new Date("2026-07-27T12:31:00.000Z"),
        bindingId: binding.id,
        refId: externalRef.id,
        workId: work.id,
      },
    });
    expect(application).toMatchObject({
      remoteId: "remote-application-issue",
      applicationKey: "application-key-1",
      correlationId: "remote-correlation-1",
      state: "claimed",
      fence: 0,
      refId: externalRef.id,
      workId: work.id,
      outcome: null,
    });
    const duplicate = {
      remoteEntityType: "issue",
      remoteId: "remote-application-issue",
      remoteUpdatedAt,
      bindingId: binding.id,
    };
    await expect(
      prisma.integrationInboundApplication.create({
        data: {
          ...duplicate,
          sourceVersion: "sha256:version-2",
          applicationKey: "same-timestamp-source",
          correlationId: "same-timestamp-source",
        },
      })
    ).resolves.toMatchObject({ sourceVersion: "sha256:version-2" });
    await expect(
      prisma.integrationInboundApplication.create({
        data: {
          ...duplicate,
          remoteUpdatedAt: new Date("2026-07-27T12:30:01.000Z"),
          sourceVersion: "sha256:version-3",
          applicationKey: "application-key-1",
          correlationId: "duplicate-key",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.integrationInboundApplication.create({
        data: {
          ...duplicate,
          remoteUpdatedAt: new Date("2026-07-27T12:30:01.000Z"),
          sourceVersion: "sha256:version-1",
          applicationKey: "duplicate-source-version",
          correlationId: "duplicate-source-version",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      prisma.integrationInboundApplication.create({
        data: {
          ...duplicate,
          remoteUpdatedAt: new Date("2026-07-27T12:30:01.000Z"),
          sourceVersion: "sha256:version-3",
          applicationKey: "application-key-2",
          correlationId: "remote-correlation-2",
        },
      })
    ).resolves.toMatchObject({ state: "claimed", fence: 0 });
    const conflict = await prisma.integrationConflict.create({
      data: {
        bindingId: binding.id,
        kind: "same-field",
        localEvidence: { localVersion: 4, value: "kanon" },
        remoteEvidence: { value: "redmine" },
        applicationId: application.id,
        refId: externalRef.id,
        workId: work.id,
      },
    });
    expect(conflict).toMatchObject({
      kind: "same-field",
      state: "open",
      localEvidence: { localVersion: 4, value: "kanon" },
      applicationId: application.id,
      refId: externalRef.id,
      workId: work.id,
    });
    await expect(
      prisma.integrationConflict.update({ where: { id: conflict.id }, data: { state: "resolved" } })
    ).resolves.toMatchObject({ state: "resolved" });
  });

  it("applies SetNull optional links and binding Cascade", async () => {
    const { binding, externalRef, work } = await createFixture();
    const application = await prisma.integrationInboundApplication.create({
      data: {
        remoteEntityType: "issue",
        remoteId: "remote-delete",
        remoteUpdatedAt: new Date("2026-07-27T13:00:00.000Z"),
        applicationKey: "application-delete-key",
        correlationId: "remote-delete-correlation",
        bindingId: binding.id,
        refId: externalRef.id,
        workId: work.id,
      },
    });
    const conflict = await prisma.integrationConflict.create({
      data: {
        bindingId: binding.id,
        kind: "close-blocked",
        localEvidence: { reason: "time" },
        remoteEvidence: { requested: "done" },
        applicationId: application.id,
        refId: externalRef.id,
        workId: work.id,
      },
    });
    await prisma.externalRef.delete({ where: { id: externalRef.id } });
    await expect(
      prisma.integrationInboundApplication.findUnique({ where: { id: application.id } })
    ).resolves.toMatchObject({ refId: null, workId: work.id });
    await expect(
      prisma.integrationConflict.findUnique({ where: { id: conflict.id } })
    ).resolves.toMatchObject({ refId: null, workId: work.id, applicationId: application.id });
    await prisma.integrationSyncWork.delete({ where: { id: work.id } });
    await expect(
      prisma.integrationInboundApplication.findUnique({ where: { id: application.id } })
    ).resolves.toMatchObject({ refId: null, workId: null });
    await prisma.integrationInboundApplication.delete({ where: { id: application.id } });
    await expect(
      prisma.integrationConflict.findUnique({ where: { id: conflict.id } })
    ).resolves.toMatchObject({ applicationId: null });
    await prisma.integrationProjectBinding.delete({ where: { id: binding.id } });
    await expect(
      prisma.integrationConflict.findUnique({ where: { id: conflict.id } })
    ).resolves.toBeNull();
  });

  it("creates the source replay and conflict state indexes", async () => {
    const indexes = await prisma.$queryRaw<
      Array<{ indexname: string }>
    >`SELECT indexname FROM pg_indexes WHERE tablename IN ('integration_inbound_applications', 'integration_conflicts')`;
    expect(indexes.map(({ indexname }) => indexname)).toEqual(
      expect.arrayContaining([
        "integration_inbound_applications_application_key_key",
        "uq_inbound_application_source",
        "integration_conflicts_binding_id_state_idx",
      ])
    );
  });

  it(
    "upgrades pre-A1.4 rows and applies the exact adjacent A1.5 migration",
    { timeout: 120000 },
    async () => {
      await runApplicationUpgradePath();
    }
  );
});
