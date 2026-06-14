/*
  PR2b — dueDate deprecation (KAN-99).

  ORDER IS CRITICAL:
  1. Backfill existing Issue.due_date rows into issue_schedules BEFORE dropping the column.
     Uses UPSERT so rows with an existing schedule get their due_date updated (no data loss).
  2. Drop the due_date column from issues.

  After this migration Issue.dueDate is GONE. All date concerns live in issue_schedules.
*/

-- Step 1: Backfill — copy every non-NULL due_date into issue_schedules.
-- ON CONFLICT: if a schedule row already exists (created by PR2a schedule endpoint), update
-- its due_date so we don't lose the Issue-level date. Other schedule fields are unchanged.
INSERT INTO "issue_schedules" ("issueId", "due_date", "progress", "created_at", "updated_at")
SELECT
    "id"::uuid,
    "due_date",
    0,
    NOW(),
    NOW()
FROM "issues"
WHERE "due_date" IS NOT NULL
ON CONFLICT ("issueId") DO UPDATE
    SET "due_date" = EXCLUDED."due_date",
        "updated_at" = NOW();

-- Step 2: Drop the column — safe now that data is in issue_schedules.
ALTER TABLE "issues" DROP COLUMN "due_date";
