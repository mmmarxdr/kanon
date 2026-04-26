-- CreateEnum
CREATE TYPE "IssueDependencyType" AS ENUM ('blocks');

-- CreateTable
CREATE TABLE "issue_dependencies" (
    "id" UUID NOT NULL,
    "type" "IssueDependencyType" NOT NULL DEFAULT 'blocks',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,

    CONSTRAINT "issue_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "issue_dependencies_source_id_idx" ON "issue_dependencies"("source_id");

-- CreateIndex
CREATE INDEX "issue_dependencies_target_id_idx" ON "issue_dependencies"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "issue_dependencies_source_id_target_id_type_key" ON "issue_dependencies"("source_id", "target_id", "type");

-- AddForeignKey
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "issue_dependencies" ADD CONSTRAINT "issue_dependencies_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
