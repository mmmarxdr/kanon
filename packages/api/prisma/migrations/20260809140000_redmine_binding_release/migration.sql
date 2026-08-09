-- AlterTable
ALTER TABLE "integration_project_bindings" ADD COLUMN     "release_requested_at" TIMESTAMP(3),
ADD COLUMN     "released_at" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "integration_project_bindings_remote_project_id_released_at_idx" ON "integration_project_bindings"("remote_project_id", "released_at");

-- CreateIndex
CREATE INDEX "integration_project_bindings_release_requested_at_idx" ON "integration_project_bindings"("release_requested_at");
