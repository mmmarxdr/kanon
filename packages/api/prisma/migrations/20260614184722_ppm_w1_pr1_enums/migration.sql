-- PPM W1 PR1: add MemberRole.pm and IssueState.analysis
--
-- MemberRole consumers: Member.role, ProjectMember.role (both covered below)
-- IssueState consumers: Issue.state (covered below)
--
-- Strategy: rename→create→USING→drop (precedent: 20260426053148_kanban_states).
-- USING cast is an identity map — no existing value changes.

-- ─── IssueState += analysis ─────────────────────────────────────────────────

-- 1) Drop existing default on Issue.state
ALTER TABLE "issues" ALTER COLUMN "state" DROP DEFAULT;

-- 2) Rename old enum out of the way
ALTER TYPE "IssueState" RENAME TO "IssueState_old";

-- 3) Create the new enum with analysis inserted at index 1
CREATE TYPE "IssueState" AS ENUM ('backlog', 'analysis', 'todo', 'in_progress', 'review', 'done');

-- 4) Alter the column with USING identity map (all existing values are still valid)
ALTER TABLE "issues"
  ALTER COLUMN "state" TYPE "IssueState"
  USING ("state"::text::"IssueState");

-- 5) Restore the default
ALTER TABLE "issues" ALTER COLUMN "state" SET DEFAULT 'backlog';

-- 6) Drop the old enum
DROP TYPE "IssueState_old";

-- ─── MemberRole += pm ───────────────────────────────────────────────────────
-- Both Member.role AND ProjectMember.role use this enum.
-- The USING cast is identity — no existing value changes.

-- 1) Drop defaults on both columns
ALTER TABLE "members" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "project_members" ALTER COLUMN "role" DROP DEFAULT;

-- 2) Rename old enum out of the way
ALTER TYPE "MemberRole" RENAME TO "MemberRole_old";

-- 3) Create the new enum with pm between admin and member
CREATE TYPE "MemberRole" AS ENUM ('owner', 'admin', 'pm', 'member', 'viewer');

-- 4) Alter Member.role with USING identity map
ALTER TABLE "members"
  ALTER COLUMN "role" TYPE "MemberRole"
  USING ("role"::text::"MemberRole");

-- 5) Alter ProjectMember.role with USING identity map
ALTER TABLE "project_members"
  ALTER COLUMN "role" TYPE "MemberRole"
  USING ("role"::text::"MemberRole");

-- 6) Restore defaults
ALTER TABLE "members" ALTER COLUMN "role" SET DEFAULT 'member';
-- ProjectMember has no default in the schema — do not restore one

-- 7) Drop the old enum
DROP TYPE "MemberRole_old";
