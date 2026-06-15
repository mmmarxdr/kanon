-- KAN-103 PR1 (ADR-0005 D6): incident issue type + the Interruption edge.

-- ── IssueType += incident ───────────────────────────────────────────────────
-- Rename→create→USING (the repo's enum-extension pattern, per 20260614220000_ppm_w2_typed_deps).
-- issues.type is the only consumer; the 'task' default is dropped before the swap
-- and restored after, exactly like the IssueDependencyType migration.
ALTER TABLE "issues" ALTER COLUMN "type" DROP DEFAULT;
ALTER TYPE "IssueType" RENAME TO "IssueType_old";
CREATE TYPE "IssueType" AS ENUM ('feature', 'bug', 'task', 'spike', 'incident');
ALTER TABLE "issues"
  ALTER COLUMN "type" TYPE "IssueType" USING ("type"::text::"IssueType");
ALTER TABLE "issues" ALTER COLUMN "type" SET DEFAULT 'task';
DROP TYPE "IssueType_old";

-- ── Interruption edge ───────────────────────────────────────────────────────
-- What an incident displaced. incident/interrupted both reference issues (cascade
-- on delete); via is free-form provenance ("session_switch" | "manual").
CREATE TABLE "interruptions" (
    "id" UUID NOT NULL,
    "incident_issue_id" UUID NOT NULL,
    "interrupted_issue_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),
    "via" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "interruptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "interruptions_incident_issue_id_idx" ON "interruptions"("incident_issue_id");
CREATE INDEX "interruptions_interrupted_issue_id_idx" ON "interruptions"("interrupted_issue_id");
CREATE INDEX "interruptions_member_id_started_at_idx" ON "interruptions"("member_id", "started_at" DESC);

ALTER TABLE "interruptions" ADD CONSTRAINT "interruptions_incident_issue_id_fkey" FOREIGN KEY ("incident_issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interruptions" ADD CONSTRAINT "interruptions_interrupted_issue_id_fkey" FOREIGN KEY ("interrupted_issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "interruptions" ADD CONSTRAINT "interruptions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
