/**
 * descriptions.test.ts  — E1 + E2 + Phase-2 (Win C, Win F)
 *
 * E1: Captures the baseline byte count of all tool descriptions at the time
 *     this test was written (5393 bytes across 29 tools).
 *     Updated for KAN-23 (2026-05-01): +1 tool kanon_delete_cycle → 30 tools.
 *     New baseline: 5730 (5393 + ~337 pre-trim estimate for kanon_delete_cycle).
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
 * Updated for KAN-23 (Batch G, 2026-05-01): +1 tool kanon_delete_cycle added.
 * New baseline = 5730 (5393 + ~337 pre-trim estimate for the new tool).
 */
// Updated for KAN-104 (2026-06-16): +7 timesheet tools → 38 tools. New baseline: 6455.
// Updated for KAN-119 (2026-06-16): +1 kanon_list_members tool → 39 tools. New baseline: 6622 (6455 + ~167 pre-trim estimate).
// Updated for KAN-120 (2026-06-16): +1 kanon_comment_issue tool → 40 tools. New baseline: 6784 (6622 + 162 measured).
const BASELINE_BYTES = 6784;

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

describe("tool descriptions — trim ≥ 30% (Batch E)", () => {
  it("E1: parses 40 tools (39 pre-KAN-120 + 1 kanon_comment_issue added in KAN-120); BASELINE_BYTES is 6784", () => {
    const tools = collectDescriptions();
    // Verify the parser finds exactly 40 tools (was 39 before KAN-120 added
    // kanon_comment_issue).
    expect(tools).toHaveLength(40);
    // BASELINE_BYTES is the historical pre-trim value — used only as the
    // threshold denominator in E2. We don't assert the current total equals it
    // (E3 trimmed descriptions are in the same files the parser reads).
    expect(BASELINE_BYTES).toBe(6784);
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

  it("C2: kanon_create_issue — groups lookup firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "kanon_create_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/kanon_list_groups.*groupKey/i);
  });

  it("C3: kanon_create_issue — imperative verb firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "kanon_create_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/imperative verb|starts with a verb/i);
  });

  it("C4: kanon_update_issue — read-first firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "kanon_update_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/read first/i);
  });

  it("C5: kanon_update_issue — append don't overwrite firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "kanon_update_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/append.*don.t overwrite|don.t overwrite/i);
  });

  it("C6: kanon_delete_cycle — active refused 409 firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "kanon_delete_cycle");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/active.*refused|409/i);
  });

  it("C8: kanon_close_cycle — disposition firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "kanon_close_cycle");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/disposition/i);
  });

  it("C9: kanon_create_cycle — demote firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "kanon_create_cycle");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/demot/i);
  });

  it("C10: kanon_create_issue — [Area] title pattern firing pin", () => {
    const tools = collectDescriptions();
    const t = tools.find((t) => t.toolName === "kanon_create_issue");
    expect(t).toBeDefined();
    expect(t!.description).toMatch(/\[Area\].*[Vv]erb|\[Area\]/);
  });
});
