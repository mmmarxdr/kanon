-- CreateEnum
CREATE TYPE "DependencyType" AS ENUM ('blocks');

-- CreateTable
CREATE TABLE "roadmap_dependencies" (
    "id" UUID NOT NULL,
    "type" "DependencyType" NOT NULL DEFAULT 'blocks',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source_id" UUID NOT NULL,
    "target_id" UUID NOT NULL,

    CONSTRAINT "roadmap_dependencies_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roadmap_dependencies_target_id_idx" ON "roadmap_dependencies"("target_id");

-- CreateIndex
CREATE UNIQUE INDEX "roadmap_dependencies_source_id_target_id_key" ON "roadmap_dependencies"("source_id", "target_id");

-- AddForeignKey
ALTER TABLE "roadmap_dependencies" ADD CONSTRAINT "roadmap_dependencies_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "roadmap_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_dependencies" ADD CONSTRAINT "roadmap_dependencies_target_id_fkey" FOREIGN KEY ("target_id") REFERENCES "roadmap_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
