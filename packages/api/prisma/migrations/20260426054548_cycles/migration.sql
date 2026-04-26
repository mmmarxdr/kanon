-- Replace Sprint with Cycle + add CycleScopeEvent + Issue.estimate.
-- Sprint table is dropped destructively (no production data per product
-- decision: still in early development, breaking changes accepted).

-- 1) Update ActivityAction enum: rename sprint_changed -> cycle_changed.
ALTER TYPE "ActivityAction" RENAME VALUE 'sprint_changed' TO 'cycle_changed';

-- 2) Drop sprint relation on issues, then drop the sprints table + enum.
ALTER TABLE "issues" DROP COLUMN IF EXISTS "sprint_id";
DROP TABLE IF EXISTS "sprints" CASCADE;
DROP TYPE IF EXISTS "SprintStatus";

-- 3) New enums for Cycle.
CREATE TYPE "CycleState" AS ENUM ('upcoming', 'active', 'done');
CREATE TYPE "CycleScopeEventKind" AS ENUM ('add', 'remove');

-- 4) cycles table.
CREATE TABLE "cycles" (
  "id"         UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       TEXT         NOT NULL,
  "goal"       TEXT,
  "state"      "CycleState" NOT NULL DEFAULT 'upcoming',
  "start_date" TIMESTAMP(3) NOT NULL,
  "end_date"   TIMESTAMP(3) NOT NULL,
  "velocity"   INTEGER,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "project_id" UUID         NOT NULL,

  CONSTRAINT "cycles_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE
);
CREATE INDEX "cycles_project_id_state_idx"      ON "cycles"("project_id", "state");
CREATE INDEX "cycles_project_id_start_date_idx" ON "cycles"("project_id", "start_date");

-- 5) cycle_scope_events table.
CREATE TABLE "cycle_scope_events" (
  "id"         UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
  "day"        INTEGER               NOT NULL,
  "kind"       "CycleScopeEventKind" NOT NULL,
  "issue_key"  TEXT                  NOT NULL,
  "reason"     TEXT,
  "created_at" TIMESTAMP(3)          NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "cycle_id"   UUID                  NOT NULL,
  "author_id"  UUID,

  CONSTRAINT "cycle_scope_events_cycle_id_fkey"
    FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE CASCADE,
  CONSTRAINT "cycle_scope_events_author_id_fkey"
    FOREIGN KEY ("author_id") REFERENCES "members"("id") ON DELETE SET NULL
);
CREATE INDEX "cycle_scope_events_cycle_id_day_idx"
  ON "cycle_scope_events"("cycle_id", "day");

-- 6) Issue: add estimate + cycle_id.
ALTER TABLE "issues" ADD COLUMN "estimate" INTEGER;
ALTER TABLE "issues" ADD COLUMN "cycle_id" UUID;
ALTER TABLE "issues"
  ADD CONSTRAINT "issues_cycle_id_fkey"
  FOREIGN KEY ("cycle_id") REFERENCES "cycles"("id") ON DELETE SET NULL;
CREATE INDEX "issues_cycle_id_idx" ON "issues"("cycle_id");
