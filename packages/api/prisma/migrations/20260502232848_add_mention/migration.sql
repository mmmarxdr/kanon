-- CreateTable
CREATE TABLE "mentions" (
    "id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "comment_id" UUID,
    "mentioned_member_id" UUID NOT NULL,
    "mentioned_by_member_id" UUID NOT NULL,
    "context" TEXT NOT NULL,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mentions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_mention_dashboard_query" ON "mentions"("workspace_id", "mentioned_member_id", "read", "created_at" DESC);

-- CreateIndex
CREATE INDEX "mentions_issue_id_idx" ON "mentions"("issue_id");

-- CreateIndex
CREATE INDEX "mentions_comment_id_idx" ON "mentions"("comment_id");

-- CreateIndex
CREATE UNIQUE INDEX "uniq_mention_per_comment_member" ON "mentions"("comment_id", "mentioned_member_id");

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_mentioned_member_id_fkey" FOREIGN KEY ("mentioned_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_mentioned_by_member_id_fkey" FOREIGN KEY ("mentioned_by_member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
