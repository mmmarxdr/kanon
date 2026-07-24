/**
 * DB-backed lifecycle and project-binding contract (KAN-182 A1.2).
 *
 * RED: the lifecycle enum and binding model do not exist before this slice.
 * GREEN: Prisma generation plus the additive migration make these records
 * persist with draft-safe defaults and binding uniqueness.
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

const lifecycleValues = ["draft", "active", "pausing", "paused", "disabled"];
const workspaces = new Set<string>();
const { datamodel } = Prisma.dmmf;
const execFileAsync = promisify(execFile);
const prismaDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = dirname(prismaDirectory);
const migrationsDirectory = join(prismaDirectory, "migrations");
const lifecycleMigrationName = "20260720_pm_lifecycle_binding";
const previousMigrationName = "20260626120000_integration_tables";

const upgradeFixture = {
  workspaceId: "00000000-0000-4000-8000-000000000101",
  firstProjectId: "00000000-0000-4000-8000-000000000102",
  secondProjectId: "00000000-0000-4000-8000-000000000103",
  connectionId: "00000000-0000-4000-8000-000000000104",
  existingRefId: "00000000-0000-4000-8000-000000000105",
  existingEntityId: "00000000-0000-4000-8000-000000000106",
  boundRefId: "00000000-0000-4000-8000-000000000107",
  boundEntityId: "00000000-0000-4000-8000-000000000108",
};

function model(name: string) {
  return datamodel.models.find((candidate) => candidate.name === name);
}

function field(modelName: string, fieldName: string) {
  return model(modelName)?.fields.find((candidate) => candidate.name === fieldName);
}

async function createWorkspace() {
  const workspace = await prisma.workspace.create({
    data: { name: "Lifecycle Test Workspace", slug: `lifecycle-${randomUUID()}` },
  });
  workspaces.add(workspace.id);
  return workspace;
}

async function createProject(workspaceId: string) {
  return prisma.project.create({
    data: {
      key: `L${randomUUID().slice(0, 5).toUpperCase()}`,
      name: "Lifecycle Test Project",
      workspaceId,
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

async function seedPreLifecycleRows(database: PrismaClient) {
  await database.$executeRaw`
    INSERT INTO "workspaces" ("id", "name", "slug", "updated_at")
    VALUES (
      ${upgradeFixture.workspaceId}::uuid,
      'A1.2 upgrade fixture',
      'a12-upgrade-fixture',
      CURRENT_TIMESTAMP
    )
  `;
  await database.$executeRaw`
    INSERT INTO "projects" ("id", "key", "name", "updated_at", "workspace_id")
    VALUES (
      ${upgradeFixture.firstProjectId}::uuid,
      'UPG1',
      'A1.2 first project',
      CURRENT_TIMESTAMP,
      ${upgradeFixture.workspaceId}::uuid
    ), (
      ${upgradeFixture.secondProjectId}::uuid,
      'UPG2',
      'A1.2 second project',
      CURRENT_TIMESTAMP,
      ${upgradeFixture.workspaceId}::uuid
    )
  `;
  await database.$executeRaw`
    INSERT INTO "integration_connections" (
      "id",
      "provider",
      "base_url",
      "discovered_statuses",
      "status_map_read",
      "status_map_write",
      "updated_at",
      "workspace_id"
    )
    VALUES (
      ${upgradeFixture.connectionId}::uuid,
      'redmine',
      'https://pm.example.test',
      ${JSON.stringify([{ id: "1", name: "Open" }])}::jsonb,
      ${JSON.stringify({ "1": "todo" })}::jsonb,
      ${JSON.stringify({ todo: "1" })}::jsonb,
      CURRENT_TIMESTAMP,
      ${upgradeFixture.workspaceId}::uuid
    )
  `;
  await database.$executeRaw`
    INSERT INTO "external_refs" (
      "id",
      "entity_type",
      "entity_id",
      "external_id",
      "external_url",
      "metadata",
      "updated_at",
      "connection_id"
    )
    VALUES (
      ${upgradeFixture.existingRefId}::uuid,
      'issue',
      ${upgradeFixture.existingEntityId}::uuid,
      '42',
      'https://pm.example.test/issues/42',
      ${JSON.stringify({ source: "kan-181" })}::jsonb,
      CURRENT_TIMESTAMP,
      ${upgradeFixture.connectionId}::uuid
    )
  `;
}

async function createBinding(
  connectionId: string,
  projectId: string,
  remoteProjectId = "remote-project-1"
) {
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

afterEach(async () => {
  for (const id of workspaces) {
    await prisma.workspace.delete({ where: { id } });
  }
  workspaces.clear();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("integration lifecycle schema", () => {
  it("defines the provider-neutral lifecycle states", () => {
    const lifecycle = datamodel.enums.find((item) => item.name === "IntegrationLifecycle");
    expect(lifecycle?.values.map(({ name }) => name)).toEqual(lifecycleValues);
  });

  it("defaults connections and bindings to a resumable draft", () => {
    expect(field("IntegrationConnection", "lifecycle")?.default).toBe("draft");
    expect(field("IntegrationConnection", "lifecycleEpoch")?.default).toBe(0);
    expect(field("IntegrationConnection", "serviceFallbackEnabled")?.default).toBe(false);
    expect(field("IntegrationProjectBinding", "lifecycle")?.default).toBe("draft");
    expect(field("IntegrationProjectBinding", "lifecycleEpoch")?.default).toBe(0);
    expect(field("IntegrationProjectBinding", "pollFence")?.default).toBe(0);
  });

  it("requires the binding project maps and keeps its cursor/lease fields nullable", () => {
    expect(field("IntegrationProjectBinding", "connectionId")?.isRequired).toBe(true);
    expect(field("IntegrationProjectBinding", "projectId")?.isRequired).toBe(true);
    expect(field("IntegrationProjectBinding", "remoteProjectId")?.isRequired).toBe(true);
    expect(field("IntegrationProjectBinding", "readMap")?.isRequired).toBe(true);
    expect(field("IntegrationProjectBinding", "writeMap")?.isRequired).toBe(true);
    expect(field("IntegrationProjectBinding", "cursorUpdatedAt")?.isRequired).toBe(false);
    expect(field("IntegrationProjectBinding", "pollLeaseUntil")?.isRequired).toBe(false);
  });

  it("persists a draft connection and binding with database defaults", async () => {
    const workspace = await createWorkspace();
    const project = await createProject(workspace.id);
    const connection = await prisma.integrationConnection.create({
      data: { provider: "redmine", baseUrl: "https://pm.example.test", workspaceId: workspace.id },
    });
    const binding = await createBinding(connection.id, project.id);
    const stored = await prisma.integrationProjectBinding.findUnique({ where: { id: binding.id } });

    expect(connection).toMatchObject({
      lifecycle: "draft",
      lifecycleEpoch: 0,
      serviceFallbackEnabled: false,
    });
    expect(stored).toMatchObject({ lifecycle: "draft", lifecycleEpoch: 0, pollFence: 0 });
    expect(stored?.cursorUpdatedAt).toBeNull();
    expect(stored?.pollLeaseUntil).toBeNull();
  });

  it("allows an explicit pause and rejects duplicate project or remote bindings", async () => {
    const workspace = await createWorkspace();
    const firstProject = await createProject(workspace.id);
    const secondProject = await createProject(workspace.id);
    const connection = await prisma.integrationConnection.create({
      data: { provider: "redmine", baseUrl: "https://pm.example.test", workspaceId: workspace.id },
    });
    const binding = await createBinding(connection.id, firstProject.id);
    const paused = await prisma.integrationProjectBinding.update({
      where: { id: binding.id },
      data: { lifecycle: "paused", lifecycleEpoch: 2 },
    });

    expect(paused).toMatchObject({ lifecycle: "paused", lifecycleEpoch: 2 });
    await expect(
      createBinding(connection.id, firstProject.id, "remote-project-2")
    ).rejects.toThrow();
    await expect(createBinding(connection.id, secondProject.id)).rejects.toThrow();
  });

  it(
    "upgrades pre-existing KAN-181 rows through the lifecycle binding migration",
    { timeout: 120000 },
    async () => {
      const baseDatabaseUrl = new URL(
        process.env["DATABASE_URL"] ?? "postgresql://kanon:kanon@localhost:5432/kanon_test"
      );
      const schemaName = `lifecycle_upgrade_${randomUUID().replaceAll("-", "")}`;
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
        if (
          lifecycleMigrationIndex < 1 ||
          migrationNames[lifecycleMigrationIndex - 1] !== previousMigrationName
        ) {
          throw new Error(
            `Expected ${previousMigrationName} to immediately precede ${lifecycleMigrationName}`
          );
        }

        temporaryDirectory = await mkdtemp(join(tmpdir(), "kanon-lifecycle-upgrade-"));
        await prepareMigrationWorkspace(
          temporaryDirectory,
          migrationNames.slice(0, lifecycleMigrationIndex)
        );
        await deployMigrations(temporaryDirectory, isolatedDatabaseUrl.toString());

        const preMigrationDatabase = new PrismaClient({
          datasourceUrl: isolatedDatabaseUrl.toString(),
        });
        database = preMigrationDatabase;
        await seedPreLifecycleRows(preMigrationDatabase);
        await preMigrationDatabase.$disconnect();
        database = undefined;

        await cp(
          join(migrationsDirectory, lifecycleMigrationName),
          join(temporaryDirectory, "migrations", lifecycleMigrationName),
          { recursive: true }
        );
        await deployMigrations(temporaryDirectory, isolatedDatabaseUrl.toString());

        const upgradedDatabase = new PrismaClient({
          datasourceUrl: isolatedDatabaseUrl.toString(),
        });
        database = upgradedDatabase;

        const existingConnection = await upgradedDatabase.integrationConnection.findUnique({
          where: { id: upgradeFixture.connectionId },
        });
        expect(existingConnection).toMatchObject({
          id: upgradeFixture.connectionId,
          provider: "redmine",
          baseUrl: "https://pm.example.test",
          lifecycle: "draft",
          lifecycleEpoch: 0,
          serviceFallbackEnabled: false,
        });

        const existingRef = await upgradedDatabase.externalRef.findUnique({
          where: { id: upgradeFixture.existingRefId },
        });
        expect(existingRef).toMatchObject({
          id: upgradeFixture.existingRefId,
          connectionId: upgradeFixture.connectionId,
          entityType: "issue",
          externalId: "42",
          bindingId: null,
          remoteUpdatedAt: null,
          localVersion: 0n,
          lastCorrelationId: null,
        });
        expect(existingRef?.metadata).toEqual({ source: "kan-181" });

        const setNullBinding = await upgradedDatabase.integrationProjectBinding.create({
          data: {
            connectionId: upgradeFixture.connectionId,
            projectId: upgradeFixture.firstProjectId,
            remoteProjectId: "remote-project-set-null",
            readMap: { "remote-open": "todo" },
            writeMap: { todo: "remote-open" },
          },
        });
        expect(setNullBinding).toMatchObject({
          connectionId: upgradeFixture.connectionId,
          projectId: upgradeFixture.firstProjectId,
          lifecycle: "draft",
          lifecycleEpoch: 0,
          pollFence: 0,
          cursorUpdatedAt: null,
          pollLeaseUntil: null,
        });

        await upgradedDatabase.externalRef.create({
          data: {
            id: upgradeFixture.boundRefId,
            entityType: "issue",
            entityId: upgradeFixture.boundEntityId,
            externalId: "43",
            metadata: { source: "upgrade-test" },
            connectionId: upgradeFixture.connectionId,
            bindingId: setNullBinding.id,
          },
        });
        await upgradedDatabase.integrationProjectBinding.delete({
          where: { id: setNullBinding.id },
        });

        const detachedRef = await upgradedDatabase.externalRef.findUnique({
          where: { id: upgradeFixture.boundRefId },
        });
        expect(detachedRef).toMatchObject({
          id: upgradeFixture.boundRefId,
          connectionId: upgradeFixture.connectionId,
          bindingId: null,
        });

        const cascadeBinding = await upgradedDatabase.integrationProjectBinding.create({
          data: {
            connectionId: upgradeFixture.connectionId,
            projectId: upgradeFixture.secondProjectId,
            remoteProjectId: "remote-project-cascade",
            readMap: { "remote-open": "todo" },
            writeMap: { todo: "remote-open" },
          },
        });
        expect(cascadeBinding.connectionId).toBe(upgradeFixture.connectionId);
        await upgradedDatabase.integrationConnection.delete({
          where: { id: upgradeFixture.connectionId },
        });

        const deletedCascadeBinding = await upgradedDatabase.integrationProjectBinding.findUnique({
          where: { id: cascadeBinding.id },
        });
        expect(deletedCascadeBinding).toBeNull();
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
  );
});
