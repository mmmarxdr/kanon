-- AlterTable
ALTER TABLE "refresh_tokens" ADD COLUMN     "allowed_project_ids" UUID[] DEFAULT ARRAY[]::UUID[];
