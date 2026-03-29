-- CreateEnum
CREATE TYPE "RoadmapStatus" AS ENUM ('idea', 'planned', 'in_progress', 'done');

-- AlterTable
ALTER TABLE "roadmap_items" ADD COLUMN "status" "RoadmapStatus" NOT NULL DEFAULT 'idea';

-- Backfill: compute status from existing data
-- Non-promoted items stay as 'idea' (the default)

-- Promoted items with NO linked issues → 'planned'
UPDATE "roadmap_items" SET "status" = 'planned'
WHERE "promoted" = true
  AND NOT EXISTS (
    SELECT 1 FROM "issues" WHERE "issues"."roadmap_item_id" = "roadmap_items"."id"
  );

-- Promoted items with ALL linked issues archived → 'done'
UPDATE "roadmap_items" SET "status" = 'done'
WHERE "promoted" = true
  AND EXISTS (
    SELECT 1 FROM "issues" WHERE "issues"."roadmap_item_id" = "roadmap_items"."id"
  )
  AND NOT EXISTS (
    SELECT 1 FROM "issues"
    WHERE "issues"."roadmap_item_id" = "roadmap_items"."id"
      AND "issues"."state" != 'archived'
  );

-- Promoted items with ANY non-archived linked issue → 'in_progress'
UPDATE "roadmap_items" SET "status" = 'in_progress'
WHERE "promoted" = true
  AND EXISTS (
    SELECT 1 FROM "issues"
    WHERE "issues"."roadmap_item_id" = "roadmap_items"."id"
      AND "issues"."state" != 'archived'
  );
