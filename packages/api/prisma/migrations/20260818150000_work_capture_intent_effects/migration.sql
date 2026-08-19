-- Durable WorkCaptureIntent commands reuse DomainEventOutbox for delivery.
ALTER TYPE "WorkCaptureState" ADD VALUE 'closing';

CREATE TYPE "WorkCaptureEffectKind" AS ENUM (
  'activity',
  'release',
  'close'
);

ALTER TABLE "work_capture_intents"
  ADD COLUMN "pending_effect_kind" "WorkCaptureEffectKind",
  ADD COLUMN "pending_effect_at" TIMESTAMP(3),
  ADD COLUMN "pending_effect_command_id" UUID,
  ADD COLUMN "effect_revision" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "work_capture_intents"
  DROP CONSTRAINT "work_capture_intents_closed_state";

ALTER TABLE "work_capture_intents"
  ADD CONSTRAINT "work_capture_intents_effect_revision_nonnegative"
    CHECK ("effect_revision" >= 0),
  ADD CONSTRAINT "work_capture_intents_pending_effect_tuple"
    CHECK (
      ("pending_effect_kind" IS NULL AND
       "pending_effect_at" IS NULL AND
       "pending_effect_command_id" IS NULL)
      OR
      ("pending_effect_kind" IS NOT NULL AND
       "pending_effect_at" IS NOT NULL AND
       "pending_effect_command_id" IS NOT NULL)
    ),
  ADD CONSTRAINT "work_capture_intents_closing_effect"
    CHECK (
      "state"::text <> 'closing'
      OR "pending_effect_kind" IS NOT DISTINCT FROM 'close'::"WorkCaptureEffectKind"
    ),
  ADD CONSTRAINT "work_capture_intents_closed_state"
    CHECK (("state" = 'closed') = ("closed_at" IS NOT NULL));
