-- CreateTable
CREATE TABLE "project_members" (
    "id" UUID NOT NULL,
    "role" "MemberRole" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "user_id" UUID NOT NULL,
    "project_id" UUID NOT NULL,

    CONSTRAINT "project_members_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "project_members_user_id_project_id_key" ON "project_members"("user_id", "project_id");

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_members" ADD CONSTRAINT "project_members_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Backfill: create ProjectMember rows for every workspace member with role
-- 'member' or 'viewer' × every project in their workspace.
-- owner and admin are excluded — they bypass the gate unconditionally (A2).
-- ON CONFLICT DO NOTHING makes this idempotent (safe to re-run).
INSERT INTO project_members (id, user_id, project_id, role, created_at, updated_at)
SELECT gen_random_uuid(), m.user_id, p.id, m.role, now(), now()
FROM members m
JOIN projects p ON p.workspace_id = m.workspace_id
WHERE m.role IN ('member', 'viewer')
ON CONFLICT (user_id, project_id) DO NOTHING;
