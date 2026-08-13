-- KAN-243: persist transition lifecycle identity, pairing, and effect state.
CREATE TABLE "work_transition_lifecycles" (
    "id" UUID NOT NULL,
    "source" TEXT NOT NULL,
    "start_identity" TEXT,
    "close_identity" TEXT,
    "started_at" TIMESTAMP(3),
    "ended_at" TIMESTAMP(3),
    "work_log_id" UUID,
    "effects_claimed_at" TIMESTAMP(3),
    "effect_claim_token" UUID,
    "effects_emitted_at" TIMESTAMP(3),
    "issue_id" UUID NOT NULL,
    "user_id" UUID,
    "member_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_transition_lifecycles_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_transition_lifecycles_start_fields_check" CHECK (
      ("start_identity" IS NULL AND "started_at" IS NULL AND "user_id" IS NULL AND "member_id" IS NULL)
      OR
      ("start_identity" IS NOT NULL AND "started_at" IS NOT NULL AND "user_id" IS NOT NULL AND "member_id" IS NOT NULL)
    ),
    CONSTRAINT "work_transition_lifecycles_close_fields_check" CHECK (
      ("close_identity" IS NULL AND "ended_at" IS NULL)
      OR
      ("close_identity" IS NOT NULL AND "ended_at" IS NOT NULL)
    ),
    CONSTRAINT "work_transition_lifecycles_interval_check" CHECK (
      "started_at" IS NULL OR "ended_at" IS NULL OR "started_at" < "ended_at"
    ),
    CONSTRAINT "work_transition_lifecycles_effect_claim_check" CHECK (
      ("effects_claimed_at" IS NULL) = ("effect_claim_token" IS NULL)
    )
);

CREATE UNIQUE INDEX "work_transition_lifecycles_start_identity_key"
ON "work_transition_lifecycles"("start_identity");

CREATE UNIQUE INDEX "work_transition_lifecycles_close_identity_key"
ON "work_transition_lifecycles"("close_identity");

CREATE UNIQUE INDEX "work_transition_lifecycles_work_log_id_key"
ON "work_transition_lifecycles"("work_log_id");

CREATE INDEX "work_transition_lifecycles_issue_id_started_at_idx"
ON "work_transition_lifecycles"("issue_id", "started_at");

CREATE INDEX "work_transition_lifecycles_issue_id_ended_at_idx"
ON "work_transition_lifecycles"("issue_id", "ended_at");

CREATE INDEX "work_transition_lifecycles_effects_emitted_at_effects_claimed_at_idx"
ON "work_transition_lifecycles"("effects_emitted_at", "effects_claimed_at");

ALTER TABLE "work_transition_lifecycles"
ADD CONSTRAINT "work_transition_lifecycles_work_log_id_fkey"
FOREIGN KEY ("work_log_id") REFERENCES "work_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "work_transition_lifecycles"
ADD CONSTRAINT "work_transition_lifecycles_issue_id_fkey"
FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_transition_lifecycles"
ADD CONSTRAINT "work_transition_lifecycles_user_id_fkey"
FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_transition_lifecycles"
ADD CONSTRAINT "work_transition_lifecycles_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "work_sessions"
ADD COLUMN "transition_lifecycle_id" UUID;

CREATE UNIQUE INDEX "work_sessions_transition_lifecycle_id_key"
ON "work_sessions"("transition_lifecycle_id");

ALTER TABLE "work_sessions"
ADD CONSTRAINT "work_sessions_transition_lifecycle_id_fkey"
FOREIGN KEY ("transition_lifecycle_id") REFERENCES "work_transition_lifecycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;
