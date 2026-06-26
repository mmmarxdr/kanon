-- CreateTable
CREATE TABLE "integration_connections" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "base_url" TEXT NOT NULL,
    "service_credential_id" UUID,
    "discovered_statuses" JSONB,
    "status_map_read" JSONB,
    "status_map_write" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "workspace_id" UUID NOT NULL,

    CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "member_integration_credentials" (
    "id" UUID NOT NULL,
    "encrypted_key" TEXT NOT NULL,
    "external_user_id" TEXT,
    "external_login" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "member_id" UUID NOT NULL,
    "connection_id" UUID NOT NULL,

    CONSTRAINT "member_integration_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_refs" (
    "id" UUID NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" UUID NOT NULL,
    "external_id" TEXT NOT NULL,
    "external_url" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "connection_id" UUID NOT NULL,

    CONSTRAINT "external_refs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "integration_connections_workspace_id_idx" ON "integration_connections"("workspace_id");

-- CreateIndex
CREATE UNIQUE INDEX "integration_connections_workspace_id_provider_key" ON "integration_connections"("workspace_id", "provider");

-- CreateIndex
CREATE INDEX "member_integration_credentials_connection_id_idx" ON "member_integration_credentials"("connection_id");

-- CreateIndex
CREATE UNIQUE INDEX "member_integration_credentials_member_id_connection_id_key" ON "member_integration_credentials"("member_id", "connection_id");

-- CreateIndex
CREATE INDEX "external_refs_entity_type_entity_id_idx" ON "external_refs"("entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_refs_connection_id_entity_type_entity_id_key" ON "external_refs"("connection_id", "entity_type", "entity_id");

-- CreateIndex
CREATE UNIQUE INDEX "external_refs_connection_id_entity_type_external_id_key" ON "external_refs"("connection_id", "entity_type", "external_id");

-- AddForeignKey
ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_integration_credentials" ADD CONSTRAINT "member_integration_credentials_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "members"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "member_integration_credentials" ADD CONSTRAINT "member_integration_credentials_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "external_refs" ADD CONSTRAINT "external_refs_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

