-- KAN-101 PR2: Milestones + MilestoneDeliverables
-- Adds MilestoneStatus enum, milestones table, and milestone_deliverables join table.

-- ── 1. MilestoneStatus enum ──────────────────────────────────────────────────
CREATE TYPE "MilestoneStatus" AS ENUM ('upcoming', 'at_risk', 'met', 'missed');

-- ── 2. milestones table ───────────────────────────────────────────────────────
CREATE TABLE "milestones" (
    "id"         UUID        NOT NULL DEFAULT gen_random_uuid(),
    "name"       TEXT        NOT NULL,
    "target"     TIMESTAMPTZ NOT NULL,
    "status"     "MilestoneStatus" NOT NULL DEFAULT 'upcoming',
    "met_on"     TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
    "project_id" UUID        NOT NULL,
    "owner_id"   UUID        NOT NULL,

    CONSTRAINT "milestones_pkey" PRIMARY KEY ("id")
);

-- FK: milestones.project_id → projects.id (CASCADE delete)
ALTER TABLE "milestones"
    ADD CONSTRAINT "milestones_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: milestones.owner_id → members.id (RESTRICT delete — cannot delete a member who owns a milestone)
ALTER TABLE "milestones"
    ADD CONSTRAINT "milestones_owner_id_fkey"
    FOREIGN KEY ("owner_id") REFERENCES "members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Index for efficient project-scoped list queries
CREATE INDEX "milestones_project_id_idx" ON "milestones"("project_id");

-- ── 3. milestone_deliverables join table ──────────────────────────────────────
CREATE TABLE "milestone_deliverables" (
    "id"           UUID        NOT NULL DEFAULT gen_random_uuid(),
    "created_at"   TIMESTAMPTZ NOT NULL DEFAULT now(),
    "milestone_id" UUID        NOT NULL,
    "issue_id"     UUID        NOT NULL,

    CONSTRAINT "milestone_deliverables_pkey" PRIMARY KEY ("id")
);

-- FK: milestone_deliverables.milestone_id → milestones.id (CASCADE delete)
ALTER TABLE "milestone_deliverables"
    ADD CONSTRAINT "milestone_deliverables_milestone_id_fkey"
    FOREIGN KEY ("milestone_id") REFERENCES "milestones"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- FK: milestone_deliverables.issue_id → issues.id (CASCADE delete)
ALTER TABLE "milestone_deliverables"
    ADD CONSTRAINT "milestone_deliverables_issue_id_fkey"
    FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Unique constraint: one deliverable row per (milestone, issue) pair
ALTER TABLE "milestone_deliverables"
    ADD CONSTRAINT "milestone_deliverables_milestone_id_issue_id_key"
    UNIQUE ("milestone_id", "issue_id");

-- Index for efficient issue-scoped queries (e.g. "which milestones is this issue attached to?")
CREATE INDEX "milestone_deliverables_issue_id_idx" ON "milestone_deliverables"("issue_id");
