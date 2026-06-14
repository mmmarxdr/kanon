-- CreateEnum
CREATE TYPE "TimeEntryStatus" AS ENUM ('draft', 'submitted', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "time_entries" (
    "id" UUID NOT NULL,
    "member_id" UUID NOT NULL,
    "issue_id" UUID,
    "hours" DECIMAL(8,2) NOT NULL,
    "worked_on" TIMESTAMP(3) NOT NULL,
    "status" "TimeEntryStatus" NOT NULL DEFAULT 'draft',
    "source_work_log_id" UUID,
    "adjusts_id" UUID,
    "cost_rate_snapshot" DECIMAL(12,2),
    "bill_rate_snapshot" DECIMAL(12,2),
    "via" TEXT,
    "approved_by_id" UUID,
    "approved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "time_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex (PARTIAL) — idempotent promotion guard: at most one TimeEntry per WorkLog.
-- NULLs (manual entries) are excluded from the uniqueness constraint so multiple
-- TimeEntry rows without a source WorkLog can coexist freely.
-- Replaces the full UNIQUE Prisma would generate (@unique declared for 1:1 relation typing only).
DROP INDEX IF EXISTS "time_entries_source_work_log_id_key";
CREATE UNIQUE INDEX "time_entries_source_work_log_id_key"
  ON "time_entries"("source_work_log_id")
  WHERE "source_work_log_id" IS NOT NULL;

-- AddConstraint — ppm-engine §8 invariant #3: negative hours only allowed on adjustments.
-- This is a DB-level backstop; the service layer also enforces this guard.
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_hours_sign"
  CHECK ("hours" >= 0 OR "adjusts_id" IS NOT NULL);

-- CreateIndex
CREATE INDEX "time_entries_member_id_worked_on_idx" ON "time_entries"("member_id", "worked_on");

-- CreateIndex
CREATE INDEX "time_entries_issue_id_status_idx" ON "time_entries"("issue_id", "status");

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_source_work_log_id_fkey" FOREIGN KEY ("source_work_log_id") REFERENCES "work_logs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_adjusts_id_fkey" FOREIGN KEY ("adjusts_id") REFERENCES "time_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "time_entries" ADD CONSTRAINT "time_entries_approved_by_id_fkey" FOREIGN KEY ("approved_by_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
