-- Independent owner leases make singleton WorkCaptureIntent release safe
-- across Web profiles, browser tabs, MCP processes, and legacy/manual clients.
CREATE TYPE "WorkCaptureOwnerKind" AS ENUM ('web', 'mcp', 'implicit');

CREATE TABLE "work_capture_owner_leases" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "intent_id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "epoch" UUID NOT NULL,
    "lease_generation" INTEGER NOT NULL,
    "owner_kind" "WorkCaptureOwnerKind" NOT NULL,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "work_capture_owner_leases_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "work_capture_owner_leases_generation_positive"
      CHECK ("lease_generation" > 0),
    CONSTRAINT "work_capture_owner_leases_intent_id_fkey"
      FOREIGN KEY ("intent_id") REFERENCES "work_capture_intents"("id")
      ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "work_capture_owner_intent_owner_key"
  ON "work_capture_owner_leases"("intent_id", "owner_id");

CREATE INDEX "work_capture_owner_fence_expiry_idx"
  ON "work_capture_owner_leases"(
    "intent_id",
    "epoch",
    "lease_generation",
    "expires_at"
  );

-- Existing live sessions predate independent ownership. Give each one a
-- short-lived implicit anchor so a newly deployed Web owner cannot release it.
INSERT INTO "work_capture_owner_leases" (
  "intent_id",
  "owner_id",
  "epoch",
  "lease_generation",
  "owner_kind",
  "first_seen_at",
  "last_seen_at",
  "expires_at"
)
SELECT
  intent."id",
  '00000000-0000-4000-8000-000000000001'::uuid,
  intent."epoch",
  intent."lease_generation",
  'implicit'::"WorkCaptureOwnerKind",
  session."started_at",
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP + INTERVAL '5 minutes'
FROM "work_capture_intents" intent
JOIN "work_sessions" session
  ON session."user_id" = intent."user_id"
 AND session."issue_id" = intent."issue_id"
WHERE intent."state" <> 'closed'
ON CONFLICT ("intent_id", "owner_id") DO NOTHING;
