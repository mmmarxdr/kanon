/**
 * skills.test.ts — Win E, G, H (env-gated)
 *
 * Set KANON_SKILL_DIR to the skills root directory to run these tests.
 * Example: KANON_SKILL_DIR=$HOME/.claude/skills pnpm --filter @kanon/mcp test
 *
 * CI skips these tests (KANON_SKILL_DIR not set).
 * Developer/release runs set the env var to validate skill edits.
 *
 * ADR-3: env-gating chosen over absolute paths (non-portable) or vendoring
 * (drift risk). See design §4.3.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import { SKILL_BASELINE_BYTES } from "./tools/__tests__/baseline.fixture.js";

const SKILL_DIR = process.env["KANON_SKILL_DIR"];

describe.skipIf(!SKILL_DIR)("kanon skills byte budget and quality (Win E/G/H)", () => {
  function readSkill(name: string): string {
    return readFileSync(join(SKILL_DIR!, name, "SKILL.md"), "utf8");
  }

  function byteLength(s: string): number {
    return Buffer.byteLength(s, "utf8");
  }

  // ─── Win E — byte reduction ──────────────────────────────────────────────

  it("E1: aggregate byte count of 3 skill files ≤ SKILL_BASELINE_BYTES − 800", () => {
    const mcpBytes = byteLength(readSkill("kanon-mcp"));
    const createBytes = byteLength(readSkill("kanon-create-issue"));
    const roadmapBytes = byteLength(readSkill("kanon-roadmap"));
    const total = mcpBytes + createBytes + roadmapBytes;
    const ceiling = SKILL_BASELINE_BYTES - 800;
    expect(total).toBeLessThanOrEqual(ceiling);
  });

  it("E2: no >100-char paragraph appears verbatim in ≥2 of the 3 skill files", () => {
    const files = ["kanon-mcp", "kanon-create-issue", "kanon-roadmap"].map(readSkill);
    // Split each file on blank lines to get paragraphs
    const paragraphSets = files.map((content) =>
      new Set(
        content
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter((p) => p.length > 100),
      ),
    );

    const duplicates: string[] = [];
    for (const para of paragraphSets[0]!) {
      if (paragraphSets[1]!.has(para) || paragraphSets[2]!.has(para)) {
        duplicates.push(para.slice(0, 80) + "...");
      }
    }
    for (const para of paragraphSets[1]!) {
      if (paragraphSets[2]!.has(para)) {
        duplicates.push(para.slice(0, 80) + "...");
      }
    }

    if (duplicates.length > 0) {
      expect.fail(
        `Found ${duplicates.length} verbatim duplicate paragraph(s) across skill files:\n` +
        duplicates.map((d, i) => `  [${i + 1}] ${d}`).join("\n"),
      );
    }
  });

  // ─── Win G — existence check section ────────────────────────────────────

  it("G1: kanon-mcp/SKILL.md contains '## Cheap existence checks' heading", () => {
    const content = readSkill("kanon-mcp");
    expect(content).toContain("## Cheap existence checks");
  });

  it("G2: Cheap existence checks section documents limit:3 + format:compact pattern", () => {
    const content = readSkill("kanon-mcp");
    const idx = content.indexOf("## Cheap existence checks");
    expect(idx).toBeGreaterThanOrEqual(0);
    const section = content.slice(idx);
    expect(section).toMatch(/limit.*3/i);
    expect(section).toMatch(/format.*compact/i);
  });

  // ─── Win H — verb-anchored trigger ──────────────────────────────────────

  it("H1: kanon-mcp frontmatter trigger contains verb anchors", () => {
    const content = readSkill("kanon-mcp");
    // Extract frontmatter (between first --- and second ---)
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const fm = fmMatch![1]!;
    expect(fm).toMatch(/list issues/i);
    expect(fm).toMatch(/board management/i);
  });

  it("H2: kanon-mcp frontmatter trigger does NOT match generic PM prose", () => {
    // The trigger is a frontmatter field — this tests its content doesn't contain
    // the problematic broad phrase that would match generic queries.
    // Specifically: the trigger should NOT be just a broad description.
    const content = readSkill("kanon-mcp");
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const fm = fmMatch![1]!;
    // The trigger value should not contain generic PM prose without action verbs
    // Validate by checking it doesn't match the broad description pattern
    // (the old description was a broad phrase; the new trigger must be verb-anchored)
    const triggerMatch = fm.match(/trigger\s*:\s*(.+)/);
    if (triggerMatch) {
      const triggerValue = triggerMatch[1]!;
      // Generic planning prose without kanon-specific verb should not be the trigger
      expect(triggerValue).not.toMatch(/^plan.*quarter/i);
    }
  });
});
