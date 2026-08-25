-- CreateEnum
CREATE TYPE "IntegrationReconciliationDispositionState" AS ENUM ('pending', 'import_as_new', 'linked');

-- CreateTable
CREATE TABLE "integration_reconciliation_dispositions" (
    "id" UUID NOT NULL,
    "preview_identity" UUID NOT NULL,
    "remote_issue_id" TEXT NOT NULL,
    "remote_source_version" TEXT NOT NULL,
    "state" "IntegrationReconciliationDispositionState" NOT NULL DEFAULT 'pending',
    "decision_kind" TEXT,
    "decided_at" TIMESTAMP(3),
    "decided_by_id" UUID,
    "binding_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "integration_reconciliation_dispositions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "uq_reconciliation_disposition_preview_remote"
ON "integration_reconciliation_dispositions"("binding_id", "preview_identity", "remote_issue_id");

CREATE INDEX "integration_reconciliation_disposition_preview_state_idx"
ON "integration_reconciliation_dispositions"("binding_id", "preview_identity", "state");

-- AddForeignKey
ALTER TABLE "integration_reconciliation_dispositions"
ADD CONSTRAINT "integration_reconciliation_disposition_binding_fkey"
FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_reconciliation_dispositions"
ADD CONSTRAINT "integration_reconciliation_disposition_decider_fkey"
FOREIGN KEY ("decided_by_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
