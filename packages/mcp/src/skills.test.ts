/**
 * skills.test.ts — Win E, G, H (env-gated)
 *
 * Set KANON_SKILL_DIR to the skills root directory to run these tests.
 * Example (from repo root):
 *   KANON_SKILL_DIR=$(pwd)/packages/setup/assets/skills pnpm --filter @kanon/mcp test -- --run
 *
 * CI skips these tests (KANON_SKILL_DIR not set).
 * Developer/release runs set the env var to validate skill edits.
 *
 * ADR-3/5: env-gating chosen over absolute paths (non-portable) or vendoring
 * (drift risk). Retargeted to kanon-agent in PR2.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import { SKILL_BASELINE_BYTES } from "./tools/__tests__/baseline.fixture.js";

const SKILL_DIR = process.env["KANON_SKILL_DIR"];

describe.skipIf(!SKILL_DIR)("kanon skills byte budget and quality (Win E/G/H)", () => {
  function readCore(): string {
    return readFileSync(join(SKILL_DIR!, "kanon-agent", "SKILL.md"), "utf8");
  }

  function readSection(name: string): string {
    return readFileSync(join(SKILL_DIR!, "kanon-agent", "sections", name), "utf8");
  }

  function allSectionNames(): string[] {
    return readdirSync(join(SKILL_DIR!, "kanon-agent", "sections")).filter((f) =>
      f.endsWith(".md"),
    );
  }

  function byteLength(s: string): number {
    return Buffer.byteLength(s, "utf8");
  }

  // ─── Win E — byte ceiling and aggregate anti-regrowth ──────────────────

  it("E1: kanon-agent SKILL.md byte size ≤ 2,048 bytes", () => {
    const core = readCore();
    expect(byteLength(core)).toBeLessThanOrEqual(2048);
  });

  it("E2: no >100-char paragraph appears verbatim in both core and any section file", () => {
    const coreContent = readCore();
    const sectionContents = allSectionNames().map((name) => readSection(name));

    // Extract paragraphs (split on blank lines)
    const paragraphs = (content: string): Set<string> =>
      new Set(
        content
          .split(/\n\s*\n/)
          .map((p) => p.trim())
          .filter((p) => p.length > 100),
      );

    const coreParagraphs = paragraphs(coreContent);
    const duplicates: string[] = [];

    for (const sectionContent of sectionContents) {
      const sectionParagraphs = paragraphs(sectionContent);
      for (const para of coreParagraphs) {
        if (sectionParagraphs.has(para)) {
          duplicates.push(para.slice(0, 80) + "...");
        }
      }
    }

    if (duplicates.length > 0) {
      expect.fail(
        `Found ${duplicates.length} verbatim duplicate paragraph(s) between core and section files:\n` +
          duplicates.map((d, i) => `  [${i + 1}] ${d}`).join("\n"),
      );
    }
  });

  it("E3: aggregate byte count (core + all sections) ≤ SKILL_BASELINE_BYTES", () => {
    const core = readCore();
    const sections = allSectionNames().map((name) => readSection(name));
    const total = [core, ...sections].reduce((sum, s) => sum + byteLength(s), 0);
    expect(total).toBeLessThanOrEqual(SKILL_BASELINE_BYTES);
  });

  // ─── Win G — existence check section in issue-creation.md ───────────────

  it("G1: sections/issue-creation.md contains '## Cheap existence checks' heading", () => {
    const content = readSection("issue-creation.md");
    expect(content).toContain("## Cheap existence checks");
  });

  it("G2: Cheap existence checks section documents limit:3 + format:compact pattern", () => {
    const content = readSection("issue-creation.md");
    const idx = content.indexOf("## Cheap existence checks");
    expect(idx).toBeGreaterThanOrEqual(0);
    const section = content.slice(idx);
    expect(section).toMatch(/limit.*3/i);
    expect(section).toMatch(/format.*compact/i);
  });

  // ─── Win H — verb-anchored trigger in kanon-agent frontmatter ───────────

  it("H1: kanon-agent frontmatter trigger contains verb anchors", () => {
    const content = readCore();
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const fm = fmMatch![1]!;
    expect(fm).toMatch(/list issues/i);
    expect(fm).toMatch(/create issue/i);
  });

  it("H2: kanon-agent frontmatter trigger does NOT match generic PM prose", () => {
    // Spec H scenario: evaluating the trigger against generic PM prose
    // "let's plan the next quarter deliverables" must NOT match any trigger keyword.
    const content = readCore();
    const fmMatch = content.match(/^---\n([\s\S]*?)\n---/);
    expect(fmMatch).not.toBeNull();
    const fm = fmMatch![1]!;
    const triggerMatch = fm.match(/trigger\s*:\s*(.+)/);
    expect(triggerMatch).not.toBeNull();
    const triggerValue = triggerMatch![1]!;
    const keywords = triggerValue
      .split(",")
      .map((k) => k.trim().toLowerCase())
      .filter(Boolean);
    expect(keywords.length).toBeGreaterThanOrEqual(3); // sanity: must be a list
    const genericProse = "let's plan the next quarter deliverables";
    const matchedKeywords = keywords.filter((kw) => genericProse.includes(kw));
    expect(matchedKeywords).toHaveLength(0);
  });
});

// ─── PR-4b Firing Pins — ADR authoring guidance in kanon-agent ────────────────

describe.skipIf(!SKILL_DIR)("PR-4b firing pins — Design Records ADR criteria (L3)", () => {
  function readCore(): string {
    return readFileSync(join(SKILL_DIR!, "kanon-agent", "SKILL.md"), "utf8");
  }

  it("L3a: SKILL.md contains 'Design Records' section heading", () => {
    expect(readCore()).toMatch(/##\s+Design Records/i);
  });

  it("L3b: SKILL.md contains propose-before-creating guidance", () => {
    expect(readCore()).toMatch(/[Pp]ropose before creating/);
  });

  it("L3c: SKILL.md contains ADR template marker '## Alternatives Considered'", () => {
    expect(readCore()).toContain("Alternatives Considered");
  });

  it("L3d: SKILL.md contains anti-trigger guidance (routine fixes or work logs excluded)", () => {
    const content = readCore();
    // Must contain a negative guidance line
    expect(content).toMatch(/[Ss]kip|[Dd]o NOT|[Dd]on't|[Rr]outine/);
  });

  it("L3e: SKILL.md contains ADR template with Context and Decision markers", () => {
    const content = readCore();
    expect(content).toContain("## Context");
    expect(content).toContain("## Decision");
  });
});
