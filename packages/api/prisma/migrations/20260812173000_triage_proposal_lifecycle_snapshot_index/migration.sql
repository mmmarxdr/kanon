-- CreateIndex
CREATE INDEX CONCURRENTLY "triage_proposal_lifecycle_events_proposal_id_created_at_id_idx" ON "triage_proposal_lifecycle_events"("proposal_id", "created_at" DESC, "id" DESC);
