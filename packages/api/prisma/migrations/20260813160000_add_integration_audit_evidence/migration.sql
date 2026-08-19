-- CreateEnum
CREATE TYPE "IntegrationAuditRunState" AS ENUM ('complete', 'partial', 'failed', 'stale');

-- CreateTable
CREATE TABLE "integration_audit_runs" (
    "id" UUID NOT NULL,
    "scope_fingerprint" TEXT NOT NULL,
    "lease_token" TEXT NOT NULL,
    "fence" INTEGER NOT NULL,
    "state" "IntegrationAuditRunState" NOT NULL DEFAULT 'partial',
    "reason_code" TEXT,
    "provider_observed_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "valid_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "binding_id" UUID NOT NULL,
    CONSTRAINT "integration_audit_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_audit_checkpoints" (
    "id" UUID NOT NULL,
    "pass" INTEGER NOT NULL,
    "offset" INTEGER NOT NULL,
    "item_index" INTEGER NOT NULL,
    "expected_total" INTEGER NOT NULL,
    "last_issue_updated_at" TIMESTAMP(3),
    "last_issue_id" TEXT,
    "scope_fingerprint" TEXT NOT NULL,
    "fence" INTEGER NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "run_id" UUID NOT NULL,
    CONSTRAINT "integration_audit_checkpoints_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "integration_audit_observations" (
    "id" UUID NOT NULL,
    "identity_type" TEXT NOT NULL,
    "remote_id" TEXT NOT NULL,
    "parent_remote_id" TEXT NOT NULL DEFAULT '',
    "source_updated_at" TIMESTAMP(3) NOT NULL,
    "observed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "run_id" UUID NOT NULL,
    CONSTRAINT "integration_audit_observations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_audit_runs_binding_id_state_completed_at_idx" ON "integration_audit_runs"("binding_id", "state", "completed_at");
CREATE INDEX "integration_audit_runs_binding_id_scope_fingerprint_idx" ON "integration_audit_runs"("binding_id", "scope_fingerprint");
CREATE UNIQUE INDEX "integration_audit_checkpoints_run_id_key" ON "integration_audit_checkpoints"("run_id");
CREATE UNIQUE INDEX "integration_audit_observations_run_id_identity_type_parent_remote_id_remote_id_source_updated_at_key" ON "integration_audit_observations"("run_id", "identity_type", "parent_remote_id", "remote_id", "source_updated_at");
CREATE INDEX "integration_audit_observations_run_id_observed_at_idx" ON "integration_audit_observations"("run_id", "observed_at");

-- AddForeignKey
ALTER TABLE "integration_audit_runs" ADD CONSTRAINT "integration_audit_runs_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_audit_checkpoints" ADD CONSTRAINT "integration_audit_checkpoints_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "integration_audit_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_audit_observations" ADD CONSTRAINT "integration_audit_observations_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "integration_audit_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
