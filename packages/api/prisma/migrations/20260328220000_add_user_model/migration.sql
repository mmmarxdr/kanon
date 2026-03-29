-- CreateTable: users
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "display_name" TEXT,
    "avatar_url" TEXT,
    "api_key_hash" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: unique email on users
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- Deduplicate members by email into users table.
-- For members sharing the same email across workspaces, pick the most recently updated one.
INSERT INTO "users" ("id", "email", "password_hash", "display_name", "avatar_url", "api_key_hash", "created_at", "updated_at")
SELECT
    gen_random_uuid(),
    "email",
    "password_hash",
    "display_name",
    "avatar_url",
    "api_key_hash",
    MIN("created_at"),
    MAX("updated_at")
FROM (
    SELECT DISTINCT ON ("email")
        "email",
        "password_hash",
        "display_name",
        "avatar_url",
        "api_key_hash",
        "created_at",
        "updated_at"
    FROM "members"
    ORDER BY "email", "updated_at" DESC
) AS deduped
GROUP BY "email", "password_hash", "display_name", "avatar_url", "api_key_hash";

-- Add nullable user_id column to members
ALTER TABLE "members" ADD COLUMN "user_id" UUID;

-- Backfill user_id from the newly created users table by email match
UPDATE "members" SET "user_id" = "u"."id"
FROM "users" "u"
WHERE "members"."email" = "u"."email";

-- Make user_id NOT NULL now that all rows are backfilled
ALTER TABLE "members" ALTER COLUMN "user_id" SET NOT NULL;

-- Add FK constraint from members.user_id to users.id
ALTER TABLE "members" ADD CONSTRAINT "members_user_id_fkey"
    FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Drop old unique constraint on (workspace_id, email) before dropping email column
DROP INDEX "members_workspace_id_email_key";

-- Drop auth-related columns from members (now on users)
ALTER TABLE "members" DROP COLUMN "email";
ALTER TABLE "members" DROP COLUMN "password_hash";
ALTER TABLE "members" DROP COLUMN "api_key_hash";
ALTER TABLE "members" DROP COLUMN "display_name";
ALTER TABLE "members" DROP COLUMN "avatar_url";

-- Add unique constraint: one user per workspace
CREATE UNIQUE INDEX "members_user_id_workspace_id_key" ON "members"("user_id", "workspace_id");
