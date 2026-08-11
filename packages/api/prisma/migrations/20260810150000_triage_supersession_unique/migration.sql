CREATE UNIQUE INDEX "triage_proposals_supersedes_id_key"
ON "triage_proposals"("supersedes_id");

ALTER TABLE "triage_proposals"
ADD CONSTRAINT "triage_proposals_supersedes_not_self"
CHECK ("supersedes_id" IS NULL OR "supersedes_id" <> "id");

ALTER TABLE "triage_proposals"
ADD CONSTRAINT "triage_proposals_supersedes_id_fkey"
FOREIGN KEY ("supersedes_id") REFERENCES "triage_proposals"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
