-- CreateEnum
CREATE TYPE "TriageProposalLifecycleState" AS ENUM ('pending', 'dismissed', 'expired');

-- AlterTable
ALTER TABLE "milestone_deliverables" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- AlterTable
ALTER TABLE "milestones" ALTER COLUMN "id" DROP DEFAULT,
ALTER COLUMN "target" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "met_on" SET DATA TYPE TIMESTAMP(3),
ALTER COLUMN "created_at" SET DATA TYPE TIMESTAMP(3);

-- CreateTable
CREATE TABLE "triage_policies" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "version" TEXT NOT NULL,
    "retention_days" INTEGER NOT NULL DEFAULT 365,
    "disposition_list_visibility" TEXT NOT NULL DEFAULT 'hidden',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_proposals" (
    "id" UUID NOT NULL,
    "identity_digest" VARCHAR(64) NOT NULL,
    "target_issue_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "lifecycle" "TriageProposalLifecycleState" NOT NULL DEFAULT 'pending',
    "list_summary" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "disposed_at" TIMESTAMP(3),
    "supersedes_id" UUID,

    CONSTRAINT "triage_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_proposal_contents" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "payload" JSONB NOT NULL,
    "provenance" JSONB NOT NULL,

    CONSTRAINT "triage_proposal_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "triage_proposal_lifecycle_events" (
    "id" UUID NOT NULL,
    "proposal_id" UUID NOT NULL,
    "state" "TriageProposalLifecycleState" NOT NULL,
    "reason" TEXT,
    "actor_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "triage_proposal_lifecycle_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "triage_proposals_identity_digest_key" ON "triage_proposals"("identity_digest");

-- CreateIndex
CREATE INDEX "triage_proposals_target_issue_id_idx" ON "triage_proposals"("target_issue_id");

-- CreateIndex
CREATE INDEX "triage_proposals_workspace_id_lifecycle_idx" ON "triage_proposals"("workspace_id", "lifecycle");

-- CreateIndex
CREATE INDEX "triage_proposals_project_id_lifecycle_idx" ON "triage_proposals"("project_id", "lifecycle");

-- CreateIndex
CREATE INDEX "triage_proposals_expires_at_idx" ON "triage_proposals"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "triage_proposal_contents_proposal_id_key" ON "triage_proposal_contents"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "triage_proposal_lifecycle_events_proposal_id_state_key" ON "triage_proposal_lifecycle_events"("proposal_id", "state");

-- CreateIndex
CREATE UNIQUE INDEX "time_entries_source_work_log_id_key" ON "time_entries"("source_work_log_id");

-- AddForeignKey
ALTER TABLE "triage_policies" ADD CONSTRAINT "triage_policies_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_proposals" ADD CONSTRAINT "triage_proposals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_proposals" ADD CONSTRAINT "triage_proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_proposals" ADD CONSTRAINT "triage_proposals_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "triage_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_proposal_contents" ADD CONSTRAINT "triage_proposal_contents_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "triage_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "triage_proposal_lifecycle_events" ADD CONSTRAINT "triage_proposal_lifecycle_events_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "triage_proposals"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

