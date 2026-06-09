-- Migration: KAN-35 — Add Issue.completedAt and Cycle.closedAt
-- Additive only — no data is destroyed or rewritten.

-- Add completed_at to issues (nullable, no default — new issues start NULL)
ALTER TABLE "issues" ADD COLUMN "completed_at" TIMESTAMP(3);

-- Add closed_at to cycles (nullable, no default — historical cycles stay NULL per spec)
ALTER TABLE "cycles" ADD COLUMN "closed_at" TIMESTAMP(3);

-- Backfill completed_at for issues already in `done` state.
-- Matches BOTH activity-log shapes written by isDoneTransition / readStateChange:
--   {to:'done'}        — current convention (KAN-41)
--   {newValue:'done'}  — legacy convention (pre-KAN-41)
-- Takes the MAX(created_at) of all qualifying logs per issue so repeated
-- done→reopen→done cycles resolve to the most recent completion.
-- Done issues with no qualifying log remain NULL (un-backfillable by design).
UPDATE "issues"
SET "completed_at" = sub.max_created_at
FROM (
  SELECT
    al.issue_id,
    MAX(al.created_at) AS max_created_at
  FROM "activity_logs" al
  WHERE
    al.action = 'state_changed'
    AND (
      al.details->>'to' = 'done'
      OR al.details->>'newValue' = 'done'
    )
  GROUP BY al.issue_id
) sub
WHERE "issues".id = sub.issue_id
  AND "issues".state = 'done';
