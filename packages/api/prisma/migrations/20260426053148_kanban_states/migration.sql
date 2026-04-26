-- Migrate IssueState enum from SDD pipeline to classic kanban.
--
-- Mapping (per product decision 2026-04-25):
--   backlog       -> backlog
--   explore       -> todo
--   propose       -> todo
--   design        -> in_progress
--   spec          -> in_progress
--   tasks         -> in_progress
--   apply         -> in_progress
--   verify        -> review
--   archived      -> done
--
-- Strategy: drop the column default, rename old enum, create new enum,
-- alter the column with a USING clause that maps every legacy value,
-- restore the default, and drop the legacy enum.

-- 1) Drop existing default so we can change the column type.
ALTER TABLE "issues" ALTER COLUMN "state" DROP DEFAULT;

-- 2) Rename old enum out of the way.
ALTER TYPE "IssueState" RENAME TO "IssueState_old";

-- 3) Create the new enum.
CREATE TYPE "IssueState" AS ENUM ('backlog', 'todo', 'in_progress', 'review', 'done');

-- 4) Alter the column to use the new enum, mapping legacy values via CASE.
ALTER TABLE "issues"
  ALTER COLUMN "state" TYPE "IssueState"
  USING (
    CASE "state"::text
      WHEN 'backlog'  THEN 'backlog'
      WHEN 'explore'  THEN 'todo'
      WHEN 'propose'  THEN 'todo'
      WHEN 'design'   THEN 'in_progress'
      WHEN 'spec'     THEN 'in_progress'
      WHEN 'tasks'    THEN 'in_progress'
      WHEN 'apply'    THEN 'in_progress'
      WHEN 'verify'   THEN 'review'
      WHEN 'archived' THEN 'done'
      ELSE 'backlog'
    END
  )::"IssueState";

-- 5) Restore the default.
ALTER TABLE "issues" ALTER COLUMN "state" SET DEFAULT 'backlog';

-- 6) Drop the legacy enum.
DROP TYPE "IssueState_old";
