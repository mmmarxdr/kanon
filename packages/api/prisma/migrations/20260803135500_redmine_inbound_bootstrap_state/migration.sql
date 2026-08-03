-- CreateEnum
CREATE TYPE "IntegrationBootstrapState" AS ENUM ('not_required', 'pending', 'previewed', 'bootstrapping', 'converging', 'ready', 'failed');

-- DropForeignKey
ALTER TABLE "integration_external_identities" DROP CONSTRAINT "integration_external_identities_member_id_fkey";

-- AlterTable
ALTER TABLE "integration_project_bindings" ADD COLUMN     "audit_completed_at" TIMESTAMP(3),
ADD COLUMN     "audit_cursor_remote_id" TEXT,
ADD COLUMN     "bootstrap_cutoff" TIMESTAMP(3),
ADD COLUMN     "bootstrap_fence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "bootstrap_lease_token" TEXT,
ADD COLUMN     "bootstrap_lease_until" TIMESTAMP(3),
ADD COLUMN     "bootstrap_page_token" JSONB,
ADD COLUMN     "bootstrap_state" "IntegrationBootstrapState" NOT NULL DEFAULT 'not_required',
ADD COLUMN     "inbound_enabled" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "integration_external_identities" ADD COLUMN     "remote_display_name" TEXT,
ALTER COLUMN "member_id" DROP NOT NULL;

-- AlterTable
ALTER TABLE "integration_inbound_applications" ADD COLUMN     "remote_parent_id" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "remote_parent_type" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "source_version" TEXT;

-- ReplaceIndex
CREATE UNIQUE INDEX "uq_inbound_application_remote_timestamp" ON "integration_inbound_applications"("binding_id", "remote_entity_type", "remote_parent_type", "remote_parent_id", "remote_id", "remote_updated_at");
DROP INDEX "integration_inbound_applications_binding_id_remote_entity_t_key";

-- CreateIndex
CREATE INDEX "integration_project_bindings_bootstrap_state_bootstrap_leas_idx" ON "integration_project_bindings"("bootstrap_state", "bootstrap_lease_until");

-- CreateIndex
CREATE UNIQUE INDEX "uq_inbound_application_source" ON "integration_inbound_applications"("binding_id", "remote_entity_type", "remote_parent_type", "remote_parent_id", "remote_id", "source_version");

-- AddForeignKey
ALTER TABLE "integration_external_identities" ADD CONSTRAINT "integration_external_identities_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE SET NULL ON UPDATE CASCADE;
