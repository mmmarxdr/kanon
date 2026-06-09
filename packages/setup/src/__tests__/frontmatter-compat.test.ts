import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseSkillFrontmatter } from "../utils/frontmatter.js";

/**
 * OpenCode-compat frontmatter test for all shipped skill assets.
 *
 * The test walks the three product skill directories AND every section file
 * under kanon-agent/sections, parses the YAML frontmatter of each, and asserts
 * the contract from spec kanon-agent-skill (delta):
 *
 *   - MUST parse as YAML
 *   - MUST contain keys `name` and `description`
 *   - MUST NOT contain the Claude-Code-specific key `allowed-tools`
 *   - Keys MUST be a subset of the OpenCode-compatible base keys
 *
 * If a future PR re-introduces `allowed-tools` or any other disallowed key,
 * this test must fail the build (pnpm --filter @kanon-pm/setup test).
 */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const SETUP_ROOT = path.resolve(__dirname, "..", "..");
const SKILLS_ROOT = path.join(SETUP_ROOT, "assets", "skills");

const PRODUCT_SKILLS = ["kanon-agent", "kanon-init", "kanon-onboard"] as const;
const REQUIRED_FRONTMATTER_FILES = [
  "kanon-agent/SKILL.md",
  "kanon-agent/sections/cycle.md",
  "kanon-agent/sections/issue-creation.md",
  "kanon-agent/sections/roadmap.md",
  "kanon-agent/sections/sdd-hooks.md",
  "kanon-init/SKILL.md",
  "kanon-onboard/SKILL.md",
] as const;

// OpenCode-compatible frontmatter base keys. From the spec delta, the allowed
// set is a strict subset of these. Anything outside is considered a Claude-
// Code-ism and must be flagged by this test.
const OPENCODE_ALLOWED_KEYS = new Set([
  "name",
  "description",
  "version",
  "tags",
  "trigger",
  "license",
  "metadata",
  "disable-model-invocation",
  "user-invocable",
]);

interface CollectedFile {
  relPath: string;          // e.g. "kanon-agent/SKILL.md"
  absPath: string;
}

function collectSkillFiles(): CollectedFile[] {
  const files: CollectedFile[] = [];

  for (const skill of PRODUCT_SKILLS) {
    const skillDir = path.join(SKILLS_ROOT, skill);
    const skillFile = path.join(skillDir, "SKILL.md");
    if (!fs.existsSync(skillFile)) {
      throw new Error(`Expected shipped skill missing: ${skillFile}`);
    }
    files.push({
      relPath: `${skill}/SKILL.md`,
      absPath: skillFile,
    });
  }

  const sectionsDir = path.join(SKILLS_ROOT, "kanon-agent", "sections");
  if (!fs.existsSync(sectionsDir)) {
    throw new Error(`Expected sections directory missing: ${sectionsDir}`);
  }
  for (const entry of fs.readdirSync(sectionsDir).sort()) {
    if (!entry.endsWith(".md")) continue;
    const abs = path.join(sectionsDir, entry);
    if (!fs.statSync(abs).isFile()) continue;
    files.push({
      relPath: `kanon-agent/sections/${entry}`,
      absPath: abs,
    });
  }

  return files;
}

describe("frontmatter-compat (OpenCode)", () => {
  const files = collectSkillFiles();

  it("discovers required shipped skill + section markdown files", () => {
    const relPaths = files.map((f) => f.relPath).sort();
    expect(relPaths).toEqual(expect.arrayContaining([...REQUIRED_FRONTMATTER_FILES]));
  });

  for (const file of files) {
    describe(file.relPath, () => {
      const raw = fs.readFileSync(file.absPath, "utf8");
      const parsed = parseSkillFrontmatter(raw);

      it("frontmatter parses as YAML (object form)", () => {
        expect(parsed).toBeTypeOf("object");
        expect(parsed).not.toBeNull();
        expect(Array.isArray(parsed)).toBe(false);
      });

      it("frontmatter contains `name` and `description` keys", () => {
        expect(parsed["name"]).toBeTypeOf("string");
        expect((parsed["name"] as string).length).toBeGreaterThan(0);
        expect(parsed["description"]).toBeTypeOf("string");
        expect((parsed["description"] as string).length).toBeGreaterThan(0);
      });

      it("frontmatter MUST NOT contain the Claude-Code `allowed-tools` key", () => {
        expect(Object.keys(parsed)).not.toContain("allowed-tools");
        expect(parsed["allowed-tools"]).toBeUndefined();
      });

      it("all frontmatter keys are a subset of OpenCode-compatible base keys", () => {
        const keys = Object.keys(parsed);
        const disallowed = keys.filter((k) => !OPENCODE_ALLOWED_KEYS.has(k));
        expect(disallowed).toEqual([]);
      });
    });
  }
});
