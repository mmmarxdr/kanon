-- CreateEnum
CREATE TYPE "IntegrationLifecycle" AS ENUM ('draft', 'active', 'pausing', 'paused', 'disabled');

-- AlterTable
ALTER TABLE "integration_connections"
    ADD COLUMN "lifecycle" "IntegrationLifecycle" NOT NULL DEFAULT 'draft',
    ADD COLUMN "lifecycle_epoch" INTEGER NOT NULL DEFAULT 0,
    ADD COLUMN "service_fallback_enabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "integration_project_bindings" (
    "id" UUID NOT NULL,
    "remote_project_id" TEXT NOT NULL,
    "read_map" JSONB NOT NULL,
    "write_map" JSONB NOT NULL,
    "lifecycle" "IntegrationLifecycle" NOT NULL DEFAULT 'draft',
    "lifecycle_epoch" INTEGER NOT NULL DEFAULT 0,
    "cursor_updated_at" TIMESTAMP(3),
    "cursor_remote_id" TEXT,
    "page_token" TEXT,
    "poll_lease_token" TEXT,
    "poll_lease_until" TIMESTAMP(3),
    "poll_fence" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "connection_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,

    CONSTRAINT "integration_project_bindings_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "external_refs"
    ADD COLUMN "binding_id" UUID,
    ADD COLUMN "remote_updated_at" TIMESTAMP(3),
    ADD COLUMN "local_version" BIGINT NOT NULL DEFAULT 0,
    ADD COLUMN "last_correlation_id" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "integration_project_bindings_connection_id_project_id_key"
    ON "integration_project_bindings"("connection_id", "project_id");
CREATE UNIQUE INDEX "integration_project_bindings_connection_id_remote_project_i_key"
    ON "integration_project_bindings"("connection_id", "remote_project_id");
CREATE INDEX "integration_project_bindings_lifecycle_poll_lease_until_idx"
    ON "integration_project_bindings"("lifecycle", "poll_lease_until");
CREATE INDEX "integration_project_bindings_project_id_idx"
    ON "integration_project_bindings"("project_id");
CREATE INDEX "external_refs_binding_id_idx" ON "external_refs"("binding_id");

-- AddForeignKey
ALTER TABLE "integration_project_bindings"
    ADD CONSTRAINT "integration_project_bindings_connection_id_fkey"
    FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_project_bindings"
    ADD CONSTRAINT "integration_project_bindings_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "external_refs"
    ADD CONSTRAINT "external_refs_binding_id_fkey"
    FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE SET NULL ON UPDATE CASCADE;
