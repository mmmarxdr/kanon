-- CreateTable
CREATE TABLE "instance_settings" (
    "id" UUID NOT NULL,
    "instance_name" TEXT,
    "signup_mode" TEXT NOT NULL DEFAULT 'open',
    "allowed_signup_domains" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "owner_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "instance_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "setup_tokens" (
    "id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "setup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instance_settings_owner_user_id_key" ON "instance_settings"("owner_user_id");

-- CreateIndex
CREATE UNIQUE INDEX "setup_tokens_token_hash_key" ON "setup_tokens"("token_hash");

-- AddForeignKey
ALTER TABLE "instance_settings" ADD CONSTRAINT "instance_settings_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed singleton InstanceSettings row (KAN-49).
-- ownerUserId intentionally NULL — claimed via POST /api/instance/setup/claim on first boot.
INSERT INTO "instance_settings" ("id", "signup_mode", "allowed_signup_domains", "created_at", "updated_at")
VALUES ('00000000-0000-0000-0000-000000000001', 'open', ARRAY[]::TEXT[], NOW(), NOW())
ON CONFLICT ("id") DO NOTHING;
