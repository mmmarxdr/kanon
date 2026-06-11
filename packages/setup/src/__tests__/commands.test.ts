import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installCommands, removeCommands } from "../commands.js";

describe("commands", () => {
  let tmpDir: string;
  let assetsDir: string;
  let commandDest: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-commands-test-"));
    assetsDir = path.join(tmpDir, "assets");
    commandDest = path.join(tmpDir, "command-dest");

    // Create mock command assets
    const commandsDir = path.join(assetsDir, "commands");
    fs.mkdirSync(commandsDir, { recursive: true });

    for (const name of ["kanon-agent", "kanon-init", "kanon-onboard"]) {
      fs.writeFileSync(
        path.join(commandsDir, `${name}.md`),
        `---\nname: ${name}\ndescription: ${name} command\n---\n\nBody for ${name}.`,
      );
    }

    // A non-kanon file that must NOT be touched
    fs.writeFileSync(path.join(commandsDir, "other-command.md"), "# other");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ─── installCommands ─────────────────────────────────────────────────────

  describe("installCommands", () => {
    it("creates the destination directory if it does not exist", () => {
      expect(fs.existsSync(commandDest)).toBe(false);
      installCommands(commandDest, assetsDir);
      expect(fs.existsSync(commandDest)).toBe(true);
    });

    it("copies all kanon-*.md files into the destination", () => {
      installCommands(commandDest, assetsDir);

      for (const name of ["kanon-agent", "kanon-init", "kanon-onboard"]) {
        expect(fs.existsSync(path.join(commandDest, `${name}.md`))).toBe(true);
      }
    });

    it("returns the list of installed filenames", () => {
      const installed = installCommands(commandDest, assetsDir);

      expect(installed).toHaveLength(3);
      expect(installed).toContain("kanon-agent.md");
      expect(installed).toContain("kanon-init.md");
      expect(installed).toContain("kanon-onboard.md");
    });

    it("does NOT copy non-kanon-*.md files", () => {
      installCommands(commandDest, assetsDir);

      expect(fs.existsSync(path.join(commandDest, "other-command.md"))).toBe(false);
    });

    it("is idempotent — re-install over existing files works and returns same list", () => {
      installCommands(commandDest, assetsDir);
      const installed = installCommands(commandDest, assetsDir);

      expect(installed).toHaveLength(3);
      for (const name of ["kanon-agent", "kanon-init", "kanon-onboard"]) {
        expect(fs.existsSync(path.join(commandDest, `${name}.md`))).toBe(true);
      }
    });

    it("preserves file content on copy", () => {
      installCommands(commandDest, assetsDir);

      const content = fs.readFileSync(
        path.join(commandDest, "kanon-agent.md"),
        "utf8",
      );
      expect(content).toContain("name: kanon-agent");
    });

    it("returns empty array when assets/commands directory does not exist", () => {
      const emptyAssets = path.join(tmpDir, "empty-assets");
      const installed = installCommands(commandDest, emptyAssets);
      expect(installed).toEqual([]);
    });

    it("removes stale kanon-*.md files not present in source on re-install", () => {
      // Pre-populate dest with a stale kanon file not in source
      fs.mkdirSync(commandDest, { recursive: true });
      fs.writeFileSync(path.join(commandDest, "kanon-old.md"), "stale");

      installCommands(commandDest, assetsDir);

      expect(fs.existsSync(path.join(commandDest, "kanon-old.md"))).toBe(false);
    });
  });

  // ─── removeCommands ──────────────────────────────────────────────────────

  describe("removeCommands", () => {
    it("removes all kanon-*.md files from the destination", () => {
      installCommands(commandDest, assetsDir);
      removeCommands(commandDest);

      for (const name of ["kanon-agent", "kanon-init", "kanon-onboard"]) {
        expect(fs.existsSync(path.join(commandDest, `${name}.md`))).toBe(false);
      }
    });

    it("returns the list of removed filenames", () => {
      installCommands(commandDest, assetsDir);
      const removed = removeCommands(commandDest);

      expect(removed).toHaveLength(3);
      expect(removed).toContain("kanon-agent.md");
      expect(removed).toContain("kanon-init.md");
      expect(removed).toContain("kanon-onboard.md");
    });

    it("does NOT remove non-kanon-*.md files", () => {
      // Put a non-kanon file in dest
      fs.mkdirSync(commandDest, { recursive: true });
      const otherFile = path.join(commandDest, "other-command.md");
      fs.writeFileSync(otherFile, "# other");

      installCommands(commandDest, assetsDir);
      removeCommands(commandDest);

      expect(fs.existsSync(otherFile)).toBe(true);
    });

    it("returns empty array when destination does not exist", () => {
      const removed = removeCommands(commandDest);
      expect(removed).toEqual([]);
    });

    it("returns empty array when no kanon-*.md files are present", () => {
      fs.mkdirSync(commandDest, { recursive: true });
      const removed = removeCommands(commandDest);
      expect(removed).toEqual([]);
    });
  });
});
