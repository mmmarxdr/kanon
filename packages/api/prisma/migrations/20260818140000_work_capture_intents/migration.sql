-- Durable capture intent is distinct from the ephemeral WorkSession lease.
CREATE TYPE "WorkCaptureState" AS ENUM (
  'adopted',
  'capturing',
  'paused',
  'closed'
);

CREATE TABLE "work_capture_intents" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "epoch" UUID NOT NULL DEFAULT gen_random_uuid(),
  "state" "WorkCaptureState" NOT NULL DEFAULT 'adopted',
  "lease_generation" INTEGER NOT NULL DEFAULT 1,
  "source" TEXT NOT NULL DEFAULT 'mcp',
  "closed_at" TIMESTAMP(3),
  "user_id" UUID NOT NULL,
  "issue_id" UUID NOT NULL,
  "member_id" UUID NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "work_capture_intents_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "work_capture_intents_generation_positive"
    CHECK ("lease_generation" > 0),
  CONSTRAINT "work_capture_intents_closed_state"
    CHECK (("state" = 'closed') = ("closed_at" IS NOT NULL))
);

CREATE UNIQUE INDEX "work_capture_intents_epoch_key"
  ON "work_capture_intents"("epoch");
CREATE UNIQUE INDEX "work_capture_intents_user_id_issue_id_key"
  ON "work_capture_intents"("user_id", "issue_id");
CREATE INDEX "work_capture_intents_issue_id_state_idx"
  ON "work_capture_intents"("issue_id", "state");
CREATE INDEX "work_capture_intents_member_id_state_updated_at_idx"
  ON "work_capture_intents"("member_id", "state", "updated_at");

ALTER TABLE "work_capture_intents"
  ADD CONSTRAINT "work_capture_intents_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_capture_intents"
  ADD CONSTRAINT "work_capture_intents_issue_id_fkey"
  FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "work_capture_intents"
  ADD CONSTRAINT "work_capture_intents_member_id_fkey"
  FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Preserve only currently live leases. A matching open interruption means the
-- durable intent is paused at rollout; WorkLogs and interruption-only rows do
-- not infer capture intent.
INSERT INTO "work_capture_intents" (
  "id",
  "epoch",
  "state",
  "lease_generation",
  "source",
  "user_id",
  "issue_id",
  "member_id",
  "created_at",
  "updated_at"
)
SELECT
  gen_random_uuid(),
  gen_random_uuid(),
  CASE
    WHEN interruption."present" IS NOT NULL THEN 'paused'::"WorkCaptureState"
    ELSE 'capturing'::"WorkCaptureState"
  END,
  1,
  session."source",
  session."user_id",
  session."issue_id",
  session."member_id",
  session."started_at",
  GREATEST(session."last_heartbeat", session."started_at")
FROM "work_sessions" session
LEFT JOIN LATERAL (
  SELECT 1 AS "present"
  FROM "interruptions" interruption
  WHERE interruption."interrupted_issue_id" = session."issue_id"
    AND interruption."member_id" = session."member_id"
    AND interruption."ended_at" IS NULL
  LIMIT 1
) interruption ON TRUE
WHERE session."last_heartbeat" > CURRENT_TIMESTAMP - INTERVAL '5 minutes'
  AND session."source" NOT LIKE 'historical-transition:%';
