/**
 * descriptions.test.ts  — E1 + E2
 *
 * E1: Captures the baseline byte count of all tool descriptions at the time
 *     this test was written (5393 bytes across 29 tools).
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

/** Baseline measured before any description trimming (Batch E, 2026-04-28). */
const BASELINE_BYTES = 5393;

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
  it("E1: parses 29 tools; BASELINE_BYTES is recorded as 5393", () => {
    const tools = collectDescriptions();
    // Verify the parser finds exactly 29 tools (same count as baseline measurement).
    expect(tools).toHaveLength(29);
    // BASELINE_BYTES is the historical pre-trim value — used only as the
    // threshold denominator in E2. We don't assert the current total equals it
    // (E3 trimmed descriptions are in the same files the parser reads).
    expect(BASELINE_BYTES).toBe(5393);
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
