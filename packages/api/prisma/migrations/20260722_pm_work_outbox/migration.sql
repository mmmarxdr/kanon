-- CreateEnum
CREATE TYPE "SyncDirection" AS ENUM ('outbound', 'inbound');

-- CreateEnum
CREATE TYPE "SyncOperation" AS ENUM ('create', 'update', 'delete', 'close');

-- CreateEnum
CREATE TYPE "SyncWorkState" AS ENUM ('queued', 'leased', 'retry', 'superseded', 'ambiguous', 'dead', 'done', 'skipped');

-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('user', 'system', 'ai', 'remote');

-- CreateTable
CREATE TABLE "integration_sync_work" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "direction" "SyncDirection" NOT NULL,
    "operation" "SyncOperation" NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "lane_key" TEXT NOT NULL,
    "actor_key" TEXT NOT NULL,
    "actor_kind" "ActorKind" NOT NULL,
    "payload" JSONB NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "state" "SyncWorkState" NOT NULL DEFAULT 'queued',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "epoch" INTEGER NOT NULL,
    "auth_credential_id" UUID,
    "ref_id" UUID,
    "marker" TEXT,
    "skipped_reason" TEXT,
    "requested_status" TEXT,
    "actual_status" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "binding_id" UUID NOT NULL,

    CONSTRAINT "integration_sync_work_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_sync_work_sequence_key"
    ON "integration_sync_work"("sequence");
CREATE UNIQUE INDEX "integration_sync_work_dedupe_key_key"
    ON "integration_sync_work"("dedupe_key");
CREATE INDEX "integration_sync_work_binding_id_lane_key_sequence_idx"
    ON "integration_sync_work"("binding_id", "lane_key", "sequence");
CREATE INDEX "integration_sync_work_state_available_at_idx"
    ON "integration_sync_work"("state", "available_at");

-- AddForeignKey
ALTER TABLE "integration_sync_work"
    ADD CONSTRAINT "integration_sync_work_binding_id_fkey"
    FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_sync_work"
    ADD CONSTRAINT "integration_sync_work_auth_credential_id_fkey"
    FOREIGN KEY ("auth_credential_id") REFERENCES "member_integration_credentials"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_sync_work"
    ADD CONSTRAINT "integration_sync_work_ref_id_fkey"
    FOREIGN KEY ("ref_id") REFERENCES "external_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
