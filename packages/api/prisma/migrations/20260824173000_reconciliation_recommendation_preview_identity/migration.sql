ALTER TABLE "integration_reconciliation_recommendations"
ADD COLUMN "preview_identity" UUID;

ALTER TABLE "integration_reconciliation_dispositions"
ADD COLUMN "accepted_ref_id" UUID;

DROP INDEX "uq_reconciliation_candidate_snapshot";
CREATE UNIQUE INDEX "uq_reconciliation_candidate_snapshot"
ON "integration_reconciliation_recommendations"(
  "binding_id", "preview_identity", "remote_issue_id", "remote_source_version", "candidate_issue_id",
  "scoring_version", "local_fingerprint", "remote_fingerprint"
);
CREATE INDEX "integration_reconciliation_preview_remote_idx"
ON "integration_reconciliation_recommendations"("binding_id", "preview_identity", "remote_issue_id");

CREATE UNIQUE INDEX "uq_reconciliation_candidate_snapshot_legacy"
ON "integration_reconciliation_recommendations"(
  "binding_id", "remote_issue_id", "remote_source_version", "candidate_issue_id",
  "scoring_version", "local_fingerprint", "remote_fingerprint"
) WHERE "preview_identity" IS NULL;
