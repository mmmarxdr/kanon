-- Migration: KAN-53 — Atomic issue-key counter (per-project sequence)
-- Additive only — no data is destroyed or rewritten.

-- 1. Add last_sequence_num counter column to projects (default 0)
ALTER TABLE "projects" ADD COLUMN "last_sequence_num" INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill: set counter to MAX(sequence_num) of existing issues per project.
--    New projects stay at 0. Done BEFORE any traffic uses the counter.
UPDATE "projects" p
SET "last_sequence_num" = COALESCE(
  (SELECT MAX(i.sequence_num) FROM "issues" i WHERE i.project_id = p.id),
  0
);

-- 3. Add compound unique backstop on (project_id, sequence_num).
--    Safe: global key unique already prevents per-project duplicates, so
--    existing data is clean and index creation will not fail.
CREATE UNIQUE INDEX "issues_project_id_sequence_num_key"
  ON "issues" ("project_id", "sequence_num");
