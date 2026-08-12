-- CreateIndex
CREATE INDEX "triage_proposals_project_id_created_at_id_idx" ON "triage_proposals"("project_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "triage_proposals_project_id_target_issue_id_created_at_id_idx" ON "triage_proposals"("project_id", "target_issue_id", "created_at" DESC, "id" DESC);
