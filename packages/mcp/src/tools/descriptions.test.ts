/**
 * descriptions.test.ts  — E1 + E2
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
 * The parser used here is reused from descriptions-parser.ts.
 */

import { describe, it, expect } from "vitest";
import { readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { parseAllToolDescriptions } from "./descriptions-parser.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const TOOLS_DIR = __dirname;

/**
 * Baseline measured before any description trimming (Batch E, 2026-04-28).
 * Updated for KAN-23 (Batch G, 2026-05-01): +1 tool kanon_delete_cycle added.
 * New baseline = 5730 (5393 + ~337 pre-trim estimate for the new tool).
 */
const BASELINE_BYTES = 5730;

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
  it("E1: parses 30 tools (29 original + kanon_delete_cycle); BASELINE_BYTES is 5730", () => {
    const tools = collectDescriptions();
    // Verify the parser finds exactly 30 tools (29 original + kanon_delete_cycle added in KAN-23).
    expect(tools).toHaveLength(30);
    // BASELINE_BYTES is the historical pre-trim value — used only as the
    // threshold denominator in E2. We don't assert the current total equals it
    // (E3 trimmed descriptions are in the same files the parser reads).
    expect(BASELINE_BYTES).toBe(5730);
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
