-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('adr', 'pdr', 'rfc', 'note');

-- AlterEnum: add document_added to ActivityAction
-- PostgreSQL requires ALTER TYPE ... ADD VALUE to run outside a transaction.
-- Prisma wraps migrations in transactions by default.
-- This statement is safe to run without a transaction; Prisma will apply it
-- directly. If running manually, do NOT wrap this in BEGIN/COMMIT.
ALTER TYPE "ActivityAction" ADD VALUE 'document_added';

-- CreateTable
CREATE TABLE "issue_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "DocumentKind" NOT NULL DEFAULT 'note',
    "title" VARCHAR(200) NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "issue_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,

    CONSTRAINT "issue_documents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issue_documents_issue_id_created_at_idx" ON "issue_documents"("issue_id", "created_at");

-- AddForeignKey
ALTER TABLE "issue_documents" ADD CONSTRAINT "issue_documents_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_documents" ADD CONSTRAINT "issue_documents_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
