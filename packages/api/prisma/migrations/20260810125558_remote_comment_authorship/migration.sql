-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "remote_actor_id" UUID,
ALTER COLUMN "member_id" DROP NOT NULL;

ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_actor_xor"
CHECK (num_nonnulls("member_id", "remote_actor_id") = 1);

-- AlterTable
ALTER TABLE "comments" ADD COLUMN     "remote_author_id" UUID,
ALTER COLUMN "author_id" DROP NOT NULL;

ALTER TABLE "comments" ADD CONSTRAINT "comments_author_xor"
CHECK (num_nonnulls("author_id", "remote_author_id") = 1);

-- CreateIndex
CREATE INDEX "activity_logs_remote_actor_id_idx" ON "activity_logs"("remote_actor_id");

-- CreateIndex
CREATE INDEX "comments_remote_author_id_idx" ON "comments"("remote_author_id");

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_remote_actor_id_fkey" FOREIGN KEY ("remote_actor_id") REFERENCES "integration_external_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_remote_author_id_fkey" FOREIGN KEY ("remote_author_id") REFERENCES "integration_external_identities"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
