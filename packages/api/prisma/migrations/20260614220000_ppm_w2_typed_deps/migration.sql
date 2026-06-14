-- PPM W2 PR1: extend IssueDependencyType enum + lagDays column
--
-- IssueDependencyType consumers: issue_dependencies.type (single column, no others).
-- Strategy: rename→create→USING (identity map)→drop per 20260614184722_ppm_w1_pr1_enums.
-- New values FS, SS, FF, SF appended; existing 'blocks' rows unaffected.
-- 'blocks' default is dropped before the swap and restored after.
--
-- lagDays: added as INTEGER NOT NULL DEFAULT 0 with a CHECK constraint.

-- ─── IssueDependencyType += FS SS FF SF ─────────────────────────────────────

-- 1) Drop the 'blocks' default before renaming the enum
ALTER TABLE "issue_dependencies" ALTER COLUMN "type" DROP DEFAULT;

-- 2) Rename old enum out of the way
ALTER TYPE "IssueDependencyType" RENAME TO "IssueDependencyType_old";

-- 3) Create new enum with all 5 values
CREATE TYPE "IssueDependencyType" AS ENUM ('blocks', 'FS', 'SS', 'FF', 'SF');

-- 4) Alter the single consumer column with USING identity map
ALTER TABLE "issue_dependencies"
  ALTER COLUMN "type" TYPE "IssueDependencyType"
  USING ("type"::text::"IssueDependencyType");

-- 5) Restore the 'blocks' default
ALTER TABLE "issue_dependencies" ALTER COLUMN "type" SET DEFAULT 'blocks';

-- 6) Drop the old enum
DROP TYPE "IssueDependencyType_old";

-- ─── lagDays column ──────────────────────────────────────────────────────────

-- 7) Add lag_days column with default 0 and a non-negative CHECK constraint
ALTER TABLE "issue_dependencies"
  ADD COLUMN "lag_days" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "issue_dependencies"
  ADD CONSTRAINT "issue_dependencies_lag_days_check" CHECK ("lag_days" >= 0);
