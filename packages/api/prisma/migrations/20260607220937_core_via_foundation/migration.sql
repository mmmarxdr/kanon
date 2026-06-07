-- CreateEnum
CREATE TYPE "NotificationKind" AS ENUM ('mention', 'assignment', 'subscribed_activity', 'cycle_closed');

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "via" TEXT;

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "via" TEXT;

-- AlterTable
ALTER TABLE "issue_documents" ALTER COLUMN "id" DROP DEFAULT;

-- CreateTable
CREATE TABLE "work_logs" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL,
    "ended_at" TIMESTAMP(3) NOT NULL,
    "duration_s" INTEGER NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'stopped',
    "via" TEXT,
    "issue_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "work_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "kind" "NotificationKind" NOT NULL,
    "workspace_id" UUID NOT NULL,
    "recipient_id" UUID NOT NULL,
    "actor_id" UUID,
    "issue_id" UUID,
    "mention_id" UUID,
    "comment_id" UUID,
    "payload" JSONB,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "via" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "issue_subscriptions" (
    "id" UUID NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "issue_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "issue_subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_preferences" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "email_mention" BOOLEAN NOT NULL DEFAULT true,
    "email_assignment" BOOLEAN NOT NULL DEFAULT true,
    "email_cycle_closed" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_logs_issue_id_ended_at_idx" ON "work_logs"("issue_id", "ended_at" DESC);

-- CreateIndex
CREATE INDEX "work_logs_member_id_ended_at_idx" ON "work_logs"("member_id", "ended_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_recipient_id_read_created_at_idx" ON "notifications"("recipient_id", "read", "created_at" DESC);

-- CreateIndex
CREATE INDEX "notifications_issue_id_idx" ON "notifications"("issue_id");

-- CreateIndex
CREATE INDEX "notifications_mention_id_idx" ON "notifications"("mention_id");

-- CreateIndex
CREATE INDEX "notifications_actor_id_idx" ON "notifications"("actor_id");

-- CreateIndex
CREATE INDEX "notifications_comment_id_idx" ON "notifications"("comment_id");

-- CreateIndex
CREATE INDEX "issue_subscriptions_member_id_idx" ON "issue_subscriptions"("member_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_subscriptions_issue_id_member_id_key" ON "issue_subscriptions"("issue_id", "member_id");

-- CreateIndex
CREATE UNIQUE INDEX "notification_preferences_member_id_key" ON "notification_preferences"("member_id");

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_logs" ADD CONSTRAINT "work_logs_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_recipient_id_fkey" FOREIGN KEY ("recipient_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_mention_id_fkey" FOREIGN KEY ("mention_id") REFERENCES "mentions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_comment_id_fkey" FOREIGN KEY ("comment_id") REFERENCES "comments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_subscriptions" ADD CONSTRAINT "issue_subscriptions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_subscriptions" ADD CONSTRAINT "issue_subscriptions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
