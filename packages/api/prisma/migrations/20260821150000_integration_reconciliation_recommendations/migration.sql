-- CreateEnum
CREATE TYPE "IntegrationReconciliationDecisionState" AS ENUM ('pending', 'accepted', 'rejected');

-- CreateTable
CREATE TABLE "integration_reconciliation_recommendations" (
    "id" UUID NOT NULL,
    "remote_issue_id" TEXT NOT NULL,
    "remote_source_version" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "scoring_version" TEXT NOT NULL,
    "factor_evidence" JSONB NOT NULL,
    "local_fingerprint" TEXT NOT NULL,
    "remote_fingerprint" TEXT NOT NULL,
    "decision_state" "IntegrationReconciliationDecisionState" NOT NULL DEFAULT 'pending',
    "decision_kind" TEXT,
    "decided_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "binding_id" UUID NOT NULL,
    "candidate_issue_id" UUID NOT NULL,
    "decided_by_id" UUID,
    "accepted_ref_id" UUID,
    CONSTRAINT "integration_reconciliation_recommendations_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "integration_reconciliation_decision_shape" CHECK (
      ("decision_state" = 'pending' AND "decision_kind" IS NULL AND "decided_at" IS NULL AND "accepted_ref_id" IS NULL)
      OR ("decision_state" = 'accepted' AND "decision_kind" IS NOT NULL AND "decided_at" IS NOT NULL)
      OR ("decision_state" = 'rejected' AND "decision_kind" IS NOT NULL AND "decided_at" IS NOT NULL AND "accepted_ref_id" IS NULL)
    )
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_reconciliation_recommendations_accepted_ref_id_key"
ON "integration_reconciliation_recommendations"("accepted_ref_id");

CREATE UNIQUE INDEX "uq_reconciliation_candidate_snapshot"
ON "integration_reconciliation_recommendations"(
  "binding_id", "remote_issue_id", "remote_source_version", "candidate_issue_id",
  "scoring_version", "local_fingerprint", "remote_fingerprint"
);

CREATE UNIQUE INDEX "integration_reconciliation_accepted_remote_key"
ON "integration_reconciliation_recommendations"("binding_id", "remote_issue_id")
WHERE "decision_state" = 'accepted';

CREATE UNIQUE INDEX "integration_reconciliation_accepted_local_key"
ON "integration_reconciliation_recommendations"("binding_id", "candidate_issue_id")
WHERE "decision_state" = 'accepted';

CREATE INDEX "integration_reconciliation_binding_state_score_id_idx"
ON "integration_reconciliation_recommendations"("binding_id", "decision_state", "score" DESC, "id" DESC);

CREATE INDEX "integration_reconciliation_binding_remote_score_id_idx"
ON "integration_reconciliation_recommendations"("binding_id", "remote_issue_id", "score" DESC, "id" DESC);

-- AddForeignKey
ALTER TABLE "integration_reconciliation_recommendations"
ADD CONSTRAINT "integration_reconciliation_binding_fkey"
FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_reconciliation_recommendations"
ADD CONSTRAINT "integration_reconciliation_candidate_fkey"
FOREIGN KEY ("candidate_issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "integration_reconciliation_recommendations"
ADD CONSTRAINT "integration_reconciliation_decider_fkey"
FOREIGN KEY ("decided_by_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "integration_reconciliation_recommendations"
ADD CONSTRAINT "integration_reconciliation_accepted_ref_fkey"
FOREIGN KEY ("accepted_ref_id") REFERENCES "external_refs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
