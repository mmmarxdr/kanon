-- CreateIndex
CREATE INDEX CONCURRENTLY "triage_proposals_project_id_created_at_id_idx" ON "triage_proposals"("project_id", "created_at" DESC, "id" DESC);
