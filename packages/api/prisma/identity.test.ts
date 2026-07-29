/**
 * DB-backed identity and credential-health contract (KAN-182 A1.3).
 *
 * RED: credential health and IntegrationExternalIdentity do not exist before
 * this slice. GREEN: the additive migration persists health defaults and
 * binding-scoped identities without changing existing integration rows.
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
const workspaces = new Set<string>();
const users = new Set<string>();

const upgradeFixture = {
  workspaceId: "00000000-0000-4000-8000-000000000201",
  projectId: "00000000-0000-4000-8000-000000000202",
  secondProjectId: "00000000-0000-4000-8000-000000000203",
  userId: "00000000-0000-4000-8000-000000000204",
  secondUserId: "00000000-0000-4000-8000-000000000205",
  memberId: "00000000-0000-4000-8000-000000000206",
  secondMemberId: "00000000-0000-4000-8000-000000000207",
  connectionId: "00000000-0000-4000-8000-000000000208",
  credentialId: "00000000-0000-4000-8000-000000000209",
  firstBindingId: "00000000-0000-4000-8000-000000000210",
  secondBindingId: "00000000-0000-4000-8000-000000000211",
};

const legacyCredentialParts = {
  nonce: Buffer.from("legacy-nonce").toString("base64"),
  ciphertext: Buffer.from("legacy-ciphertext").toString("base64"),
  authTag: Buffer.from("0123456789abcdef").toString("base64"),
};
const legacyEncryptedKey = [
  "gcm.v1",
  legacyCredentialParts.nonce,
  legacyCredentialParts.ciphertext,
  legacyCredentialParts.authTag,
].join(":");

function model(name: string) {
  return datamodel.models.find((candidate) => candidate.name === name);
}

function field(modelName: string, fieldName: string) {
  return model(modelName)?.fields.find((candidate) => candidate.name === fieldName);
}

async function createWorkspace() {
  const workspace = await prisma.workspace.create({
    data: { name: "Identity Test Workspace", slug: `identity-${randomUUID()}` },
  });
  workspaces.add(workspace.id);
  return workspace;
}

async function createProject(workspaceId: string, name = "Identity Test Project") {
  return prisma.project.create({
    data: {
      key: `I${randomUUID().slice(0, 5).toUpperCase()}`,
      name,
      workspaceId,
    },
  });
}

async function createMember(workspaceId: string) {
  const user = await prisma.user.create({
    data: { email: `identity-${randomUUID()}@kanon.test`, passwordHash: "unused" },
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

async function seedPreIdentityRows(database: PrismaClient) {
  await database.$executeRaw`
    INSERT INTO "workspaces" ("id", "name", "slug", "updated_at")
    VALUES (
      ${upgradeFixture.workspaceId}::uuid,
      'A1.3 upgrade fixture',
      'a13-upgrade-fixture',
      CURRENT_TIMESTAMP
    )
  `;
  await database.$executeRaw`
    INSERT INTO "users" ("id", "email", "password_hash", "updated_at")
    VALUES (
      ${upgradeFixture.userId}::uuid,
      'a13-upgrade-one@kanon.test',
      'unused',
      CURRENT_TIMESTAMP
    ), (
      ${upgradeFixture.secondUserId}::uuid,
      'a13-upgrade-two@kanon.test',
      'unused',
      CURRENT_TIMESTAMP
    )
  `;
  await database.$executeRaw`
    INSERT INTO "members" ("id", "username", "updated_at", "user_id", "workspace_id")
    VALUES (
      ${upgradeFixture.memberId}::uuid,
      'a13-upgrade-one',
      CURRENT_TIMESTAMP,
      ${upgradeFixture.userId}::uuid,
      ${upgradeFixture.workspaceId}::uuid
    ), (
      ${upgradeFixture.secondMemberId}::uuid,
      'a13-upgrade-two',
      CURRENT_TIMESTAMP,
      ${upgradeFixture.secondUserId}::uuid,
      ${upgradeFixture.workspaceId}::uuid
    )
  `;
  await database.$executeRaw`
    INSERT INTO "projects" ("id", "key", "name", "updated_at", "workspace_id")
    VALUES (
      ${upgradeFixture.projectId}::uuid,
      'UPG13',
      'A1.3 first project',
      CURRENT_TIMESTAMP,
      ${upgradeFixture.workspaceId}::uuid
    ), (
      ${upgradeFixture.secondProjectId}::uuid,
      'UPG14',
      'A1.3 second project',
      CURRENT_TIMESTAMP,
      ${upgradeFixture.workspaceId}::uuid
    )
  `;
  await database.$executeRaw`
    INSERT INTO "integration_connections" (
      "id",
      "provider",
      "base_url",
      "updated_at",
      "workspace_id"
    )
    VALUES (
      ${upgradeFixture.connectionId}::uuid,
      'redmine',
      'https://pm.example.test',
      CURRENT_TIMESTAMP,
      ${upgradeFixture.workspaceId}::uuid
    )
  `;
  await database.$executeRaw`
    INSERT INTO "member_integration_credentials" (
      "id",
      "encrypted_key",
      "external_user_id",
      "external_login",
      "updated_at",
      "member_id",
      "connection_id"
    )
    VALUES (
      ${upgradeFixture.credentialId}::uuid,
      ${legacyEncryptedKey},
      'legacy-remote-user',
      'legacy-user',
      CURRENT_TIMESTAMP,
      ${upgradeFixture.memberId}::uuid,
      ${upgradeFixture.connectionId}::uuid
    )
  `;
  await database.$executeRaw`
    INSERT INTO "integration_project_bindings" (
      "id",
      "remote_project_id",
      "read_map",
      "write_map",
      "updated_at",
      "connection_id",
      "project_id"
    )
    VALUES (
      ${upgradeFixture.firstBindingId}::uuid,
      'remote-project-upgrade-one',
      ${JSON.stringify({ "remote-open": "todo" })}::jsonb,
      ${JSON.stringify({ todo: "remote-open" })}::jsonb,
      CURRENT_TIMESTAMP,
      ${upgradeFixture.connectionId}::uuid,
      ${upgradeFixture.projectId}::uuid
    ), (
      ${upgradeFixture.secondBindingId}::uuid,
      'remote-project-upgrade-two',
      ${JSON.stringify({ "remote-open": "todo" })}::jsonb,
      ${JSON.stringify({ todo: "remote-open" })}::jsonb,
      CURRENT_TIMESTAMP,
      ${upgradeFixture.connectionId}::uuid,
      ${upgradeFixture.secondProjectId}::uuid
    )
  `;
}

async function runIdentityUpgradePath() {
  const baseDatabaseUrl = new URL(
    process.env["DATABASE_URL"] ?? "postgresql://kanon:kanon@127.0.0.1:5433/kanon_e2e"
  );
  const schemaName = `identity_upgrade_${randomUUID().replaceAll("-", "")}`;
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
    if (
      lifecycleMigrationIndex < 0 ||
      identityMigrationIndex !== lifecycleMigrationIndex + 1
    ) {
      throw new Error(
        `Expected ${lifecycleMigrationName} to immediately precede ${identityMigrationName}`
      );
    }

    temporaryDirectory = await mkdtemp(join(tmpdir(), "kanon-identity-upgrade-"));
    await prepareMigrationWorkspace(
      temporaryDirectory,
      migrationNames.slice(0, identityMigrationIndex)
    );
    await deployMigrations(temporaryDirectory, isolatedDatabaseUrl.toString());

    const preMigrationDatabase = new PrismaClient({
      datasourceUrl: isolatedDatabaseUrl.toString(),
    });
    database = preMigrationDatabase;
    await seedPreIdentityRows(preMigrationDatabase);
    await preMigrationDatabase.$disconnect();
    database = undefined;

    // Deploy the exact checked-in A1.3 migration after seeding the pre-A1.3 rows.
    await cp(
      join(migrationsDirectory, identityMigrationName),
      join(temporaryDirectory, "migrations", identityMigrationName),
      { recursive: true }
    );
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
      externalUserId: "legacy-remote-user",
      externalLogin: "legacy-user",
      lastValidatedAt: null,
      lastAuthStatus: "unknown",
      revokedAt: null,
      memberId: upgradeFixture.memberId,
      connectionId: upgradeFixture.connectionId,
    });
    expect(existingCredential?.encryptedKey.split(":"))
      .toEqual([
        "gcm.v1",
        legacyCredentialParts.nonce,
        legacyCredentialParts.ciphertext,
        legacyCredentialParts.authTag,
      ]);

    const firstBinding = await upgradedDatabase.integrationProjectBinding.findUniqueOrThrow({
      where: { id: upgradeFixture.firstBindingId },
    });
    const secondBinding = await upgradedDatabase.integrationProjectBinding.findUniqueOrThrow({
      where: { id: upgradeFixture.secondBindingId },
    });
    expect(firstBinding).toMatchObject({
      connectionId: upgradeFixture.connectionId,
      projectId: upgradeFixture.projectId,
      lifecycle: "draft",
      lifecycleEpoch: 0,
      pollFence: 0,
    });
    expect(secondBinding).toMatchObject({
      connectionId: upgradeFixture.connectionId,
      projectId: upgradeFixture.secondProjectId,
      lifecycle: "draft",
      lifecycleEpoch: 0,
      pollFence: 0,
    });

    const firstIdentity = await upgradedDatabase.integrationExternalIdentity.create({
      data: {
        bindingId: firstBinding.id,
        memberId: upgradeFixture.memberId,
        remoteUserId: "remote-upgrade-user-one",
        remoteLogin: "upgrade-user-one",
      },
    });
    const secondIdentity = await upgradedDatabase.integrationExternalIdentity.create({
      data: {
        bindingId: secondBinding.id,
        memberId: upgradeFixture.memberId,
        remoteUserId: "remote-upgrade-user-two",
      },
    });

    const persistedIdentities = await upgradedDatabase.integrationExternalIdentity.findMany({
      where: { id: { in: [firstIdentity.id, secondIdentity.id] } },
    });
    expect(persistedIdentities).toHaveLength(2);
    expect(persistedIdentities).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          bindingId: firstBinding.id,
          memberId: upgradeFixture.memberId,
          remoteUserId: "remote-upgrade-user-one",
          remoteLogin: "upgrade-user-one",
        }),
        expect.objectContaining({
          bindingId: secondBinding.id,
          memberId: upgradeFixture.memberId,
          remoteUserId: "remote-upgrade-user-two",
          remoteLogin: null,
        }),
      ])
    );

    await expect(
      upgradedDatabase.integrationExternalIdentity.create({
        data: {
          bindingId: firstBinding.id,
          memberId: upgradeFixture.memberId,
          remoteUserId: "remote-upgrade-user-three",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });
    await expect(
      upgradedDatabase.integrationExternalIdentity.create({
        data: {
          bindingId: firstBinding.id,
          memberId: upgradeFixture.secondMemberId,
          remoteUserId: "remote-upgrade-user-one",
        },
      })
    ).rejects.toMatchObject({ code: "P2002" });

    await upgradedDatabase.integrationProjectBinding.delete({
      where: { id: firstBinding.id },
    });
    expect(
      await upgradedDatabase.integrationExternalIdentity.findUnique({
        where: { id: firstIdentity.id },
      })
    ).toBeNull();
    expect(
      await upgradedDatabase.integrationExternalIdentity.findUnique({
        where: { id: secondIdentity.id },
      })
    ).toMatchObject({ bindingId: secondBinding.id, memberId: upgradeFixture.memberId });

    await upgradedDatabase.member.delete({ where: { id: upgradeFixture.memberId } });
    expect(
      await upgradedDatabase.integrationExternalIdentity.findUnique({
        where: { id: secondIdentity.id },
      })
    ).toBeNull();
    expect(
      await upgradedDatabase.memberIntegrationCredential.findUnique({
        where: { id: upgradeFixture.credentialId },
      })
    ).toBeNull();
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

describe("integration identity and credential health schema", () => {
  it("defines credential health and binding-scoped identity contracts", () => {
    const authStatus = datamodel.enums.find((item) => item.name === "CredentialAuthStatus");
    expect(authStatus?.values.map(({ name }) => name)).toEqual([
      "unknown",
      "valid",
      "invalid",
      "revoked",
    ]);

    expect(field("MemberIntegrationCredential", "lastValidatedAt")).toMatchObject({
      type: "DateTime",
      isRequired: false,
    });
    expect(field("MemberIntegrationCredential", "lastAuthStatus")).toMatchObject({
      type: "CredentialAuthStatus",
      isRequired: true,
      default: "unknown",
    });
    expect(field("MemberIntegrationCredential", "revokedAt")).toMatchObject({
      type: "DateTime",
      isRequired: false,
    });

    expect(model("IntegrationExternalIdentity")?.uniqueFields).toEqual(
      expect.arrayContaining([
        ["bindingId", "memberId"],
        ["bindingId", "remoteUserId"],
      ])
    );
    expect(field("IntegrationExternalIdentity", "bindingId")).toMatchObject({
      type: "String",
      isRequired: true,
    });
    expect(field("IntegrationExternalIdentity", "memberId")).toMatchObject({
      type: "String",
      isRequired: true,
    });
    expect(field("IntegrationExternalIdentity", "remoteUserId")).toMatchObject({
      type: "String",
      isRequired: true,
    });
    expect(field("IntegrationExternalIdentity", "remoteLogin")).toMatchObject({
      type: "String",
      isRequired: false,
    });
  });

  it("persists health defaults and an external identity", async () => {
    const workspace = await createWorkspace();
    const project = await createProject(workspace.id);
    const member = await createMember(workspace.id);
    const connection = await createConnection(workspace.id);
    const binding = await createBinding(connection.id, project.id, "remote-project-identity");
    const credential = await prisma.memberIntegrationCredential.create({
      data: { encryptedKey: "ciphertext", memberId: member.id, connectionId: connection.id },
    });
    const identity = await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: binding.id,
        memberId: member.id,
        remoteUserId: "remote-user-42",
        remoteLogin: "developer-42",
      },
    });

    expect(credential).toMatchObject({
      encryptedKey: "ciphertext",
      lastValidatedAt: null,
      lastAuthStatus: "unknown",
      revokedAt: null,
    });
    expect(identity).toMatchObject({
      bindingId: binding.id,
      memberId: member.id,
      remoteUserId: "remote-user-42",
      remoteLogin: "developer-42",
    });

    const validatedAt = new Date("2026-07-24T19:00:00.000Z");
    const healthy = await prisma.memberIntegrationCredential.update({
      where: { id: credential.id },
      data: { lastValidatedAt: validatedAt, lastAuthStatus: "valid" },
    });
    expect(healthy).toMatchObject({ lastValidatedAt: validatedAt, lastAuthStatus: "valid" });
  });

  it("enforces identity uniqueness and cascades binding/member deletion", async () => {
    const workspace = await createWorkspace();
    const firstProject = await createProject(workspace.id, "First Identity Project");
    const secondProject = await createProject(workspace.id, "Second Identity Project");
    const firstMember = await createMember(workspace.id);
    const secondMember = await createMember(workspace.id);
    const connection = await createConnection(workspace.id);
    const firstBinding = await createBinding(connection.id, firstProject.id, "remote-project-one");
    const secondBinding = await createBinding(connection.id, secondProject.id, "remote-project-two");
    const firstIdentity = await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: firstBinding.id,
        memberId: firstMember.id,
        remoteUserId: "remote-user-one",
      },
    });

    await expect(
      prisma.integrationExternalIdentity.create({
        data: {
          bindingId: firstBinding.id,
          memberId: firstMember.id,
          remoteUserId: "remote-user-two",
        },
      })
    ).rejects.toThrow();
    await expect(
      prisma.integrationExternalIdentity.create({
        data: {
          bindingId: firstBinding.id,
          memberId: secondMember.id,
          remoteUserId: "remote-user-one",
        },
      })
    ).rejects.toThrow();

    await prisma.integrationProjectBinding.delete({ where: { id: firstBinding.id } });
    expect(
      await prisma.integrationExternalIdentity.findUnique({ where: { id: firstIdentity.id } })
    ).toBeNull();

    const secondIdentity = await prisma.integrationExternalIdentity.create({
      data: {
        bindingId: secondBinding.id,
        memberId: secondMember.id,
        remoteUserId: "remote-user-three",
      },
    });
    await prisma.member.delete({ where: { id: secondMember.id } });
    expect(
      await prisma.integrationExternalIdentity.findUnique({ where: { id: secondIdentity.id } })
    ).toBeNull();
  });

  it("keeps lifecycle immediately before identity in migration order", async () => {
    const names = await listMigrationNames();
    const lifecycleIndex = names.indexOf(lifecycleMigrationName);
    const identityIndex = names.indexOf(identityMigrationName);

    expect(identityIndex).toBe(lifecycleIndex + 1);
  });

  it(
    "upgrades pre-A1.3 credentials and preserves identity constraints",
    { timeout: 120000 },
    async () => {
      await runIdentityUpgradePath();
    }
  );
});
