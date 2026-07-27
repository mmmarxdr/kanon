-- CreateEnum
CREATE TYPE "InboundApplicationState" AS ENUM ('claimed', 'applied', 'conflict', 'skipped');

-- CreateEnum
CREATE TYPE "ConflictState" AS ENUM ('open', 'resolved');

-- CreateTable
CREATE TABLE "integration_inbound_applications" (
    "id" UUID NOT NULL,
    "remote_entity_type" TEXT NOT NULL,
    "remote_id" TEXT NOT NULL,
    "remote_updated_at" TIMESTAMP(3) NOT NULL,
    "application_key" TEXT NOT NULL,
    "correlation_id" TEXT NOT NULL,
    "state" "InboundApplicationState" NOT NULL DEFAULT 'claimed',
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "fence" INTEGER NOT NULL DEFAULT 0,
    "ref_id" UUID,
    "work_id" UUID,
    "outcome" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "binding_id" UUID NOT NULL,

    CONSTRAINT "integration_inbound_applications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_conflicts" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "state" "ConflictState" NOT NULL DEFAULT 'open',
    "local_evidence" JSONB NOT NULL,
    "remote_evidence" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "binding_id" UUID NOT NULL,
    "work_id" UUID,
    "ref_id" UUID,
    "application_id" UUID,

    CONSTRAINT "integration_conflicts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_inbound_applications_application_key_key" ON "integration_inbound_applications"("application_key");
CREATE UNIQUE INDEX "integration_inbound_applications_binding_id_remote_entity_t_key" ON "integration_inbound_applications"("binding_id", "remote_entity_type", "remote_id", "remote_updated_at");
CREATE INDEX "integration_conflicts_binding_id_state_idx" ON "integration_conflicts"("binding_id", "state");

-- AddForeignKey
ALTER TABLE "integration_inbound_applications" ADD CONSTRAINT "integration_inbound_applications_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_inbound_applications" ADD CONSTRAINT "integration_inbound_applications_ref_id_fkey" FOREIGN KEY ("ref_id") REFERENCES "external_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_inbound_applications" ADD CONSTRAINT "integration_inbound_applications_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "integration_sync_work"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_conflicts" ADD CONSTRAINT "integration_conflicts_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_conflicts" ADD CONSTRAINT "integration_conflicts_work_id_fkey" FOREIGN KEY ("work_id") REFERENCES "integration_sync_work"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_conflicts" ADD CONSTRAINT "integration_conflicts_ref_id_fkey" FOREIGN KEY ("ref_id") REFERENCES "external_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "integration_conflicts" ADD CONSTRAINT "integration_conflicts_application_id_fkey" FOREIGN KEY ("application_id") REFERENCES "integration_inbound_applications"("id") ON DELETE SET NULL ON UPDATE CASCADE;
