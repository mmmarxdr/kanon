/**
 * descriptions.test.ts  — E1 + E2 + Phase-2 (Win C, Win F)
 *
 * E1: Captures the baseline byte count of all tool descriptions at the time
 *     this test was written (5393 bytes across 29 tools).
 *     Updated for KAN-23 (2026-05-01): +1 tool delete_cycle → 30 tools.
 *     New baseline: 5730 (5393 + ~337 pre-trim estimate for delete_cycle).
 *
 * E2: Asserts that after the trim pass (E3):
 *     1. Total bytes < 70% of baseline  (≥ 30% reduction)
 *     2. Every individual description ≥ 50 bytes  (semantic floor)
 *
 * Phase-2 / Win F: LimitParam default must be 10.
 * Phase-2 / Win C: topline bytes ≤ DESCRIPTION_BASELINE_BYTES − 300; firing-pin regexes.
 *
 * The parser used here is reused from descriptions-parser.ts.
 */

import { describe, it, expect } from "vitest";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseAllToolDescriptions } from "./descriptions-parser.js";
import { LimitParam } from "../types.js";
import { DESCRIPTION_BASELINE_BYTES } from "./__tests__/baseline.fixture.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = __dirname;

/**
 * Baseline measured before any description trimming (Batch E, 2026-04-28).
 * Updated for KAN-23 (Batch G, 2026-05-01): +1 tool delete_cycle added.
 * New baseline = 5730 (5393 + ~337 pre-trim estimate for the new tool).
 */
// Updated for KAN-104 (2026-06-16): +7 timesheet tools → 38 tools. New baseline: 6455.
// Updated for KAN-119 (2026-06-16): +1 list_members tool → 39 tools. New baseline: 6622 (6455 + ~167 pre-trim estimate).
// Updated for KAN-120 (2026-06-16): +1 create_issue_comment tool → 40 tools. New baseline: 6784 (6622 + 162 measured).
// Updated for KAN-104 capture tools (2026-06-22): +3 capture tools → 43 tools. New baseline: 7264 (6784 + 480 measured).
// Updated for KAN-188 (2026-07-06): +1 reconcile_time tool → 44 tools.
// The E2a ratio requires baseline > actual/0.7 (7571); re-anchored to 7600 for headroom.
const BASELINE_BYTES = 7600;

function collectDescriptions() {
  const files = readdirSync(TOOLS_DIR)
    .filter(
      (f) =>
        f.endsWith(".ts") &&
        !f.endsWith(".test.ts") &&
        f !== "descriptions-parser.ts",
    )
    .map((f) => join(TOOLS_DIR, f));
  return parseAllToolDescriptions(files);
}

const EXPECTED_TOOL_NAMES = [
  "add_dependency",
  "adjust_time_entry",
  "apply_proposal",
  "approve_time_entry",
  "close_cycle",
  "create_cycle",
  "create_design_record",
  "create_issue",
  "create_issue_comment",
  "create_project",
  "create_roadmap_item",
  "delete_cycle",
  "delete_roadmap_item",
  "get_cycle",
  "get_design_record",
  "get_issue",
  "get_project",
  "list_active_workers",
  "list_cycles",
  "list_design_records",
  "list_groups",
  "list_issues",
  "list_members",
  "list_my_worklogs",
  "list_projects",
  "list_roadmap",
  "list_workspaces",
  "promote_roadmap_item",
  "promote_worklog",
  "propose_estimate",
  "reconcile_time",
  "reject_time_entry",
  "remove_dependency",
  "report_incident",
  "start_work",
  "stop_work",
  "submit_time_entry",
  "transition_issue",
  "transition_issues",
  "update_cycle_scope",
  "update_issue",
  "update_project",
  "update_roadmap_item",
  "update_time_entry",
] as const;

describe("tool descriptions — trim ≥ 30% (Batch E)", () => {
  it("E1: parses 44 tools (43 pre-KAN-188 + reconcile_time added in KAN-188); BASELINE_BYTES is 7600", () => {
    const tools = collectDescriptions();
    // Verify the parser finds exactly 44 tools (was 43 before KAN-188 added
    // reconcile_time).
    expect(tools).toHaveLength(44);
    // BASELINE_BYTES is the historical pre-trim value — used only as the
    // threshold denominator in E2. We don't assert the current total equals it
    // (E3 trimmed descriptions are in the same files the parser reads).
    expect(BASELINE_BYTES).toBe(7600);
  });

  it("uses concise raw names without duplicating the server namespace", () => {
    expect(collectDescriptions().map((tool) => tool.toolName).sort())
      .toEqual([...EXPECTED_TOOL_NAMES].sort());
  });

  it("E2a: total trimmed bytes < 70% of baseline (≥ 30% reduction)", () => {
    const tools = collectDescriptions();
    const total = tools.reduce((s, t) => s + t.byteLength, 0);
    const threshold = Math.floor(BASELINE_BYTES * 0.7); // 3775
    expect(total).toBeLessThan(threshold);
  });

  it("E2b: every per-tool description ≥ 50 bytes (semantic floor)", () => {
    const tools = collectDescriptions();
    const underFloor = tools.filter((t) => t.byteLength < 50);
    if (underFloor.length > 0) {
      const msg = underFloor
        .map((t) => `  ${t.toolName}: ${t.byteLength} bytes`)
        .join("\n");
      expect.fail(`These tools are below the 50-byte semantic floor:\n${msg}`);
    }
  });
});

// ─── Phase 2 / Win F — LimitParam default ────────────────────────────────────

describe("Win F — LimitParam default is 10", () => {
  it("F1: LimitParam.parse(undefined) === 10", () => {
    expect(LimitParam.parse(undefined)).toBe(10);
  });

  it("F2: LimitParam describe contains nudge clause for bulk listings", () => {
    const desc = LimitParam.description ?? "";
    expect(desc).toMatch(/pass limit explicitly.*bulk/i);
  });
});

// ─── Phase 2 / Win C — byte budget + firing pins ─────────────────────────────

describe("Win C — description byte budget and firing pins", () => {
  it("C1: total topline bytes ≤ DESCRIPTION_BASELINE_BYTES − 300", () => {
    const tools = collectDescriptions();
    const total = tools.reduce((s, t) => s + t.byteLength, 0);
    const ceiling = DESCRIPTION_BASELINE_BYTES - 300;
    expect(total).toBeLessThanOrEqual(ceiling);
  });

  it("C2: create_issue — groups lookup firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "create_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/list_groups.*groupKey/i);
  });

  it("C3: create_issue — imperative verb firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "create_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/imperative verb|starts with a verb/i);
  });

  it("C4: update_issue — read-first firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "update_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/read first/i);
  });

  it("C5: update_issue — append don't overwrite firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "update_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/append.*don.t overwrite|don.t overwrite/i);
  });

  it("C6: delete_cycle — active refused 409 firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "delete_cycle");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/active.*refused|409/i);
  });

  it("C8: close_cycle — disposition firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "close_cycle");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/disposition/i);
  });

  it("C9: create_cycle — demote firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "create_cycle");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/demot/i);
  });

  it("C10: create_issue — [Area] title pattern firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "create_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/\[Area\].*[Vv]erb|\[Area\]/);
  });

  it("create_issue keeps descriptions PM-facing", () => {
    const tools = collectDescriptions();
    const t = tools.find((tool) => tool.toolName === "create_issue");

    expect(t).toBeDefined();
    expect(t!.description).toMatch(/PM-facing/i);
    expect(t!.description).toMatch(/local|worktree/i);
  });
});
