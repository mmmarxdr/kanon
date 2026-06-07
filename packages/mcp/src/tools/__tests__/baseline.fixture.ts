/**
 * baseline.fixture.ts — kanon-agent baseline capture (PR2)
 *
 * SKILL_BASELINE_BYTES: aggregate byte count of the kanon-agent skill files.
 *   Files: kanon-agent/SKILL.md + sections/issue-creation.md +
 *          sections/roadmap.md + sections/cycle.md + sections/sdd-hooks.md
 *   Measured via: node -e "..."  (Buffer.byteLength, utf8)
 *
 *   PR2 landing (2026-06-07):
 *     SKILL.md: 1569 B, issue-creation: 1171 B, roadmap: 1144 B,
 *     cycle: 1029 B, sdd-hooks: 1303 B  → total: 6216 B
 *
 *   PR-4b (Design Records tab + kanon-agent L3, 2026-06-07):
 *     Added ## Design Records section to SKILL.md (ADR criteria + template).
 *     Compressed On-Demand Sections table to offset growth.
 *     SKILL.md: 2012 B (+443 B net), all sections unchanged.
 *     New total: 6659 B. Ceiling re-anchored to 6659 B.
 *
 * DESCRIPTION_BASELINE_BYTES: sum of topline description string bytes across
 *   all 30 registered tools as parsed by parseAllToolDescriptions().
 *   NOTE: this captures TOPLINE strings only (second arg to server.tool()),
 *   not zod .describe() calls in types.ts. Consistent with existing E2 test
 *   infrastructure. Measured BEFORE any Phase 2 description trims.
 *   Measured via manual byte count of all 30 topline strings (2026-05-22).
 *   Surface is now 33 tools (PR-4a added kanon_create_document,
 *   kanon_list_documents, kanon_get_document); DESCRIPTION_BASELINE_BYTES
 *   remains the 30-tool baseline constant — ~32 B remaining margin
 *   (3,677 B actual vs 3,709 B ceiling; baseline constant unchanged).
 *
 * These constants are READ-ONLY — do NOT modify after initial capture.
 * Downstream tests assert reductions relative to these values.
 */

/** Aggregate byte count of kanon-agent SKILL.md + all 4 section files.
 *  Re-anchored at PR-4b: 6659 B (added ## Design Records section to SKILL.md). */
export const SKILL_BASELINE_BYTES = 6659;

/**
 * Sum of topline description bytes across all 30 MCP tools before Phase 2 trims.
 * Parser: parseAllToolDescriptions() — topline strings only.
 */
export const DESCRIPTION_BASELINE_BYTES = 4009;
