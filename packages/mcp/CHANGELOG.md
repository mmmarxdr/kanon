# Changelog — @kanon/mcp

## v0.4.0 (2026-05-22)

Always-on overhead reduction — Phase 2 of MCP token optimization.

### Win B — Deferred admin tool declarations
Added `server.instructions` block following the engram MCP convention.
Five admin/rare tools (`kanon_create_project`, `kanon_update_project`,
`kanon_delete_cycle`, `kanon_delete_roadmap_item`, `kanon_who_is_working`)
are declared in a `DEFERRED TOOLS` section so MCP hosts can hide them
behind ToolSearch rather than surfacing them in every turn's context.
All 30 tools remain eagerly registered; hosts that ignore `instructions`
lose nothing.

### Win C — Tool description surgical trim
Trimmed topline description strings across all tool files. Removed
verbose parameter lists where the Zod schema already documents fields.
Preserved all 8 firing-pin clauses (group lookup, imperative verb,
read-first, append-don't-overwrite, active-cycle-409, directly-relevant,
disposition, demote). Reduction: 4009 → 3464 bytes (−545 bytes, −13.6%).

### Win E — Skill duplicate paragraph elimination
Removed verbatim-duplicate title format rules, type/priority inference
tables, and group-lookup paragraphs from `kanon-create-issue/SKILL.md`
and `kanon-roadmap/SKILL.md`. Canonical rules remain in `kanon-mcp/SKILL.md`
with cross-reference lines. Aggregate reduction: 23924 → 21432 bytes
(−2492 bytes across 3 files, requirement was ≥800).

### Win F — Default `limit` reduced to 10
`LimitParam.default(20)` → `.default(10)` in `types.ts`. `DEFAULT_LIMIT`
in `transforms.ts` updated to match. Description nudge clause added:
"Pass limit explicitly for bulk listings." Callers supplying explicit
`limit` are unaffected; no existing test asserted `limit === 20`.

### Win G — Cheap existence checks pattern documented
Added `## Cheap existence checks` section to `kanon-mcp/SKILL.md` after
Best Practices. Documents `limit: 3, format: 'compact'` pattern for
existence-only lookups to minimize token cost.

### Win H — Verb-anchored kanon-mcp trigger
Rewrote `kanon-mcp/SKILL.md` frontmatter trigger from a broad description
to a verb-anchored list: "list issues, update issue, start work, transition
issue, pick up work, board management". Prevents generic PM prose from
incorrectly triggering the skill.

---

## v0.3.0 (2026-05-01)

Per-call payload reduction — Phase 1 of MCP token optimization.
- `ack` response tier: write tools return minimal `{ok, id, key}` by default
- `keys[]` filter on `kanon_list_issues` for targeted multi-issue fetch
- Added `kanon_delete_cycle` (hard-delete with active-cycle guard)
- Description trim pass: 5393 → 3772 bytes (−30.1% across 29→30 tools)
