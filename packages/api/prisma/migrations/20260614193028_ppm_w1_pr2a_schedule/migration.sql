-- CreateTable
CREATE TABLE "issue_schedules" (
    "issueId" UUID NOT NULL,
    "start_date" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "progress" INTEGER NOT NULL DEFAULT 0,
    "estimate_hours" DECIMAL(8,2),
    "baseline_start" TIMESTAMP(3),
    "baseline_end" TIMESTAMP(3),
    "baseline_set_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "issue_schedules_pkey" PRIMARY KEY ("issueId")
);

-- CreateTable
CREATE TABLE "estimate_revisions" (
    "id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "hours" DECIMAL(8,2) NOT NULL,
    "reason" TEXT,
    "author_id" UUID NOT NULL,
    "via" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "estimate_revisions_issue_id_created_at_idx" ON "estimate_revisions"("issue_id", "created_at");

-- AddForeignKey
ALTER TABLE "issue_schedules" ADD CONSTRAINT "issue_schedules_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_revisions" ADD CONSTRAINT "estimate_revisions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_revisions" ADD CONSTRAINT "estimate_revisions_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
