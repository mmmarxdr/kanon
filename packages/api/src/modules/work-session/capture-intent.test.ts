import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { cp, mkdtemp, mkdir, readdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { promisify } from "node:util";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { listPrincipalCaptureIntents } from "./capture-intent.js";

const execFileAsync = promisify(execFile);
const prismaDirectory = fileURLToPath(new URL("../../../prisma/", import.meta.url));
const apiDirectory = dirname(prismaDirectory);
const migrationsDirectory = join(prismaDirectory, "migrations");
const migrationName = "20260818140000_work_capture_intents";
const migrationUrl = new URL(
  "../../../prisma/migrations/20260818140000_work_capture_intents/migration.sql",
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

describe("WorkCaptureIntent migration", () => {
  it("defines the minimal durable aggregate and its database invariants", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");

    expect(sql).toContain('CREATE TYPE "WorkCaptureState" AS ENUM');
    for (const state of ["adopted", "capturing", "paused", "closed"]) {
      expect(sql).toContain(`'${state}'`);
    }
    expect(sql).not.toContain("'closing'");
    expect(sql).toContain('CONSTRAINT "work_capture_intents_generation_positive"');
    expect(sql).toContain('CHECK ("lease_generation" > 0)');
    expect(sql).toContain('CONSTRAINT "work_capture_intents_closed_state"');
    expect(sql).toContain('("state" = \'closed\') = ("closed_at" IS NOT NULL)');
    expect(sql).toContain('CREATE UNIQUE INDEX "work_capture_intents_epoch_key"');
    expect(sql).toContain('CREATE UNIQUE INDEX "work_capture_intents_user_id_issue_id_key"');
    expect(sql).toContain('CREATE INDEX "work_capture_intents_issue_id_state_idx"');
    expect(sql).toContain('CREATE INDEX "work_capture_intents_member_id_state_updated_at_idx"');
  });

  it("backfills only live sessions and preserves pause and timestamp semantics", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");

    expect(sql.match(/INSERT INTO "work_capture_intents"/g)).toHaveLength(1);
    expect(sql).toContain('FROM "work_sessions" session');
    expect(sql).toContain("LEFT JOIN LATERAL");
    expect(sql).toContain('FROM "interruptions" interruption');
    expect(sql).toContain("LIMIT 1");
    expect(sql).toContain('interruption."interrupted_issue_id" = session."issue_id"');
    expect(sql).toContain('interruption."member_id" = session."member_id"');
    expect(sql).toContain('interruption."ended_at" IS NULL');
    expect(sql).toContain("THEN 'paused'::\"WorkCaptureState\"");
    expect(sql).toContain("ELSE 'capturing'::\"WorkCaptureState\"");
    expect(sql).toContain('session."started_at"');
    expect(sql).toContain('GREATEST(session."last_heartbeat", session."started_at")');
    expect(sql).not.toContain('FROM "work_logs"');
  });

  it("backfills live leases without inferring intents from WorkLogs or interruption-only rows", async () => {
    const baseUrl = new URL(process.env["DATABASE_URL"]!);
    const schemaName = `kan243_intent_upgrade_${randomUUID().replaceAll("-", "")}`;
    const adminUrl = new URL(baseUrl);
    adminUrl.searchParams.set("schema", "public");
    const isolatedUrl = new URL(baseUrl);
    isolatedUrl.searchParams.set("schema", schemaName);
    const admin = new PrismaClient({ datasourceUrl: adminUrl.toString() });
    const database = new PrismaClient({ datasourceUrl: isolatedUrl.toString() });
    const temporaryDirectory = await mkdtemp(join(tmpdir(), "kan243-intent-migration-"));

    try {
      await admin.$executeRawUnsafe(`CREATE SCHEMA ${quoteIdentifier(schemaName)}`);
      await cp(join(prismaDirectory, "schema.prisma"), join(temporaryDirectory, "schema.prisma"));
      const temporaryMigrations = join(temporaryDirectory, "migrations");
      await mkdir(temporaryMigrations, { recursive: true });
      await cp(
        join(migrationsDirectory, "migration_lock.toml"),
        join(temporaryMigrations, "migration_lock.toml")
      );
      const migrationNames = (await readdir(migrationsDirectory, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      const targetIndex = migrationNames.indexOf(migrationName);
      expect(targetIndex).toBeGreaterThan(0);
      for (const name of migrationNames.slice(0, targetIndex)) {
        await cp(join(migrationsDirectory, name), join(temporaryMigrations, name), {
          recursive: true,
        });
      }
      await deployMigrations(temporaryDirectory, isolatedUrl.toString());

      const workspace = await database.workspace.create({
        data: { name: "Intent migration", slug: `intent-${randomUUID()}` },
      });
      const user = await database.user.create({
        data: { email: `intent-${randomUUID()}@kanon.test`, passwordHash: "unused" },
      });
      const member = await database.member.create({
        data: { username: "intent-member", workspaceId: workspace.id, userId: user.id },
      });
      const project = await database.project.create({
        data: { key: "INTENT", name: "Intent", workspaceId: workspace.id },
      });
      const [capturingIssue, pausedIssue, workLogOnlyIssue, interruptionOnlyIssue, incident] =
        await Promise.all(
          [
            ["INTENT-1", "Capturing", "task"],
            ["INTENT-2", "Paused", "task"],
            ["INTENT-3", "WorkLog only", "task"],
            ["INTENT-4", "Interruption only", "task"],
            ["INTENT-5", "Incident", "incident"],
          ].map(([key, title, type], index) =>
            database.issue.create({
              data: {
                key: key!,
                title: title!,
                type: type as "task" | "incident",
                projectId: project.id,
                sequenceNum: index + 1,
              },
            })
          )
        );
      const capturingStartedAt = new Date("2026-08-18T12:00:00.000Z");
      await database.workSession.create({
        data: {
          userId: user.id,
          memberId: member.id,
          issueId: capturingIssue!.id,
          source: "codex",
          startedAt: capturingStartedAt,
          lastHeartbeat: new Date("2026-08-18T11:59:00.000Z"),
        },
      });
      const pausedStartedAt = new Date("2026-08-18T13:00:00.000Z");
      const pausedHeartbeat = new Date("2026-08-18T14:00:00.000Z");
      await database.workSession.create({
        data: {
          userId: user.id,
          memberId: member.id,
          issueId: pausedIssue!.id,
          source: "web",
          startedAt: pausedStartedAt,
          lastHeartbeat: pausedHeartbeat,
        },
      });
      await database.interruption.create({
        data: {
          incidentIssueId: incident!.id,
          interruptedIssueId: pausedIssue!.id,
          memberId: member.id,
          via: "manual",
        },
      });
      await database.workLog.create({
        data: {
          issueId: workLogOnlyIssue!.id,
          memberId: member.id,
          startedAt: new Date("2026-08-18T10:00:00.000Z"),
          endedAt: new Date("2026-08-18T10:01:00.000Z"),
          durationS: 60,
          reason: "stopped",
        },
      });
      await database.interruption.create({
        data: {
          incidentIssueId: incident!.id,
          interruptedIssueId: interruptionOnlyIssue!.id,
          memberId: member.id,
          via: "manual",
        },
      });

      await cp(join(migrationsDirectory, migrationName), join(temporaryMigrations, migrationName), {
        recursive: true,
      });
      await deployMigrations(temporaryDirectory, isolatedUrl.toString());

      const rows = await database.$queryRawUnsafe<
        Array<{
          issueId: string;
          state: string;
          source: string;
          leaseGeneration: number;
          createdAt: Date;
          updatedAt: Date;
        }>
      >(`
          SELECT
            "issue_id" AS "issueId",
            "state"::text AS "state",
            "source",
            "lease_generation" AS "leaseGeneration",
            "created_at" AS "createdAt",
            "updated_at" AS "updatedAt"
          FROM "work_capture_intents"
          ORDER BY "issue_id"
        `);
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.issueId === capturingIssue!.id)).toMatchObject({
        state: "capturing",
        source: "codex",
        leaseGeneration: 1,
        createdAt: capturingStartedAt,
        updatedAt: capturingStartedAt,
      });
      expect(rows.find((row) => row.issueId === pausedIssue!.id)).toMatchObject({
        state: "paused",
        source: "web",
        leaseGeneration: 1,
        createdAt: pausedStartedAt,
        updatedAt: pausedHeartbeat,
      });
    } finally {
      await database.$disconnect();
      await admin.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quoteIdentifier(schemaName)} CASCADE`);
      await admin.$disconnect();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }, 60_000);
});

describe("WorkCaptureIntent hydration listing", () => {
  it("scopes nonclosed intents to principal, workspace, and allowed projects", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    await listPrincipalCaptureIntents(
      {
        userId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        allowedProjectIds: ["33333333-3333-4333-8333-333333333333"],
        limit: 25,
      },
      { workCaptureIntent: { findMany } } as any
    );

    expect(findMany).toHaveBeenCalledWith({
      where: {
        userId: "11111111-1111-4111-8111-111111111111",
        state: { not: "closed" },
        issue: {
          project: {
            workspaceId: "22222222-2222-4222-8222-222222222222",
            id: { in: ["33333333-3333-4333-8333-333333333333"] },
          },
        },
      },
      select: {
        id: true,
        epoch: true,
        leaseGeneration: true,
        state: true,
        issue: { select: { key: true } },
      },
      orderBy: { id: "asc" },
      take: 26,
    });
  });

  it("paginates by deterministic id without exposing ids or duplicating the boundary", async () => {
    const rows = [1, 2, 3].map((index) => ({
      id: `00000000-0000-4000-8000-00000000000${index}`,
      epoch: `10000000-0000-4000-8000-00000000000${index}`,
      leaseGeneration: index,
      state: "capturing",
      issue: { key: `KAN-${index}` },
    }));
    const findMany = vi.fn().mockResolvedValue(rows);
    const result = await listPrincipalCaptureIntents(
      {
        userId: "11111111-1111-4111-8111-111111111111",
        workspaceId: "22222222-2222-4222-8222-222222222222",
        cursor: "00000000-0000-4000-8000-000000000000",
        limit: 2,
      },
      { workCaptureIntent: { findMany } } as any
    );

    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: { gt: "00000000-0000-4000-8000-000000000000" } }),
        take: 3,
      })
    );
    expect(result).toEqual({
      intents: [
        expect.objectContaining({ issueKey: "KAN-1" }),
        expect.objectContaining({ issueKey: "KAN-2" }),
      ],
      nextCursor: rows[1]!.id,
    });
    expect(result.intents[0]).not.toHaveProperty("id");
  });
});
