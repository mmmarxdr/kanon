-- CreateEnum
CREATE TYPE "ProjectAccess" AS ENUM ('workspace', 'assigned');

-- AlterTable: members default assigned (preserves KAN-16 for existing rows)
ALTER TABLE "members" ADD COLUMN "project_access" "ProjectAccess" NOT NULL DEFAULT 'assigned';

-- AlterTable: invites default workspace (new product semantics for empty assignments)
ALTER TABLE "workspace_invites" ADD COLUMN "project_access" "ProjectAccess" NOT NULL DEFAULT 'workspace';

-- Existing invites that already carry project assignments are assigned-scope
UPDATE "workspace_invites"
SET "project_access" = 'assigned'
WHERE "project_assignments" IS NOT NULL
  AND "project_assignments"::text NOT IN ('null', '[]');
