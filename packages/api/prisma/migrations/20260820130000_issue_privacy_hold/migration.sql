-- KAN-246: quarantine is deliberately outside Prisma's normal model graph.
ALTER TABLE "issues"
  ADD COLUMN "privacy_held_at" TIMESTAMP(3),
  ADD COLUMN "privacy_hold_generation" INTEGER NOT NULL DEFAULT 0;
CREATE INDEX "issues_privacy_held_at_idx" ON "issues"("privacy_held_at") WHERE "privacy_held_at" IS NOT NULL;
CREATE TYPE "IntegrationContentOrigin" AS ENUM ('kanon', 'redmine', 'unknown');
CREATE TABLE "integration_content_provenance" (
  "id" UUID NOT NULL,
  "entity_type" TEXT NOT NULL,
  "entity_id" UUID NOT NULL,
  "field" TEXT NOT NULL,
  "origin" "IntegrationContentOrigin" NOT NULL DEFAULT 'unknown',
  "source_version" TEXT,
  "content_hash" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  "binding_id" UUID NOT NULL,
  CONSTRAINT "integration_content_provenance_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "integration_content_provenance_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE CASCADE
);
CREATE UNIQUE INDEX "integration_content_provenance_binding_id_entity_type_entity_id_field_key" ON "integration_content_provenance"("binding_id", "entity_type", "entity_id", "field");
CREATE INDEX "integration_content_provenance_entity_type_entity_id_idx" ON "integration_content_provenance"("entity_type", "entity_id");
CREATE SCHEMA "privacy_quarantine";
REVOKE ALL ON SCHEMA "privacy_quarantine" FROM PUBLIC;
CREATE TABLE "privacy_quarantine"."issue_content" (
  "issue_id" UUID NOT NULL,
  "binding_id" UUID NOT NULL,
  "generation" INTEGER NOT NULL,
  "snapshot_schema" INTEGER NOT NULL DEFAULT 1,
  "envelope" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "issue_content_pkey" PRIMARY KEY ("issue_id", "binding_id", "generation"),
  CONSTRAINT "issue_content_generation_check" CHECK ("generation" >= 0),
  CONSTRAINT "issue_content_issue_id_fkey" FOREIGN KEY ("issue_id") REFERENCES "issues"("id") ON DELETE RESTRICT,
  CONSTRAINT "issue_content_binding_id_fkey" FOREIGN KEY ("binding_id") REFERENCES "integration_project_bindings"("id") ON DELETE RESTRICT
);
REVOKE ALL ON TABLE "privacy_quarantine"."issue_content" FROM PUBLIC;
