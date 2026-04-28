-- CreateEnum
CREATE TYPE "InviteKind" AS ENUM ('MEMBER', 'ONBOARDING');

-- CreateEnum
CREATE TYPE "RefreshSource" AS ENUM ('ONBOARDING', 'LOGIN');

-- DropForeignKey
ALTER TABLE "cycle_scope_events" DROP CONSTRAINT "cycle_scope_events_author_id_fkey";

-- DropForeignKey
ALTER TABLE "cycle_scope_events" DROP CONSTRAINT "cycle_scope_events_cycle_id_fkey";

-- DropForeignKey
ALTER TABLE "cycles" DROP CONSTRAINT "cycles_project_id_fkey";

-- DropForeignKey
ALTER TABLE "issues" DROP CONSTRAINT "issues_cycle_id_fkey";

-- AlterTable
ALTER TABLE "cycle_scope_events" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "cycles" ALTER COLUMN "id" DROP DEFAULT;

-- AlterTable
ALTER TABLE "workspace_invites" ADD COLUMN     "consumed_at" TIMESTAMP(3),
ADD COLUMN     "kind" "InviteKind" NOT NULL DEFAULT 'MEMBER';

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "source" "RefreshSource" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "metadata" JSONB,
    "user_id" UUID NOT NULL,
    "workspace_id" UUID NOT NULL,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_workspace_id_idx" ON "refresh_tokens"("user_id", "workspace_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycles" ADD CONSTRAINT "cycles_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_scope_events" ADD CONSTRAINT "cycle_scope_events_cycle_id_fkey" FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cycle_scope_events" ADD CONSTRAINT "cycle_scope_events_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
