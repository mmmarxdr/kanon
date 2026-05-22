/**
 * baseline.fixture.ts — Phase 2 baseline capture (Task 1.1)
 *
 * SKILL_BASELINE_BYTES: aggregate byte count of the three kanon skill files
 *   measured BEFORE any Phase 2 edits (2026-05-22).
 *   Files: kanon-mcp/SKILL.md + kanon-create-issue/SKILL.md + kanon-roadmap/SKILL.md
 *   Measured via: wc -c ~/.claude/skills/kanon-{mcp,create-issue,roadmap}/SKILL.md
 *
 * DESCRIPTION_BASELINE_BYTES: sum of topline description string bytes across
 *   all 30 registered tools as parsed by parseAllToolDescriptions().
 *   NOTE: this captures TOPLINE strings only (second arg to server.tool()),
 *   not zod .describe() calls in types.ts. Consistent with existing E2 test
 *   infrastructure. Measured BEFORE any Phase 2 description trims.
 *   Measured via manual byte count of all 30 topline strings (2026-05-22).
 *
 * These constants are READ-ONLY — do NOT modify after initial capture.
 * Downstream tests assert reductions relative to these values.
 */

/** Aggregate byte count of all three kanon skill SKILL.md files before Phase 2 edits. */
export const SKILL_BASELINE_BYTES = 23924;

/**
 * Sum of topline description bytes across all 30 MCP tools before Phase 2 trims.
 * Parser: parseAllToolDescriptions() — topline strings only.
 */
export const DESCRIPTION_BASELINE_BYTES = 4009;
