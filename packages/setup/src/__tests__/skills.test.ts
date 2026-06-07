import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSkills, removeSkills, PRODUCT_SKILLS, RETIRED_SKILLS } from "../skills.js";

describe("skills", () => {
  let tmpDir: string;
  let assetsDir: string;
  let skillDest: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-skills-test-"));
    assetsDir = path.join(tmpDir, "assets");
    skillDest = path.join(tmpDir, "skill-dest");

    // Create mock skills in the assets directory
    const skillsDir = path.join(assetsDir, "skills");

    // kanon-agent: has a sections/ subdirectory
    const agentDir = path.join(skillsDir, "kanon-agent");
    fs.mkdirSync(path.join(agentDir, "sections"), { recursive: true });
    fs.writeFileSync(path.join(agentDir, "SKILL.md"), "# kanon-agent\nCore skill");
    fs.writeFileSync(path.join(agentDir, "sections", "issue-creation.md"), "# Issue Creation\nContent");

    // kanon-init and kanon-onboard: flat (no subdirectories)
    for (const skillName of ["kanon-init", "kanon-onboard"]) {
      const skillDir = path.join(skillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${skillName}\nSkill content`);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── PRODUCT_SKILLS and RETIRED_SKILLS exports ───────────────────────────

  it("PRODUCT_SKILLS contains exactly kanon-agent, kanon-init, kanon-onboard", () => {
    expect(PRODUCT_SKILLS).toEqual(["kanon-agent", "kanon-init", "kanon-onboard"]);
  });

  it("RETIRED_SKILLS contains all 5 retired skill names", () => {
    expect(RETIRED_SKILLS).toEqual([
      "kanon-mcp",
      "kanon-create-issue",
      "kanon-roadmap",
      "kanon-cycle",
      "kanon-orchestrator-hooks",
    ]);
  });

  // ─── installSkills ───────────────────────────────────────────────────────

  describe("installSkills", () => {
    it("should copy kanon-agent SKILL.md to destination", () => {
      const installed = installSkills(skillDest, assetsDir);

      expect(installed).toContain("kanon-agent");
      expect(fs.existsSync(path.join(skillDest, "kanon-agent", "SKILL.md"))).toBe(true);
    });

    it("should recursively copy sections/ subdirectory for kanon-agent", () => {
      installSkills(skillDest, assetsDir);

      const sectionFile = path.join(skillDest, "kanon-agent", "sections", "issue-creation.md");
      expect(fs.existsSync(sectionFile)).toBe(true);
      expect(fs.readFileSync(sectionFile, "utf8")).toContain("Issue Creation");
    });

    it("should install all 3 product skills", () => {
      const installed = installSkills(skillDest, assetsDir);

      expect(installed).toEqual(["kanon-agent", "kanon-init", "kanon-onboard"]);
      for (const skillName of installed) {
        expect(fs.existsSync(path.join(skillDest, skillName, "SKILL.md"))).toBe(true);
      }
    });

    it("should be idempotent — installing over existing skills works", () => {
      installSkills(skillDest, assetsDir);
      const installed = installSkills(skillDest, assetsDir);

      expect(installed).toEqual(["kanon-agent", "kanon-init", "kanon-onboard"]);
      for (const skillName of installed) {
        expect(fs.existsSync(path.join(skillDest, skillName, "SKILL.md"))).toBe(true);
      }
    });

    it("should return empty array when assets/skills directory does not exist", () => {
      const emptyAssets = path.join(tmpDir, "empty-assets");
      const installed = installSkills(skillDest, emptyAssets);
      expect(installed).toEqual([]);
    });

    it("should skip skills that are not in the source directory", () => {
      // Remove kanon-onboard from assets
      fs.rmSync(path.join(assetsDir, "skills", "kanon-onboard"), { recursive: true });

      const installed = installSkills(skillDest, assetsDir);
      expect(installed).toEqual(["kanon-agent", "kanon-init"]);
      expect(fs.existsSync(path.join(skillDest, "kanon-onboard"))).toBe(false);
    });

    // ─── RETIRED_SKILLS removal on fresh install ────────────────────────────

    it("should not produce retired skill dirs on a fresh install", () => {
      installSkills(skillDest, assetsDir);

      for (const retired of RETIRED_SKILLS) {
        expect(fs.existsSync(path.join(skillDest, retired))).toBe(false);
      }
    });

    it("should remove all 5 retired skill dirs when upgrading from old install", () => {
      // Simulate an old install: pre-populate all 5 retired dirs in dest
      for (const retired of RETIRED_SKILLS) {
        const dir = path.join(skillDest, retired);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "SKILL.md"), `# ${retired}`);
      }

      installSkills(skillDest, assetsDir);

      for (const retired of RETIRED_SKILLS) {
        expect(fs.existsSync(path.join(skillDest, retired))).toBe(false);
      }
      // kanon-agent should be present
      expect(fs.existsSync(path.join(skillDest, "kanon-agent", "SKILL.md"))).toBe(true);
    });

    it("should be idempotent when called on an already-clean dest (no retired dirs)", () => {
      installSkills(skillDest, assetsDir);
      // Second call should not throw even though retired dirs are already absent
      expect(() => installSkills(skillDest, assetsDir)).not.toThrow();
      // Product skills still present
      expect(fs.existsSync(path.join(skillDest, "kanon-agent", "SKILL.md"))).toBe(true);
    });
  });

  // ─── removeSkills ────────────────────────────────────────────────────────

  describe("removeSkills", () => {
    it("should delete product skill directories", () => {
      installSkills(skillDest, assetsDir);
      const removed = removeSkills(skillDest);

      expect(removed).toContain("kanon-agent");
      expect(fs.existsSync(path.join(skillDest, "kanon-agent"))).toBe(false);
    });

    it("should cover both PRODUCT_SKILLS and RETIRED_SKILLS", () => {
      // Pre-populate both product and retired dirs in dest
      for (const skillName of [...PRODUCT_SKILLS, ...RETIRED_SKILLS]) {
        const dir = path.join(skillDest, skillName);
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(path.join(dir, "SKILL.md"), `# ${skillName}`);
      }

      const removed = removeSkills(skillDest);

      // All product and retired dirs should be listed as removed
      for (const name of [...PRODUCT_SKILLS, ...RETIRED_SKILLS]) {
        expect(removed).toContain(name);
        expect(fs.existsSync(path.join(skillDest, name))).toBe(false);
      }
    });

    it("should not remove non-kanon skill directories", () => {
      installSkills(skillDest, assetsDir);

      // Add a non-kanon skill
      const otherSkill = path.join(skillDest, "some-other-skill");
      fs.mkdirSync(otherSkill, { recursive: true });
      fs.writeFileSync(path.join(otherSkill, "SKILL.md"), "# other");

      removeSkills(skillDest);

      // Other skill should remain
      expect(fs.existsSync(otherSkill)).toBe(true);
    });

    it("should return empty array when no kanon skills are installed", () => {
      fs.mkdirSync(skillDest, { recursive: true });
      const removed = removeSkills(skillDest);
      expect(removed).toEqual([]);
    });
  });
});
