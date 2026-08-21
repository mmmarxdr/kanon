CREATE TYPE "WorkCaptureFailureStage" AS ENUM (
  'effect_apply'
);

CREATE TYPE "WorkCaptureFailureResolution" AS ENUM (
  'succeeded',
  'superseded'
);

ALTER TYPE "NotificationKind" ADD VALUE 'work_capture_failure';

ALTER TABLE "work_capture_intents"
  ADD COLUMN "failure_episode_id" UUID,
  ADD COLUMN "failure_command_id" UUID,
  ADD COLUMN "failure_epoch" UUID,
  ADD COLUMN "failure_lease_generation" INTEGER,
  ADD COLUMN "failure_effect_revision" INTEGER,
  ADD COLUMN "failure_effect_kind" "WorkCaptureEffectKind",
  ADD COLUMN "failure_effect_at" TIMESTAMP(3),
  ADD COLUMN "failure_stage" "WorkCaptureFailureStage",
  ADD COLUMN "failure_code" TEXT,
  ADD COLUMN "failure_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "failure_first_at" TIMESTAMP(3),
  ADD COLUMN "failure_last_at" TIMESTAMP(3),
  ADD COLUMN "failure_resolved_at" TIMESTAMP(3),
  ADD COLUMN "failure_resolution" "WorkCaptureFailureResolution";

ALTER TABLE "work_capture_intents"
  ADD CONSTRAINT "work_capture_intents_failure_tuple"
    CHECK (
      (
        "failure_count" = 0
        AND "failure_episode_id" IS NULL
        AND "failure_command_id" IS NULL
        AND "failure_epoch" IS NULL
        AND "failure_lease_generation" IS NULL
        AND "failure_effect_revision" IS NULL
        AND "failure_effect_kind" IS NULL
        AND "failure_effect_at" IS NULL
        AND "failure_stage" IS NULL
        AND "failure_code" IS NULL
        AND "failure_first_at" IS NULL
        AND "failure_last_at" IS NULL
        AND "failure_resolved_at" IS NULL
        AND "failure_resolution" IS NULL
      )
      OR
      (
        "failure_count" > 0
        AND "failure_episode_id" IS NOT NULL
        AND "failure_command_id" IS NOT NULL
        AND "failure_epoch" IS NOT NULL
        AND "failure_lease_generation" > 0
        AND "failure_effect_revision" > 0
        AND "failure_effect_kind" IS NOT NULL
        AND "failure_effect_at" IS NOT NULL
        AND "failure_stage" IS NOT NULL
        AND "failure_code" IS NOT NULL
        AND "failure_first_at" IS NOT NULL
        AND "failure_last_at" IS NOT NULL
      )
    ),
  ADD CONSTRAINT "work_capture_intents_failure_timestamps"
    CHECK (
      "failure_count" = 0
      OR (
        "failure_first_at" <= "failure_last_at"
        AND (
          "failure_resolved_at" IS NULL
          OR "failure_last_at" <= "failure_resolved_at"
        )
      )
    ),
  ADD CONSTRAINT "work_capture_intents_failure_resolution_pair"
    CHECK (
      ("failure_resolved_at" IS NULL) = ("failure_resolution" IS NULL)
    ),
  ADD CONSTRAINT "work_capture_intents_unresolved_failure_matches_pending"
    CHECK (
      "failure_count" = 0
      OR "failure_resolved_at" IS NOT NULL
      OR (
        "failure_epoch" IS NOT DISTINCT FROM "epoch"
        AND "failure_lease_generation" IS NOT DISTINCT FROM "lease_generation"
        AND "failure_effect_revision" IS NOT DISTINCT FROM "effect_revision"
        AND "failure_command_id" IS NOT DISTINCT FROM "pending_effect_command_id"
        AND "failure_effect_kind" IS NOT DISTINCT FROM "pending_effect_kind"
        AND "failure_effect_at" IS NOT DISTINCT FROM "pending_effect_at"
      )
    );

CREATE UNIQUE INDEX "work_capture_intents_failure_episode_id_key"
  ON "work_capture_intents"("failure_episode_id");

CREATE INDEX "work_capture_intents_issue_id_failure_resolved_at_idx"
  ON "work_capture_intents"("issue_id", "failure_resolved_at");

ALTER TABLE "notifications"
  ADD COLUMN "work_capture_failure_episode_id" UUID;

ALTER TABLE "notifications"
  ADD CONSTRAINT "notifications_work_capture_failure_episode_pair"
    CHECK (
      ("kind"::text = 'work_capture_failure') =
      ("work_capture_failure_episode_id" IS NOT NULL)
    );

CREATE UNIQUE INDEX "notifications_work_capture_failure_episode_id_key"
  ON "notifications"("work_capture_failure_episode_id");
