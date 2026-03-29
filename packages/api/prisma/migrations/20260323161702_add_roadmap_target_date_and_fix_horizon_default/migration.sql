-- AlterTable
ALTER TABLE "roadmap_items" ADD COLUMN     "target_date" TIMESTAMP(3),
ALTER COLUMN "horizon" SET DEFAULT 'later';
