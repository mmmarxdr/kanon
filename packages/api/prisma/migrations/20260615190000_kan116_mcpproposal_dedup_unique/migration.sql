-- KAN-116: partial UNIQUE index — at most one PENDING GENERIC proposal per target_ref.
--
-- The forecast rebuild dedups McpProposals via findMany({target_ref:{in}}) → Set →
-- createMany(skipDuplicates). That read-then-write is correct for single-instance v1
-- (the per-project debounce serializes rebuilds) but races across MULTIPLE app
-- instances: two could both pass the dedup read and both insert. This index makes the
-- guarantee atomic at the DB level; createMany's skipDuplicates then cooperates with it.
--
-- Scope is intentionally narrow (mirrors time_entries_source_work_log_id_key):
--   * (workspace_id, target_ref) — dedup is TENANT-LOCAL. Project keys (hence the
--     issue keys used as target_ref) are unique only per-workspace (Project
--     @@unique([workspaceId, key])) and the route's target_ref is free-form, so a
--     global key on target_ref alone would raise false cross-workspace conflicts.
--   * WHERE kind = 'generic'  — only forecast-style generic proposals are deduped;
--     other kinds (promote_roadmap_item, add_dependency, …) are unconstrained.
--   * WHERE status = 'pending' — once applied/dismissed a row leaves the index, so a
--     fresh proposal for the same target_ref can be raised later.
--   * target_ref IS NULL rows are excluded automatically (NULLs are distinct in a
--     unique index), so workspace-level / refless proposals can coexist freely.
--
-- Partial indexes aren't expressible in the Prisma schema, so this is raw SQL.
CREATE UNIQUE INDEX "mcp_proposals_pending_generic_target_ref_key"
  ON "mcp_proposals"("workspace_id", "target_ref")
  WHERE "status" = 'pending' AND "kind" = 'generic';
