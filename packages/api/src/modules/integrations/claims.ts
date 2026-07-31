import { Prisma, type PrismaClient } from "@prisma/client";
import type { IntegrationWorkRow } from "./outbox.js";

const DEFAULT_LIMIT = 100;
const DEFAULT_LEASE_MS = 120_000;
const MAX_COALESCE_ROWS_PER_HEAD = 32;

export interface IntegrationWorkClaimOptions {
  readonly now?: Date;
  readonly limit?: number;
  readonly leaseMs?: number;
}

function genuinelyClaimable(at: Prisma.Sql): Prisma.Sql {
  return Prisma.sql`
    connection."lifecycle" = 'active'::"IntegrationLifecycle"
    AND binding."lifecycle" = 'active'::"IntegrationLifecycle"
    AND work."direction" = 'outbound'::"SyncDirection"
    AND work."state" IN ('queued'::"SyncWorkState", 'retry'::"SyncWorkState")
    AND work."available_at" <= ${at}
    AND work."epoch" = binding."lifecycle_epoch"
    AND NOT EXISTS (
      SELECT 1
      FROM "integration_sync_work" AS earlier
      WHERE earlier."binding_id" = work."binding_id"
        AND earlier."lane_key" = work."lane_key"
        AND earlier."sequence" < work."sequence"
        AND (
          (earlier."epoch" = binding."lifecycle_epoch" AND earlier."state" NOT IN (
            'superseded'::"SyncWorkState", 'dead'::"SyncWorkState",
            'done'::"SyncWorkState", 'skipped'::"SyncWorkState"
          ))
          OR (earlier."epoch" <> binding."lifecycle_epoch" AND earlier."state" IN (
            'leased'::"SyncWorkState", 'ambiguous'::"SyncWorkState"
          ))
        )
    )
  `;
}

export async function claimIntegrationWork(
  database: Pick<PrismaClient, "$transaction">,
  options: IntegrationWorkClaimOptions = {}
): Promise<readonly IntegrationWorkRow[]> {
  const limit = options.limit ?? DEFAULT_LIMIT;
  const leaseMs = options.leaseMs ?? DEFAULT_LEASE_MS;
  if (!Number.isSafeInteger(limit) || limit < 1) {
    throw new RangeError("claim limit must be a positive integer");
  }
  if (!Number.isSafeInteger(leaseMs) || leaseMs < 1) {
    throw new RangeError("leaseMs must be a positive integer");
  }

  return database.$transaction(async (transaction) => {
    const dueAt = options.now ? Prisma.sql`${options.now}` : Prisma.sql`clock_timestamp()`;
    const eligibility = genuinelyClaimable(dueAt);
    const bindings = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      SELECT binding."id"
      FROM "integration_connections" AS connection
      JOIN "integration_project_bindings" AS binding ON binding."connection_id" = connection."id"
      CROSS JOIN LATERAL (
        SELECT work."sequence"
        FROM "integration_sync_work" AS work
        WHERE work."binding_id" = binding."id" AND ${eligibility}
        ORDER BY work."sequence"
        LIMIT 1
      ) AS head
      ORDER BY head."sequence", connection."id", binding."id"
      LIMIT ${limit}
      FOR UPDATE OF connection SKIP LOCKED
      FOR UPDATE OF binding SKIP LOCKED
    `);
    if (bindings.length === 0) return [];

    const bindingIds = Prisma.join(bindings.map(({ id }) => Prisma.sql`${id}::uuid`));
    const leaseNow = options.now ? Prisma.sql`${options.now}` : Prisma.sql`clock_timestamp()`;
    const claimed = await transaction.$queryRaw<Array<{ id: string }>>(Prisma.sql`
      WITH heads AS MATERIALIZED (
        SELECT work."id", work."binding_id", work."lane_key", work."sequence",
               work."operation", work."state", work."fence", work."lease_token",
               work."lease_until", work."entity_type", work."payload", work."actor_key",
               work."actor_kind", work."auth_credential_id", binding."lifecycle_epoch"
        FROM "integration_sync_work" AS work
        JOIN "integration_project_bindings" AS binding ON binding."id" = work."binding_id"
        JOIN "integration_connections" AS connection ON connection."id" = binding."connection_id"
        WHERE binding."id" IN (${bindingIds}) AND ${eligibility}
        ORDER BY work."sequence", binding."id"
        LIMIT ${limit}
        FOR UPDATE OF work SKIP LOCKED
      ), prefix AS MATERIALIZED (
        SELECT head."id" AS "head_id", candidate."id" AS "candidate_id",
               candidate."sequence" AS "candidate_sequence",
               bool_and(
                 candidate."id" = head."id" OR (
                   head."operation" = 'update'::"SyncOperation"
                   AND head."state" = 'queued'::"SyncWorkState"
                   AND head."fence" = 0
                   AND head."lease_token" IS NULL
                   AND head."lease_until" IS NULL
                   AND head."entity_type" = 'issue'
                   AND head."payload"->'version' = '1'::jsonb
                   AND jsonb_typeof(head."payload"->'fields') = 'object'
                   AND candidate."direction" = 'outbound'::"SyncDirection"
                   AND candidate."operation" = 'update'::"SyncOperation"
                   AND candidate."state" = 'queued'::"SyncWorkState"
                   AND candidate."available_at" <= ${dueAt}
                   AND candidate."epoch" = head."lifecycle_epoch"
                   AND candidate."fence" = 0
                   AND candidate."lease_token" IS NULL
                   AND candidate."lease_until" IS NULL
                   AND candidate."entity_type" = 'issue'
                   AND candidate."payload"->'version' = '1'::jsonb
                   AND jsonb_typeof(candidate."payload"->'fields') = 'object'
                   AND candidate."actor_key" = head."actor_key"
                   AND candidate."actor_kind" = head."actor_kind"
                   AND candidate."auth_credential_id" IS NOT DISTINCT FROM head."auth_credential_id"
                 )
               ) OVER (
                 PARTITION BY head."id" ORDER BY candidate."sequence"
                 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
               ) AS "compatible"
        FROM heads AS head
        CROSS JOIN LATERAL (
          SELECT candidate.*
          FROM "integration_sync_work" AS candidate
          WHERE candidate."binding_id" = head."binding_id"
              AND candidate."lane_key" = head."lane_key"
              AND candidate."sequence" >= head."sequence"
          ORDER BY candidate."sequence"
          LIMIT ${MAX_COALESCE_ROWS_PER_HEAD}
        ) AS candidate
      ), targets AS MATERIALIZED (
        SELECT DISTINCT ON (prefix."head_id") prefix."head_id",
               prefix."candidate_id" AS "target_id"
        FROM prefix
        WHERE prefix."compatible"
        ORDER BY prefix."head_id", prefix."candidate_sequence" DESC
      ), locked AS MATERIALIZED (
        SELECT work."id", work."sequence", target."target_id"
        FROM targets AS target
        JOIN prefix ON prefix."head_id" = target."head_id" AND prefix."compatible"
        JOIN "integration_sync_work" AS work ON work."id" = prefix."candidate_id"
        FOR UPDATE OF work
      ), locked_complete AS MATERIALIZED (
        SELECT count(*) AS "row_count" FROM locked
      ), lease_clock AS MATERIALIZED (
        SELECT ${leaseNow} AS "now"
        FROM locked_complete
        WHERE locked_complete."row_count" > 0
      ), merged AS MATERIALIZED (
        SELECT locked."target_id",
               count(DISTINCT locked."id") > 1 AS "should_merge",
               COALESCE(
                 jsonb_object_agg(field."key", field."value" ORDER BY locked."sequence")
                   FILTER (WHERE field."key" IS NOT NULL),
                 '{}'::jsonb
               ) AS "fields"
        FROM locked
        JOIN "integration_sync_work" AS work ON work."id" = locked."id"
        LEFT JOIN LATERAL jsonb_each(
          CASE WHEN jsonb_typeof(work."payload"->'fields') = 'object'
            THEN work."payload"->'fields' ELSE '{}'::jsonb END
        ) AS field ON true
        GROUP BY locked."target_id"
      ), superseded AS (
        UPDATE "integration_sync_work" AS work
        SET "state" = 'superseded'::"SyncWorkState", "updated_at" = lease_clock."now"
        FROM locked CROSS JOIN lease_clock
        WHERE work."id" = locked."id" AND work."id" <> locked."target_id"
        RETURNING work."id"
      ), leased AS (
        UPDATE "integration_sync_work" AS work
        SET "state" = 'leased'::"SyncWorkState",
            "lease_token" = gen_random_uuid()::text,
            "lease_until" = lease_clock."now" + ${leaseMs}::float8 * INTERVAL '1 millisecond',
            "fence" = work."fence" + 1,
            "payload" = CASE WHEN merged."should_merge"
              THEN jsonb_set(work."payload", '{fields}', merged."fields", true)
              ELSE work."payload" END,
            "updated_at" = lease_clock."now"
        FROM locked
        JOIN merged ON merged."target_id" = locked."target_id"
        CROSS JOIN lease_clock
        WHERE work."id" = locked."target_id"
        RETURNING work."id", work."sequence"
      )
      SELECT leased."id" FROM leased ORDER BY leased."sequence"
    `);

    if (claimed.length === 0) return [];
    return transaction.integrationSyncWork.findMany({
      where: { id: { in: claimed.map(({ id }) => id) } },
      orderBy: { sequence: "asc" },
    });
  });
}
