-- CreateEnum
CREATE TYPE "CredentialAuthStatus" AS ENUM ('unknown', 'valid', 'invalid', 'revoked');

-- AlterTable
ALTER TABLE "member_integration_credentials"
    ADD COLUMN "last_validated_at" TIMESTAMP(3),
    ADD COLUMN "last_auth_status" "CredentialAuthStatus" NOT NULL DEFAULT 'unknown',
    ADD COLUMN "revoked_at" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "integration_external_identities" (
    "id" UUID NOT NULL,
    "remote_user_id" TEXT NOT NULL,
    "remote_login" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "binding_id" UUID NOT NULL,
    "member_id" UUID NOT NULL,

    CONSTRAINT "integration_external_identities_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "integration_external_identities_binding_id_member_id_key"
    ON "integration_external_identities"("binding_id", "member_id");
CREATE UNIQUE INDEX "integration_external_identities_binding_id_remote_user_id_key"
    ON "integration_external_identities"("binding_id", "remote_user_id");

-- AddForeignKey
ALTER TABLE "integration_external_identities"
    ADD CONSTRAINT "integration_external_identities_binding_id_fkey"
    FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_external_identities"
    ADD CONSTRAINT "integration_external_identities_member_id_fkey"
    FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
