import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installSkills, removeSkills } from "../skills.js";

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
    for (const skillName of ["kanon-mcp", "kanon-init", "kanon-create-issue", "kanon-roadmap"]) {
      const skillDir = path.join(skillsDir, skillName);
      fs.mkdirSync(skillDir, { recursive: true });
      fs.writeFileSync(path.join(skillDir, "SKILL.md"), `# ${skillName}\nSkill content`);
    }
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("installSkills", () => {
    it("should create correct directory structure and copy skill files", () => {
      const installed = installSkills(skillDest, assetsDir);

      expect(installed).toEqual(["kanon-mcp", "kanon-init", "kanon-create-issue", "kanon-roadmap"]);

      for (const skillName of installed) {
        const skillFile = path.join(skillDest, skillName, "SKILL.md");
        expect(fs.existsSync(skillFile)).toBe(true);
        expect(fs.readFileSync(skillFile, "utf8")).toContain(`# ${skillName}`);
      }
    });

    it("should be idempotent — installing over existing skills works", () => {
      installSkills(skillDest, assetsDir);
      const installed = installSkills(skillDest, assetsDir);

      expect(installed).toEqual(["kanon-mcp", "kanon-init", "kanon-create-issue", "kanon-roadmap"]);

      // Verify files are still correct
      for (const skillName of installed) {
        const skillFile = path.join(skillDest, skillName, "SKILL.md");
        expect(fs.existsSync(skillFile)).toBe(true);
      }
    });

    it("should return empty array when assets/skills directory does not exist", () => {
      const emptyAssets = path.join(tmpDir, "empty-assets");
      const installed = installSkills(skillDest, emptyAssets);
      expect(installed).toEqual([]);
    });

    it("should skip skills that are not in the source directory", () => {
      // Remove one skill from assets
      fs.rmSync(path.join(assetsDir, "skills", "kanon-roadmap"), { recursive: true });

      const installed = installSkills(skillDest, assetsDir);
      expect(installed).toEqual(["kanon-mcp", "kanon-init", "kanon-create-issue"]);
      expect(fs.existsSync(path.join(skillDest, "kanon-roadmap"))).toBe(false);
    });
  });

  describe("removeSkills", () => {
    it("should delete only kanon skill directories", () => {
      // Install kanon skills
      installSkills(skillDest, assetsDir);

      // Add a non-kanon skill
      const otherSkill = path.join(skillDest, "some-other-skill");
      fs.mkdirSync(otherSkill, { recursive: true });
      fs.writeFileSync(path.join(otherSkill, "SKILL.md"), "# other");

      const removed = removeSkills(skillDest);

      expect(removed).toEqual(["kanon-mcp", "kanon-init", "kanon-create-issue", "kanon-roadmap"]);

      // Kanon skills should be gone
      for (const skillName of removed) {
        expect(fs.existsSync(path.join(skillDest, skillName))).toBe(false);
      }

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
