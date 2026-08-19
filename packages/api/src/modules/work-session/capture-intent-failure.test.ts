import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { describe, expect, it } from "vitest";
import { prisma } from "../../config/prisma.js";

const migrationUrl = new URL(
  "../../../prisma/migrations/20260819140000_work_capture_failure_evidence/migration.sql",
  import.meta.url
);

const SAFE_FAILURE = {
  issueKey: "KAN-243",
  stage: "effect_apply",
  code: "WORK_CAPTURE_RETRYABLE",
  message: "Work capture was delayed. Kanon retries automatically.",
  details: { retryable: true, effectKind: "activity" },
} as const;

function databaseUrlForSchema(schema: string): string {
  const source = process.env.DATABASE_URL;
  if (!source) throw new Error("DATABASE_URL is required for migration tests");
  const url = new URL(source);
  url.searchParams.set("schema", schema);
  return url.toString();
}

async function expectRejected(operation: Promise<unknown>): Promise<void> {
  await expect(operation).rejects.toThrow();
}

describe("work-capture failure evidence migration", () => {
  it("declares the complete episode tuple, invariants, and notification dedupe key", async () => {
    const sql = await readFile(fileURLToPath(migrationUrl), "utf8");

    expect(sql).toContain("CREATE TYPE \"WorkCaptureFailureStage\" AS ENUM (\n  'effect_apply'\n)");
    expect(sql).toContain(
      "CREATE TYPE \"WorkCaptureFailureResolution\" AS ENUM (\n  'succeeded',\n  'superseded'\n)"
    );
    expect(sql).toContain("ALTER TYPE \"NotificationKind\" ADD VALUE 'work_capture_failure'");
    for (const column of [
      "failure_episode_id",
      "failure_command_id",
      "failure_epoch",
      "failure_lease_generation",
      "failure_effect_revision",
      "failure_effect_kind",
      "failure_effect_at",
      "failure_stage",
      "failure_code",
      "failure_count",
      "failure_first_at",
      "failure_last_at",
      "failure_resolved_at",
      "failure_resolution",
      "work_capture_failure_episode_id",
    ]) {
      expect(sql).toContain(`"${column}"`);
    }
    expect(sql).toContain('CONSTRAINT "work_capture_intents_failure_tuple"');
    expect(sql).toContain('CONSTRAINT "work_capture_intents_failure_timestamps"');
    expect(sql).toContain('CONSTRAINT "work_capture_intents_failure_resolution_pair"');
    expect(sql).toContain('CONSTRAINT "work_capture_intents_unresolved_failure_matches_pending"');
    expect(sql).toContain('CREATE UNIQUE INDEX "work_capture_intents_failure_episode_id_key"');
    expect(sql).toContain('CREATE INDEX "work_capture_intents_issue_id_failure_resolved_at_idx"');
    expect(sql).toContain(
      'CREATE UNIQUE INDEX "notifications_work_capture_failure_episode_id_key"'
    );
    expect(sql).toContain('CONSTRAINT "notifications_work_capture_failure_episode_pair"');
  });

  it("upgrades existing rows to count zero and enforces episode and notification constraints", async () => {
    const schema = `kan243_failure_${randomUUID().replaceAll("-", "")}`;
    const quotedSchema = `"${schema}"`;
    await prisma.$executeRawUnsafe(`CREATE SCHEMA ${quotedSchema}`);
    const isolated = new PrismaClient({
      datasources: { db: { url: databaseUrlForSchema(schema) } },
    });

    try {
      await isolated.$executeRawUnsafe(`
        CREATE TYPE "NotificationKind" AS ENUM (
          'mention', 'assignment', 'subscribed_activity', 'cycle_closed'
        )
      `);
      await isolated.$executeRawUnsafe(`
        CREATE TYPE "WorkCaptureEffectKind" AS ENUM ('activity', 'release', 'close')
      `);
      await isolated.$executeRawUnsafe(`
        CREATE TABLE "work_capture_intents" (
          "id" UUID PRIMARY KEY,
          "epoch" UUID NOT NULL,
          "lease_generation" INTEGER NOT NULL,
          "effect_revision" INTEGER NOT NULL,
          "pending_effect_kind" "WorkCaptureEffectKind",
          "pending_effect_at" TIMESTAMP(3),
          "pending_effect_command_id" UUID,
          "issue_id" UUID NOT NULL
        )
      `);
      await isolated.$executeRawUnsafe(`
        CREATE TABLE "notifications" (
          "id" UUID PRIMARY KEY,
          "kind" "NotificationKind" NOT NULL,
          "payload" JSONB
        )
      `);

      const intentId = randomUUID();
      const issueId = randomUUID();
      const epoch = randomUUID();
      const commandId = randomUUID();
      await isolated.$executeRawUnsafe(
        `INSERT INTO "work_capture_intents" (
          "id", "epoch", "lease_generation", "effect_revision",
          "pending_effect_kind", "pending_effect_at", "pending_effect_command_id", "issue_id"
        ) VALUES ($1::uuid, $2::uuid, 2, 7, 'activity', $3::timestamp, $4::uuid, $5::uuid)`,
        intentId,
        epoch,
        "2026-08-19T14:00:00.000Z",
        commandId,
        issueId
      );

      const sql = await readFile(fileURLToPath(migrationUrl), "utf8");
      for (const statement of sql
        .split(";")
        .map((part) => part.trim())
        .filter(Boolean)) {
        await isolated.$executeRawUnsafe(statement);
      }

      const [upgraded] = await isolated.$queryRawUnsafe<
        Array<{
          failureCount: number;
          failureEpisodeId: string | null;
          failureResolvedAt: Date | null;
          failureResolution: string | null;
        }>
      >(
        `
        SELECT
          "failure_count" AS "failureCount",
          "failure_episode_id" AS "failureEpisodeId",
          "failure_resolved_at" AS "failureResolvedAt",
          "failure_resolution"::text AS "failureResolution"
        FROM "work_capture_intents"
        WHERE "id" = $1::uuid
      `,
        intentId
      );
      expect(upgraded).toEqual({
        failureCount: 0,
        failureEpisodeId: null,
        failureResolvedAt: null,
        failureResolution: null,
      });

      await expectRejected(
        isolated.$executeRawUnsafe(
          'UPDATE "work_capture_intents" SET "failure_count" = 1 WHERE "id" = $1::uuid',
          intentId
        )
      );

      const episodeId = randomUUID();
      await isolated.$executeRawUnsafe(
        `UPDATE "work_capture_intents" SET
          "failure_episode_id" = $2::uuid,
          "failure_command_id" = "pending_effect_command_id",
          "failure_epoch" = "epoch",
          "failure_lease_generation" = "lease_generation",
          "failure_effect_revision" = "effect_revision",
          "failure_effect_kind" = "pending_effect_kind",
          "failure_effect_at" = "pending_effect_at",
          "failure_stage" = 'effect_apply',
          "failure_code" = 'WORK_CAPTURE_RETRYABLE',
          "failure_count" = 1,
          "failure_first_at" = '2026-08-19T14:01:00.000Z',
          "failure_last_at" = '2026-08-19T14:01:00.000Z'
        WHERE "id" = $1::uuid`,
        intentId,
        episodeId
      );

      await expectRejected(
        isolated.$executeRawUnsafe(
          `UPDATE "work_capture_intents"
           SET "failure_last_at" = '2026-08-19T13:59:00.000Z'
           WHERE "id" = $1::uuid`,
          intentId
        )
      );
      await expectRejected(
        isolated.$executeRawUnsafe(
          `UPDATE "work_capture_intents"
           SET "failure_resolved_at" = '2026-08-19T14:00:30.000Z',
               "failure_resolution" = 'succeeded'
           WHERE "id" = $1::uuid`,
          intentId
        )
      );
      await expectRejected(
        isolated.$executeRawUnsafe(
          'UPDATE "work_capture_intents" SET "failure_epoch" = $2::uuid WHERE "id" = $1::uuid',
          intentId,
          randomUUID()
        )
      );
      await expectRejected(
        isolated.$executeRawUnsafe(
          `UPDATE "work_capture_intents"
           SET "failure_resolution" = 'succeeded', "failure_resolved_at" = NULL
           WHERE "id" = $1::uuid`,
          intentId
        )
      );
      await expectRejected(
        isolated.$executeRawUnsafe(
          `UPDATE "work_capture_intents"
           SET "pending_effect_command_id" = NULL
           WHERE "id" = $1::uuid`,
          intentId
        )
      );

      await expectRejected(
        isolated.$executeRawUnsafe(
          `INSERT INTO "notifications" ("id", "kind", "payload")
           VALUES ($1::uuid, 'work_capture_failure', '{}'::jsonb)`,
          randomUUID()
        )
      );
      await expectRejected(
        isolated.$executeRawUnsafe(
          `INSERT INTO "notifications" (
             "id", "kind", "payload", "work_capture_failure_episode_id"
           ) VALUES ($1::uuid, 'assignment', '{}'::jsonb, $2::uuid)`,
          randomUUID(),
          episodeId
        )
      );
      await isolated.$executeRawUnsafe(
        `INSERT INTO "notifications" (
           "id", "kind", "payload", "work_capture_failure_episode_id"
         ) VALUES ($1::uuid, 'work_capture_failure', $2::jsonb, $3::uuid)`,
        randomUUID(),
        JSON.stringify(SAFE_FAILURE),
        episodeId
      );
      await expectRejected(
        isolated.$executeRawUnsafe(
          `INSERT INTO "notifications" (
             "id", "kind", "payload", "work_capture_failure_episode_id"
           ) VALUES ($1::uuid, 'work_capture_failure', $2::jsonb, $3::uuid)`,
          randomUUID(),
          JSON.stringify(SAFE_FAILURE),
          episodeId
        )
      );
    } finally {
      await isolated.$disconnect();
      await prisma.$executeRawUnsafe(`DROP SCHEMA IF EXISTS ${quotedSchema} CASCADE`);
    }
  });
});

describe("work-capture failure payload construction", () => {
  it("constructs only fixed safe fields and exposes a stable retryable error", async () => {
    const failure = await import("./capture-intent-failure.js");

    expect(failure.buildWorkCaptureFailurePayload("KAN-243", "activity")).toEqual(SAFE_FAILURE);
    expect(failure.workCaptureRetryableError()).toMatchObject({
      name: "WorkCaptureRetryableError",
      message: "Work capture was delayed. Kanon retries automatically.",
    });
    expect(JSON.stringify(failure.buildWorkCaptureFailurePayload("KAN-243", "close"))).not.toMatch(
      /episode|epoch|lease|revision|command|raw|fence/i
    );
  });
});
