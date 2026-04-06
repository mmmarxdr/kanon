-- CreateTable
CREATE TABLE "work_sessions" (
    "id" UUID NOT NULL,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_heartbeat" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'mcp',
    "user_id" UUID NOT NULL,
    "issue_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,

    CONSTRAINT "work_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "work_sessions_issue_id_last_heartbeat_idx" ON "work_sessions"("issue_id", "last_heartbeat");

-- CreateIndex
CREATE INDEX "work_sessions_member_id_last_heartbeat_idx" ON "work_sessions"("member_id", "last_heartbeat");

-- CreateIndex
CREATE UNIQUE INDEX "work_sessions_user_id_issue_id_key" ON "work_sessions"("user_id", "issue_id");

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
