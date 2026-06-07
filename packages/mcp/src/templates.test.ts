import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Canonical source — packages/setup/assets/templates/ is derived from here at prebuild.
const TEMPLATES_DIR = path.resolve(__dirname, "../templates");

const TEMPLATE_FILES = [
  "claude-code-snippet.md",
  "cursor-rules.mdc",
  "gemini-instructions.md",
];

// Skills retired by the kanon-agent consolidation (KAN-15 / PR #52).
// Templates must never route users to them again (KAN-17).
const RETIRED_REFERENCES = [
  "kanon-orchestrator-hooks",
  "kanon-roadmap",
  "kanon-cycle",
];

const read = (name: string) =>
  fs.readFileSync(path.join(TEMPLATES_DIR, name), "utf8");

describe("router templates content (KAN-17)", () => {
  it("T1: every template file exists", () => {
    for (const name of TEMPLATE_FILES) {
      expect(fs.existsSync(path.join(TEMPLATES_DIR, name))).toBe(true);
    }
  });

  it("T2: no template references a retired skill", () => {
    for (const name of TEMPLATE_FILES) {
      const content = read(name);
      for (const retired of RETIRED_REFERENCES) {
        expect(content, `${name} references retired skill ${retired}`).not.toContain(retired);
      }
    }
  });

  it("T3: kanon-create-issue only appears as a /workflow reference, never as a skill", () => {
    for (const name of TEMPLATE_FILES) {
      const content = read(name);
      // Allow "/kanon-create-issue" (Antigravity workflow command); forbid bare skill mentions.
      expect(content, `${name} references retired skill kanon-create-issue`).not.toMatch(
        /(?<!\/)kanon-create-issue/,
      );
    }
  });

  it("T4: skill-routing templates point to kanon-agent", () => {
    for (const name of ["claude-code-snippet.md", "gemini-instructions.md"]) {
      expect(read(name), `${name} must route to kanon-agent`).toContain("kanon-agent");
    }
  });

  it("T5: marker lines stay intact for idempotent re-install", () => {
    for (const name of ["claude-code-snippet.md", "gemini-instructions.md"]) {
      const content = read(name);
      expect(content).toContain("<!-- kanon-mcp-start -->");
      expect(content).toContain("<!-- kanon-mcp-end -->");
    }
  });
});
