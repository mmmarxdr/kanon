-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "group_key" TEXT;

-- CreateIndex
CREATE INDEX "issues_project_id_group_key_idx" ON "issues"("project_id", "group_key");
