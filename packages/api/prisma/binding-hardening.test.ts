import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Prisma, PrismaClient } from "@prisma/client";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/config/prisma.js";
import {
  ExternalRefBindingProofError,
  proveExternalRefBindings,
} from "../src/modules/integrations/backfill.js";
import { cleanDatabase, disconnectTestDb } from "../src/test/helpers.js";

const externalRef = Prisma.dmmf.datamodel.models.find(({ name }) => name === "ExternalRef");
const execFileAsync = promisify(execFile);
const prismaDirectory = dirname(fileURLToPath(import.meta.url));
const apiDirectory = dirname(prismaDirectory);
const migrationsDirectory = join(prismaDirectory, "migrations");
const migrationName = "20260805125112_external_ref_binding_hardening";
const migrationPath = join(migrationsDirectory, migrationName, "migration.sql");

function quoteIdentifier(identifier: string) {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function deployMigrations(directory: string, databaseUrl: string) {
  return execFileAsync(
    "pnpm",
    ["exec", "prisma", "migrate", "deploy", "--schema", join(directory, "schema.prisma")],
    {
      cwd: apiDirectory,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

async function resolveRolledBackMigration(directory: string, databaseUrl: string) {
  return execFileAsync(
    "pnpm",
    [
      "exec",
      "prisma",
      "migrate",
      "resolve",
      "--rolled-back",
      migrationName,
      "--schema",
      join(directory, "schema.prisma"),
    ],
    {
      cwd: apiDirectory,
      env: { ...process.env, DATABASE_URL: databaseUrl },
      maxBuffer: 10 * 1024 * 1024,
    },
  );
}

async function prepareMigrationWorkspace(directory: string, names: readonly string[]) {
  const target = join(directory, "migrations");
  await mkdir(target);
  await cp(join(migrationsDirectory, "migration_lock.toml"), join(target, "migration_lock.toml"));
  await cp(join(prismaDirectory, "schema.prisma"), join(directory, "schema.prisma"));
  for (const name of names) {
    await cp(join(migrationsDirectory, name), join(target, name), { recursive: true });
  }
}

async function seedUpgradeFixture(database: PrismaClient, unresolved: boolean) {
  const workspace = await database.workspace.create({
    data: { name: "Binding upgrade", slug: `binding-upgrade-${randomUUID()}` },
  });
  const project = await database.project.create({
    data: {
      key: `BU${randomUUID().slice(0, 4).toUpperCase()}`,
      name: "Binding upgrade",
      workspaceId: workspace.id,
    },
  });
  const connection = await database.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://upgrade-redmine.example.test",
      workspaceId: workspace.id,
    },
  });
  const bindingId = randomUUID();
  await database.$executeRaw`
    INSERT INTO "integration_project_bindings" (
      "id", "connection_id", "project_id", "remote_project_id", "read_map", "write_map",
      "created_at", "updated_at"
    ) VALUES (
      ${bindingId}::uuid, ${connection.id}::uuid, ${project.id}::uuid,
      'binding-upgrade', '{}'::jsonb, '{}'::jsonb, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
    )
  `;
  const ref = await database.externalRef.create({
    data: {
      connectionId: connection.id,
      bindingId,
      entityType: "project",
      entityId: project.id,
      externalId: "binding-upgrade",
      metadata: { preserved: true },
    },
  });
  let unresolvedProjectId: string | undefined;
  if (unresolved) {
    const unresolvedProject = await database.project.create({
      data: {
        key: `UU${randomUUID().slice(0, 4).toUpperCase()}`,
        name: "Unresolved binding",
        workspaceId: workspace.id,
      },
    });
    unresolvedProjectId = unresolvedProject.id;
    await database.$executeRaw`
      INSERT INTO "external_refs" (
        "id", "entity_type", "entity_id", "external_id", "updated_at", "connection_id"
      ) VALUES (
        ${randomUUID()}::uuid, 'project', ${unresolvedProject.id}::uuid, 'unresolved-upgrade',
        CURRENT_TIMESTAMP, ${connection.id}::uuid
      )
    `;
  }
  return {
    refId: ref.id,
    bindingId,
    connectionId: connection.id,
    workspaceId: workspace.id,
    projectId: project.id,
    unresolvedProjectId,
  };
}

async function runUpgrade(unresolved: boolean) {
  const baseUrl = new URL(
    process.env["DATABASE_URL"] ?? "postgresql://kanon:kanon@localhost:5432/kanon_test",
  );
  const schemaName = `binding_upgrade_${randomUUID().replaceAll("-", "")}`;
  const adminUrl = new URL(baseUrl);
  adminUrl.searchParams.set("schema", "public");
  const databaseUrl = new URL(baseUrl);
  databaseUrl.searchParams.set("schema", schemaName);
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const directory = await mkdtemp(join(tmpdir(), "kanon-binding-upgrade-"));
  let database: PrismaClient | undefined;

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    database = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
    await expect(proveExternalRefBindings(database)).resolves.toBeUndefined();
    await database.$executeRawUnsafe('CREATE TABLE "external_refs" ("id" UUID PRIMARY KEY)');
    await expect(proveExternalRefBindings(database)).resolves.toBeUndefined();
    await database.$executeRawUnsafe('DROP TABLE "external_refs"');
    await database.$disconnect();
    database = undefined;
    const names = (await readdir(migrationsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const migrationIndex = names.indexOf(migrationName);
    if (migrationIndex < 0) throw new Error(`Missing ${migrationName}`);
    await prepareMigrationWorkspace(directory, names.slice(0, migrationIndex));
    await deployMigrations(directory, databaseUrl.toString());

    database = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
    const fixture = await seedUpgradeFixture(database, unresolved);
    if (unresolved) {
      await expect(proveExternalRefBindings(database)).rejects.toMatchObject({
        name: ExternalRefBindingProofError.name,
        diagnostics: [{ reason: "unbound-reference", count: 1 }],
      });
    } else {
      await expect(proveExternalRefBindings(database)).resolves.toBeUndefined();
      const otherConnection = await database.integrationConnection.create({
        data: {
          provider: "other",
          baseUrl: "https://other-upgrade.example.test",
          workspaceId: fixture.workspaceId,
        },
      });
      const duplicateId = randomUUID();
      await database.$executeRaw`
        INSERT INTO "external_refs" (
          "id", "entity_type", "entity_id", "external_id", "updated_at",
          "connection_id", "binding_id"
        ) VALUES (
          ${duplicateId}::uuid, 'project', ${fixture.projectId}::uuid, 'binding-upgrade',
          CURRENT_TIMESTAMP, ${otherConnection.id}::uuid, ${fixture.bindingId}::uuid
        )
      `;
      await expect(proveExternalRefBindings(database)).rejects.toMatchObject({
        name: ExternalRefBindingProofError.name,
        diagnostics: [
          { reason: "binding-mismatch", count: 1 },
          { reason: "duplicate-binding-remote-reference", count: 1 },
        ],
      });
      await database.externalRef.delete({ where: { id: duplicateId } });
      await expect(proveExternalRefBindings(database)).resolves.toBeUndefined();
    }
    await database.$disconnect();
    database = undefined;
    await cp(
      join(migrationsDirectory, migrationName),
      join(directory, "migrations", migrationName),
      { recursive: true },
    );

    const deployment = deployMigrations(directory, databaseUrl.toString());
    if (unresolved) await expect(deployment).rejects.toThrow();
    else await deployment;

    database = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
    const [column] = await database.$queryRaw<Array<{ is_nullable: string }>>`
      SELECT is_nullable
      FROM information_schema.columns
      WHERE table_schema = ${schemaName}
        AND table_name = 'external_refs'
        AND column_name = 'binding_id'
    `;
    const [foreignKey] = await database.$queryRaw<Array<{ delete_action: string }>>`
      SELECT confdeltype::text AS delete_action
      FROM pg_constraint
      WHERE conname = 'external_refs_binding_id_fkey'
        AND connamespace = ${schemaName}::regnamespace
    `;
    if (unresolved) {
      expect(column?.is_nullable).toBe("YES");
      expect(foreignKey?.delete_action).toBe("n");
      await expect(database.externalRef.count()).resolves.toBe(2);
      if (!fixture.unresolvedProjectId) throw new Error("Missing unresolved upgrade project");
      const repairedBindingId = randomUUID();
      await database.$executeRaw`
        INSERT INTO "integration_project_bindings" (
          "id", "connection_id", "project_id", "remote_project_id", "read_map", "write_map",
          "created_at", "updated_at"
        ) VALUES (
          ${repairedBindingId}::uuid, ${fixture.connectionId}::uuid,
          ${fixture.unresolvedProjectId}::uuid, 'repaired-binding', '{}'::jsonb, '{}'::jsonb,
          CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
        )
      `;
      await database.$executeRaw`
        UPDATE "external_refs"
        SET "binding_id" = ${repairedBindingId}::uuid
        WHERE "binding_id" IS NULL
      `;
      await expect(proveExternalRefBindings(database)).resolves.toBeUndefined();
      await database.$disconnect();
      database = undefined;
      await resolveRolledBackMigration(directory, databaseUrl.toString());
      await deployMigrations(directory, databaseUrl.toString());
      database = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
      const [recovered] = await database.$queryRaw<Array<{ is_nullable: string }>>`
        SELECT is_nullable
        FROM information_schema.columns
        WHERE table_schema = ${schemaName}
          AND table_name = 'external_refs'
          AND column_name = 'binding_id'
      `;
      expect(recovered?.is_nullable).toBe("NO");
      await expect(database.externalRef.count()).resolves.toBe(2);
      await expect(
        database.externalRef.findUniqueOrThrow({
          where: {
            connectionId_entityType_externalId: {
              connectionId: fixture.connectionId,
              entityType: "project",
              externalId: "unresolved-upgrade",
            },
          },
        }),
      ).resolves.toMatchObject({ bindingId: repairedBindingId });
    } else {
      expect(column?.is_nullable).toBe("NO");
      expect(foreignKey?.delete_action).toBe("r");
      await expect(database.externalRef.findUniqueOrThrow({ where: { id: fixture.refId } }))
        .resolves.toMatchObject({ bindingId: fixture.bindingId, metadata: { preserved: true } });
    }
  } finally {
    if (database) await database.$disconnect().catch(() => undefined);
    await admin
      .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
      .catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function runLegacyOwnershipProof(beforeMigrationName: string) {
  const baseUrl = new URL(
    process.env["DATABASE_URL"] ?? "postgresql://kanon:kanon@localhost:5432/kanon_test",
  );
  const schemaName = `binding_proof_${randomUUID().replaceAll("-", "")}`;
  const adminUrl = new URL(baseUrl);
  adminUrl.searchParams.set("schema", "public");
  const databaseUrl = new URL(baseUrl);
  databaseUrl.searchParams.set("schema", schemaName);
  const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
  const directory = await mkdtemp(join(tmpdir(), "kanon-binding-proof-"));
  let database: PrismaClient | undefined;

  try {
    await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
    const names = (await readdir(migrationsDirectory, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    const migrationIndex = names.indexOf(beforeMigrationName);
    if (migrationIndex < 0) throw new Error(`Missing ${beforeMigrationName}`);
    await prepareMigrationWorkspace(directory, names.slice(0, migrationIndex));
    await deployMigrations(directory, databaseUrl.toString());

    database = new PrismaClient({ datasourceUrl: databaseUrl.toString() });
    await expect(proveExternalRefBindings(database)).resolves.toBeUndefined();

    const workspaceId = randomUUID();
    const projectId = randomUUID();
    const connectionId = randomUUID();
    const bindingId = randomUUID();
    await database.$transaction([
      database.$executeRaw`
        INSERT INTO "workspaces" ("id", "name", "slug", "updated_at")
        VALUES (${workspaceId}::uuid, 'Legacy proof', ${`legacy-proof-${workspaceId}`} , CURRENT_TIMESTAMP)
      `,
      database.$executeRaw`
        INSERT INTO "projects" ("id", "key", "name", "workspace_id", "updated_at")
        VALUES (${projectId}::uuid, 'LEG', 'Legacy proof', ${workspaceId}::uuid, CURRENT_TIMESTAMP)
      `,
      database.$executeRaw`
        INSERT INTO "integration_connections" (
          "id", "provider", "base_url", "workspace_id", "lifecycle", "updated_at"
        ) VALUES (
          ${connectionId}::uuid, 'redmine', 'https://legacy-proof.example.test',
          ${workspaceId}::uuid, 'active'::"IntegrationLifecycle", CURRENT_TIMESTAMP
        )
      `,
      database.$executeRaw`
        INSERT INTO "integration_project_bindings" (
          "id", "remote_project_id", "read_map", "write_map", "lifecycle",
          "connection_id", "project_id", "updated_at"
        ) VALUES (
          ${bindingId}::uuid, 'legacy-project', '{}'::jsonb, '{}'::jsonb,
          'active'::"IntegrationLifecycle", ${connectionId}::uuid, ${projectId}::uuid,
          CURRENT_TIMESTAMP
        )
      `,
      database.$executeRaw`
        INSERT INTO "external_refs" (
          "id", "entity_type", "entity_id", "external_id", "connection_id", "binding_id",
          "updated_at"
        ) VALUES (
          ${randomUUID()}::uuid, 'issue', ${randomUUID()}::uuid, 'legacy-orphan',
          ${connectionId}::uuid, ${bindingId}::uuid, CURRENT_TIMESTAMP
        )
      `,
    ]);

    await expect(proveExternalRefBindings(database)).rejects.toMatchObject({
      name: ExternalRefBindingProofError.name,
      diagnostics: [{ reason: "local-entity-not-found", count: 1 }],
    });
  } finally {
    if (database) await database.$disconnect().catch(() => undefined);
    await admin
      .$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`)
      .catch(() => undefined);
    await admin.$disconnect().catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
  }
}

async function createFixture() {
  const workspace = await prisma.workspace.create({
    data: { name: "Binding hardening", slug: `binding-hardening-${randomUUID()}` },
  });
  const project = await prisma.project.create({
    data: {
      key: `BH${randomUUID().slice(0, 4).toUpperCase()}`,
      name: "Binding hardening",
      workspaceId: workspace.id,
    },
  });
  const connection = await prisma.integrationConnection.create({
    data: {
      provider: "redmine",
      baseUrl: "https://redmine.example.test",
      workspaceId: workspace.id,
    },
  });
  const binding = await prisma.integrationProjectBinding.create({
    data: {
      connectionId: connection.id,
      projectId: project.id,
      remoteProjectId: "binding-hardening",
      readMap: {},
      writeMap: {},
    },
  });
  const ref = await prisma.externalRef.create({
    data: {
      connectionId: connection.id,
      bindingId: binding.id,
      entityType: "project",
      entityId: project.id,
      externalId: "remote-project",
    },
  });
  return { connection, binding, project, ref };
}

describe("ExternalRef binding hardening", () => {
  beforeEach(cleanDatabase);
  afterAll(async () => {
    await cleanDatabase();
    await disconnectTestDb();
  });

  it("requires one binding and restricts binding deletion in the Prisma contract", () => {
    expect(externalRef?.fields.find(({ name }) => name === "bindingId")).toMatchObject({
      isRequired: true,
    });
    expect(externalRef?.fields.find(({ name }) => name === "binding")).toMatchObject({
      isRequired: true,
      relationOnDelete: "Restrict",
    });
  });

  it("rejects nullable and invalid bindings while preserving referenced data", async () => {
    const { binding, connection, ref } = await createFixture();

    await expect(
      prisma.$executeRaw`
        INSERT INTO "external_refs" (
          "id", "entity_type", "entity_id", "external_id", "updated_at", "connection_id"
        ) VALUES (
          ${randomUUID()}::uuid, 'project', ${randomUUID()}::uuid, 'unbound-project',
          CURRENT_TIMESTAMP, ${connection.id}::uuid
        )
      `,
    ).rejects.toThrow();
    await expect(
      prisma.externalRef.create({
        data: {
          connectionId: connection.id,
          bindingId: randomUUID(),
          entityType: "project",
          entityId: randomUUID(),
          externalId: "invalid-binding",
        },
      }),
    ).rejects.toMatchObject({ code: "P2003" });
    const otherConnection = await prisma.integrationConnection.create({
      data: {
        provider: "other",
        baseUrl: "https://other-redmine.example.test",
        workspaceId: connection.workspaceId,
      },
    });
    await expect(
      prisma.$executeRaw`
        INSERT INTO "external_refs" (
          "id", "entity_type", "entity_id", "external_id", "updated_at",
          "connection_id", "binding_id"
        ) VALUES (
          ${randomUUID()}::uuid, 'project', ${randomUUID()}::uuid, 'remote-project',
          CURRENT_TIMESTAMP, ${otherConnection.id}::uuid, ${binding.id}::uuid
        )
      `,
    ).rejects.toThrow();
    await expect(
      prisma.integrationProjectBinding.delete({ where: { id: binding.id } }),
    ).rejects.toMatchObject({ code: "P2003" });
    await expect(prisma.externalRef.findUnique({ where: { id: ref.id } })).resolves.toMatchObject({
      bindingId: binding.id,
    });
  });

  it("installs binding-scoped remote-reference uniqueness", async () => {
    const indexes = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef
      FROM pg_indexes
      WHERE tablename = 'external_refs'
    `;

    expect(indexes.some(({ indexdef }) =>
      indexdef.includes('(binding_id, entity_type, external_id)')
    )).toBe(true);
  });

  it("keeps the generated migration focused and data-preserving", async () => {
    const [sql, dockerfile, compose, migrator] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(join(apiDirectory, "Dockerfile"), "utf8"),
      readFile(join(apiDirectory, "..", "..", "docker-compose.production.yml"), "utf8"),
      readFile(join(apiDirectory, "src", "scripts", "one-shot-migrator.ts"), "utf8"),
    ]);

    expect(sql).toContain('ALTER TABLE "external_refs" ALTER COLUMN "binding_id" SET NOT NULL');
    expect(sql).toContain('ON DELETE RESTRICT');
    expect(sql).toContain('("binding_id", "entity_type", "external_id")');
    expect(sql).not.toMatch(
      /^(?:UPDATE|DELETE FROM|TRUNCATE|DROP TABLE|ALTER TABLE .* DROP COLUMN)\b/im,
    );
    expect(sql).not.toContain('"milestones"');
    expect(sql).not.toContain('"time_entries"');
    expect(compose).toContain('command: ["node", "dist/scripts/one-shot-migrator.js"]');
    expect(compose).toMatch(/kanon-api:[\s\S]*kanon-migrate:[\s\S]*service_completed_successfully/);
    expect(dockerfile).toContain('CMD ["node", "dist/index.js"]');
    expect(dockerfile).not.toMatch(/(?:backfill|prisma migrate deploy)/);
    const migrateIndex = migrator.indexOf("await dependencies.migrate(");
    const proofIndex = migrator.indexOf("await dependencies.proveBindings(");
    expect(proofIndex).toBeGreaterThanOrEqual(0);
    expect(migrateIndex).toBeGreaterThan(proofIndex);
  });

  it("upgrades valid references without changing their data", { timeout: 120_000 }, async () => {
    await runUpgrade(false);
  });

  it("rolls back the migration when an unresolved reference remains", { timeout: 120_000 }, async () => {
    await runUpgrade(true);
  });

  it("proves legacy ownership before the sync outbox schema exists", { timeout: 120_000 }, async () => {
    await runLegacyOwnershipProof("20260722_pm_work_outbox");
  });

  it("proves legacy ownership before the bootstrap schema exists", { timeout: 120_000 }, async () => {
    await runLegacyOwnershipProof("20260803135500_redmine_inbound_bootstrap_state");
  });
});
