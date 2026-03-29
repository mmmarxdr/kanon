-- CreateEnum
CREATE TYPE "Horizon" AS ENUM ('now', 'next', 'later', 'someday');

-- AlterTable
ALTER TABLE "issues" ADD COLUMN     "roadmap_item_id" UUID;

-- CreateTable
CREATE TABLE "roadmap_items" (
    "id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "horizon" "Horizon" NOT NULL DEFAULT 'someday',
    "effort" INTEGER,
    "impact" INTEGER,
    "labels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "promoted" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "project_id" UUID NOT NULL,

    CONSTRAINT "roadmap_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "roadmap_items_project_id_horizon_idx" ON "roadmap_items"("project_id", "horizon");

-- AddForeignKey
ALTER TABLE "issues" ADD CONSTRAINT "issues_roadmap_item_id_fkey" FOREIGN KEY ("roadmap_item_id") REFERENCES "roadmap_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roadmap_items" ADD CONSTRAINT "roadmap_items_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
