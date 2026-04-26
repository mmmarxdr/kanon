-- CreateEnum
CREATE TYPE "McpProposalKind" AS ENUM ('promote_roadmap_item', 'add_dependency', 'split_issue', 'reassign', 'generic');

-- CreateEnum
CREATE TYPE "McpProposalStatus" AS ENUM ('pending', 'applied', 'dismissed');

-- CreateTable
CREATE TABLE "mcp_proposals" (
    "id" UUID NOT NULL,
    "kind" "McpProposalKind" NOT NULL,
    "status" "McpProposalStatus" NOT NULL DEFAULT 'pending',
    "title" TEXT NOT NULL,
    "reason" TEXT,
    "target_ref" TEXT,
    "payload" JSONB,
    "generated_by" TEXT,
    "proposed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "applied_at" TIMESTAMP(3),
    "dismissed_at" TIMESTAMP(3),
    "workspace_id" UUID NOT NULL,
    "project_id" UUID,

    CONSTRAINT "mcp_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mcp_proposals_workspace_id_status_idx" ON "mcp_proposals"("workspace_id", "status");

-- CreateIndex
CREATE INDEX "mcp_proposals_project_id_status_idx" ON "mcp_proposals"("project_id", "status");

-- AddForeignKey
ALTER TABLE "mcp_proposals" ADD CONSTRAINT "mcp_proposals_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_proposals" ADD CONSTRAINT "mcp_proposals_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
