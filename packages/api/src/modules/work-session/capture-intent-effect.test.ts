import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { cp, mkdtemp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const prismaDirectory = fileURLToPath(new URL("../../../prisma/", import.meta.url));
const apiDirectory = dirname(prismaDirectory);
const migrationsDirectory = join(prismaDirectory, "migrations");
const migrationName = "20260818150000_work_capture_intent_effects";
const migrationUrl = new URL(
  "../../../prisma/migrations/20260818150000_work_capture_intent_effects/migration.sql",
  import.meta.url
);
const ownerLeaseMigrationName = "20260819150000_work_capture_owner_leases";
const ownerLeaseMigrationUrl = new URL(
  "../../../prisma/migrations/20260819150000_work_capture_owner_leases/migration.sql",
  import.meta.url
);

function quoteIdentifier(identifier: string): string {
  return `"${identifier.replaceAll('"', '""')}"`;
}

async function deployMigrations(directory: string, databaseUrl: string): Promise<void> {
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

describe("WorkCaptureIntent effect migration", () => {
  it("adds only the revisioned pending-effect tuple and its invariants", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");

    expect(sql).toContain("ALTER TYPE \"WorkCaptureState\" ADD VALUE 'closing'");
    expect(sql).toContain('CREATE TYPE "WorkCaptureEffectKind" AS ENUM');
    for (const kind of ["activity", "release", "close"]) {
      expect(sql).toContain(`'${kind}'`);
    }
    expect(sql).toContain('ADD COLUMN "pending_effect_kind"');
    expect(sql).toContain('ADD COLUMN "pending_effect_at"');
    expect(sql).toContain('ADD COLUMN "pending_effect_command_id"');
    expect(sql).toContain('ADD COLUMN "effect_revision" INTEGER NOT NULL DEFAULT 0');
    expect(sql).toContain('CONSTRAINT "work_capture_intents_effect_revision_nonnegative"');
    expect(sql).toContain('CONSTRAINT "work_capture_intents_pending_effect_tuple"');
    expect(sql).toContain('CONSTRAINT "work_capture_intents_closing_effect"');
    expect(sql).toContain('CONSTRAINT "work_capture_intents_closed_state"');
    for (const forbidden of ["claimed_at", "claim_token", "attempts", "last_error"]) {
      expect(sql).not.toContain(forbidden);
    }
    expect(sql).not.toMatch(/UPDATE\s+"work_capture_intents"/i);
  });

  it("upgrades the current intent migration without semantic backfill", async () => {
    const baseUrl = new URL(process.env["DATABASE_URL"]!);
    const schemaName = `kan243_intent_effect_upgrade_${randomUUID().replaceAll("-", "")}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.searchParams.set("schema", "public");
    const isolatedUrl = new URL(baseUrl);
    isolatedUrl.searchParams.set("schema", schemaName);
    const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
    const database = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "kan243-intent-effect-migration-"));

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
      await cp(join(prismaDirectory, "schema.prisma"), join(temporaryDirectory, "schema.prisma"));
      const temporaryMigrations = join(temporaryDirectory, "migrations");
      await mkdir(temporaryMigrations, { recursive: true });
      await cp(
        join(migrationsDirectory, "migration_lock.toml"),
        join(temporaryMigrations, "migration_lock.toml")
      );
      const names = (await readdir(migrationsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const targetIndex = names.indexOf(migrationName);
      expect(targetIndex).toBeGreaterThan(0);
      for (const name of names.slice(0, targetIndex)) {
        await cp(join(migrationsDirectory, name), join(temporaryMigrations, name), {
          recursive: true,
        });
      }
      await deployMigrations(temporaryDirectory, isolatedUrl.toString());

      const [intent] = await database.$queryRawUnsafe<Array<{ id: string }>>(`
        SELECT "id" FROM "work_capture_intents" LIMIT 1
      `);
      if (!intent) {
        const workspace = await database.workspace.create({
          data: { name: "Effect migration", slug: `effect-${randomUUID()}` },
        });
        const user = await database.user.create({
          data: { email: `effect-${randomUUID()}@kanon.test`, passwordHash: "unused" },
        });
        const member = await database.member.create({
          data: { username: "effect-member", workspaceId: workspace.id, userId: user.id },
        });
        const project = await database.project.create({
          data: { key: "EFFECT", name: "Effect", workspaceId: workspace.id },
        });
        const issue = await database.issue.create({
          data: {
            key: "EFFECT-1",
            title: "Effect",
            projectId: project.id,
            sequenceNum: 1,
          },
        });
        await database.$executeRawUnsafe(
          `INSERT INTO "work_capture_intents" ("user_id", "issue_id", "member_id") VALUES ($1::uuid, $2::uuid, $3::uuid)`,
          user.id,
          issue.id,
          member.id
        );
      }

      await cp(join(migrationsDirectory, migrationName), join(temporaryMigrations, migrationName), {
        recursive: true,
      });
      await deployMigrations(temporaryDirectory, isolatedUrl.toString());
      const rows = await database.$queryRawUnsafe<
        Array<{
          state: string;
          effectRevision: number;
          pendingEffectKind: string | null;
          pendingEffectAt: Date | null;
          pendingEffectCommandId: string | null;
        }>
      >(`
        SELECT "state"::text AS "state",
               "effect_revision" AS "effectRevision",
               "pending_effect_kind"::text AS "pendingEffectKind",
               "pending_effect_at" AS "pendingEffectAt",
               "pending_effect_command_id" AS "pendingEffectCommandId"
        FROM "work_capture_intents"
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        state: "adopted",
        effectRevision: 0,
        pendingEffectKind: null,
        pendingEffectAt: null,
        pendingEffectCommandId: null,
      });
      await expect(
        database.$executeRawUnsafe(
          `UPDATE "work_capture_intents" SET "pending_effect_kind" = 'activity'`
        )
      ).rejects.toThrow();
      await expect(
        database.$executeRawUnsafe(`UPDATE "work_capture_intents" SET "effect_revision" = -1`)
      ).rejects.toThrow();
      await expect(
        database.$executeRawUnsafe(`
          UPDATE "work_capture_intents"
          SET "state" = 'closing',
              "pending_effect_kind" = NULL,
              "pending_effect_at" = NULL,
              "pending_effect_command_id" = NULL
        `)
      ).rejects.toThrow();
      await expect(
        database.$executeRawUnsafe(`
          UPDATE "work_capture_intents"
          SET "state" = 'closing',
              "pending_effect_kind" = 'activity',
              "pending_effect_at" = CURRENT_TIMESTAMP,
              "pending_effect_command_id" = gen_random_uuid()
        `)
      ).rejects.toThrow();
      expect(
        await database.$executeRawUnsafe(`
          UPDATE "work_capture_intents"
          SET "state" = 'closing',
              "pending_effect_kind" = 'close',
              "pending_effect_at" = CURRENT_TIMESTAMP,
              "pending_effect_command_id" = gen_random_uuid()
        `)
      ).toBe(1);
    } finally {
      await database.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await admin.$disconnect();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("WorkCaptureOwnerLease migration", () => {
  it("adds the owner lease set with the exact identity and fence indexes", async () => {
    const sql = await readFile(fileURLToPath(ownerLeaseMigrationUrl), "utf8");

    expect(sql).toContain('CREATE TYPE "WorkCaptureOwnerKind" AS ENUM');
    for (const kind of ["web", "mcp", "implicit"]) expect(sql).toContain(`'${kind}'`);
    expect(sql).toContain('CREATE TABLE "work_capture_owner_leases"');
    for (const column of [
      "intent_id",
      "owner_id",
      "epoch",
      "lease_generation",
      "owner_kind",
      "first_seen_at",
      "last_seen_at",
      "expires_at",
    ]) {
      expect(sql).toContain(`"${column}"`);
    }
    expect(sql).toContain('CREATE UNIQUE INDEX "work_capture_owner_intent_owner_key"');
    expect(sql).toContain('CREATE INDEX "work_capture_owner_fence_expiry_idx"');
    expect(sql).toMatch(/CURRENT_TIMESTAMP\s*\+\s*INTERVAL '5 minutes'/);
    expect(sql).toContain("00000000-0000-4000-8000-000000000001");
  });

  it("backfills one live implicit anchor without changing the existing capture intent", async () => {
    const baseUrl = new URL(process.env["DATABASE_URL"]!);
    const schemaName = `kan243_owner_lease_upgrade_${randomUUID().replaceAll("-", "")}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.searchParams.set("schema", "public");
    const isolatedUrl = new URL(baseUrl);
    isolatedUrl.searchParams.set("schema", schemaName);
    const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
    const database = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "kan243-owner-lease-migration-"));

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
      await cp(join(prismaDirectory, "schema.prisma"), join(temporaryDirectory, "schema.prisma"));
      const temporaryMigrations = join(temporaryDirectory, "migrations");
      await mkdir(temporaryMigrations, { recursive: true });
      await cp(
        join(migrationsDirectory, "migration_lock.toml"),
        join(temporaryMigrations, "migration_lock.toml")
      );
      const names = (await readdir(migrationsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const targetIndex = names.indexOf(ownerLeaseMigrationName);
      expect(targetIndex).toBeGreaterThan(0);
      for (const name of names.slice(0, targetIndex)) {
        await cp(join(migrationsDirectory, name), join(temporaryMigrations, name), {
          recursive: true,
        });
      }
      await deployMigrations(temporaryDirectory, isolatedUrl.toString());

      const workspace = await database.workspace.create({
        data: { name: "Owner lease migration", slug: `owner-${randomUUID()}` },
      });
      const user = await database.user.create({
        data: { email: `owner-${randomUUID()}@kanon.test`, passwordHash: "unused" },
      });
      const member = await database.member.create({
        data: { username: "owner-member", workspaceId: workspace.id, userId: user.id },
      });
      const project = await database.project.create({
        data: { key: "OWNER", name: "Owner", workspaceId: workspace.id },
      });
      const issue = await database.issue.create({
        data: {
          key: "OWNER-1",
          title: "Owner",
          projectId: project.id,
          sequenceNum: 1,
        },
      });
      const intent = await database.workCaptureIntent.create({
        data: { userId: user.id, issueId: issue.id, memberId: member.id, state: "capturing" },
      });
      await database.workSession.create({
        data: { userId: user.id, issueId: issue.id, memberId: member.id, source: "mcp" },
      });
      const before = await database.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } });

      await cp(
        join(migrationsDirectory, ownerLeaseMigrationName),
        join(temporaryMigrations, ownerLeaseMigrationName),
        { recursive: true }
      );
      await deployMigrations(temporaryDirectory, isolatedUrl.toString());

      const rows = await database.$queryRawUnsafe<
        Array<{
          intentId: string;
          ownerId: string;
          epoch: string;
          leaseGeneration: number;
          ownerKind: string;
          lastSeenAt: Date;
          expiresAt: Date;
        }>
      >(`
        SELECT "intent_id" AS "intentId", "owner_id" AS "ownerId", "epoch",
               "lease_generation" AS "leaseGeneration", "owner_kind"::text AS "ownerKind",
               "last_seen_at" AS "lastSeenAt", "expires_at" AS "expiresAt"
        FROM "work_capture_owner_leases"
      `);
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        intentId: intent.id,
        ownerId: "00000000-0000-4000-8000-000000000001",
        epoch: intent.epoch,
        leaseGeneration: intent.leaseGeneration,
        ownerKind: "implicit",
      });
      expect(rows[0]!.expiresAt.getTime()).toBeGreaterThan(rows[0]!.lastSeenAt.getTime());
      expect(await database.workCaptureIntent.findUniqueOrThrow({ where: { id: intent.id } })).toEqual(before);
    } finally {
      await database.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await admin.$disconnect();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 60_000);
});
