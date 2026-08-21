-- KAN-243: consolidate durable internal domain-event delivery into one outbox.
CREATE TABLE "domain_event_outbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "delivery_key" TEXT NOT NULL,
    "lane_key" TEXT NOT NULL,
    "position" BIGSERIAL NOT NULL,
    "event_type" TEXT NOT NULL,
    "workspace_id" UUID NOT NULL,
    "actor_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimed_at" TIMESTAMP(3),
    "claim_token" UUID,
    "acknowledged_at" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_event_outbox_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "domain_event_outbox_claim_check" CHECK (
      ("claimed_at" IS NULL) = ("claim_token" IS NULL)
    )
);

CREATE UNIQUE INDEX "domain_event_outbox_delivery_key_key"
ON "domain_event_outbox"("delivery_key");

CREATE UNIQUE INDEX "domain_event_outbox_position_key"
ON "domain_event_outbox"("position");

CREATE INDEX "domain_event_outbox_due_idx"
ON "domain_event_outbox"("acknowledged_at", "available_at", "claimed_at");

CREATE INDEX "domain_event_outbox_lane_head_idx"
ON "domain_event_outbox"("lane_key", "position", "acknowledged_at");

ALTER TABLE "work_transition_lifecycles"
ADD COLUMN "effect_revision" INTEGER NOT NULL DEFAULT 0;

-- Backfill only lifecycle effects that the legacy publisher never acknowledged.
-- One ordered INSERT keeps every lifecycle revision contiguous in the shared
-- issue/user lane: worklog.created -> work_session.ended -> interruption.closed.
INSERT INTO "domain_event_outbox" (
  "delivery_key", "lane_key", "event_type", "workspace_id", "actor_id", "payload"
)
SELECT
  effect."delivery_key",
  'work-session:' || lifecycle."issue_id"::text || ':' || lifecycle."user_id"::text,
  effect."event_type",
  project."workspace_id",
  effect."actor_id",
  effect."payload"
FROM "work_transition_lifecycles" lifecycle
JOIN "work_logs" work_log ON work_log."id" = lifecycle."work_log_id"
JOIN "issues" issue ON issue."id" = lifecycle."issue_id"
JOIN "projects" project ON project."id" = issue."project_id"
CROSS JOIN LATERAL (
  SELECT
    'work-transition-lifecycle:v1:' || lifecycle."id"::text || ':revision:0:worklog.created' AS "delivery_key",
    'worklog.created'::text AS "event_type",
    lifecycle."member_id" AS "actor_id",
    jsonb_build_object(
      'workLogId', work_log."id",
      'issueId', issue."id",
      'workspaceId', project."workspace_id"
    ) AS "payload",
    1 AS "ordinal"

  UNION ALL

  SELECT
    'work-transition-lifecycle:v1:' || lifecycle."id"::text || ':revision:0:work_session.ended',
    'work_session.ended'::text,
    lifecycle."member_id",
    jsonb_build_object(
      'issueKey', issue."key",
      'issueId', issue."id",
      'memberId', lifecycle."member_id",
      'userId', lifecycle."user_id",
      'workLogId', work_log."id",
      'durationS', work_log."duration_s",
      'reason', work_log."reason"
    ),
    2

  UNION ALL

  SELECT
    'work-transition-lifecycle:v1:' || lifecycle."id"::text || ':revision:0:interruption.closed:' || interruption."id"::text,
    'interruption.closed'::text,
    interruption."member_id",
    jsonb_build_object(
      'interruptionId', interruption."id",
      'incidentIssueId', interruption."incident_issue_id",
      'interruptedIssueId', interruption."interrupted_issue_id",
      'memberId', interruption."member_id"
    ),
    3
  FROM "interruptions" interruption
  WHERE interruption."incident_issue_id" = lifecycle."issue_id"
    AND interruption."member_id" = lifecycle."member_id"
    AND interruption."ended_at" = work_log."ended_at"
) effect
WHERE lifecycle."effects_emitted_at" IS NULL
  AND lifecycle."work_log_id" IS NOT NULL
  AND lifecycle."member_id" IS NOT NULL
  AND lifecycle."user_id" IS NOT NULL
  AND lifecycle."start_identity" IS NOT NULL
ORDER BY lifecycle."created_at", lifecycle."id", effect."ordinal", effect."delivery_key"
ON CONFLICT ("delivery_key") DO NOTHING;

DROP INDEX "work_transition_lifecycles_effects_pending_idx";
ALTER TABLE "work_transition_lifecycles"
DROP CONSTRAINT "work_transition_lifecycles_effect_claim_check";
ALTER TABLE "work_transition_lifecycles"
DROP COLUMN "effects_claimed_at",
DROP COLUMN "effect_claim_token",
DROP COLUMN "effects_emitted_at";
