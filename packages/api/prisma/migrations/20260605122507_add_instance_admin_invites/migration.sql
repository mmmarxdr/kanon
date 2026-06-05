-- CreateTable
CREATE TABLE "instance_admin_invites" (
    "id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "jwt_sub" TEXT NOT NULL,
    "consumed_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_by_id" UUID NOT NULL,

    CONSTRAINT "instance_admin_invites_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "instance_admin_invites_token_key" ON "instance_admin_invites"("token");

-- CreateIndex
CREATE UNIQUE INDEX "instance_admin_invites_jwt_sub_key" ON "instance_admin_invites"("jwt_sub");

-- CreateIndex
CREATE INDEX "instance_admin_invites_jwt_sub_idx" ON "instance_admin_invites"("jwt_sub");

-- AddForeignKey
ALTER TABLE "instance_admin_invites" ADD CONSTRAINT "instance_admin_invites_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
