ALTER TABLE "integration_reconciliation_recommendations"
DROP CONSTRAINT "integration_reconciliation_candidate_fkey";

ALTER TABLE "integration_reconciliation_recommendations"
ADD CONSTRAINT "integration_reconciliation_candidate_fkey"
FOREIGN KEY ("candidate_issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
