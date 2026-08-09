-- AlterTable
ALTER TABLE "integration_project_bindings" ADD COLUMN     "comment_capture_enabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "comment_dispatch_enabled" BOOLEAN NOT NULL DEFAULT false;
