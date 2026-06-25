-- KAN-147 (ADR-0007): per-project working-day calendar for the forecast engine.
-- Additive only. Absent row ⇒ Mon–Fri + no holidays (engine default), so
-- existing projects need zero backfill.

-- CreateTable
CREATE TABLE "project_schedule_configs" (
    "project_id" UUID NOT NULL,
    "work_days" INTEGER[] NOT NULL DEFAULT ARRAY[1, 2, 3, 4, 5]::INTEGER[],
    "holidays" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_schedule_configs_pkey" PRIMARY KEY ("project_id")
);

-- AddForeignKey
ALTER TABLE "project_schedule_configs" ADD CONSTRAINT "project_schedule_configs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
