import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { installTemplate, removeTemplate } from "../templates.js";

describe("templates", () => {
  let tmpDir: string;
  let assetsDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-tpl-test-"));
    assetsDir = path.join(tmpDir, "assets");
    fs.mkdirSync(path.join(assetsDir, "templates"), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("installTemplate — marker-inject mode", () => {
    const snippet = "<!-- kanon-mcp-start -->\n# Kanon Section\nSome content\n<!-- kanon-mcp-end -->";

    beforeEach(() => {
      fs.writeFileSync(path.join(assetsDir, "templates", "test-snippet.md"), snippet);
    });

    it("should inject into an empty (new) file", () => {
      const target = path.join(tmpDir, "CLAUDE.md");

      installTemplate(target, "test-snippet.md", assetsDir, "marker-inject");

      const result = fs.readFileSync(target, "utf8");
      expect(result).toContain("<!-- kanon-mcp-start -->");
      expect(result).toContain("# Kanon Section");
      expect(result).toContain("<!-- kanon-mcp-end -->");
    });

    it("should append to a file with existing content", () => {
      const target = path.join(tmpDir, "CLAUDE.md");
      fs.writeFileSync(target, "# My existing config\nSome stuff\n");

      installTemplate(target, "test-snippet.md", assetsDir, "marker-inject");

      const result = fs.readFileSync(target, "utf8");
      expect(result).toContain("# My existing config");
      expect(result).toContain("# Kanon Section");
    });

    it("should be idempotent — replaces between markers on re-run", () => {
      const target = path.join(tmpDir, "CLAUDE.md");
      fs.writeFileSync(target, "# Existing\n");

      installTemplate(target, "test-snippet.md", assetsDir, "marker-inject");
      const first = fs.readFileSync(target, "utf8");

      installTemplate(target, "test-snippet.md", assetsDir, "marker-inject");
      const second = fs.readFileSync(target, "utf8");

      expect(first).toBe(second);
    });

    it("should replace content between markers when snippet changes", () => {
      const target = path.join(tmpDir, "CLAUDE.md");
      // First install
      installTemplate(target, "test-snippet.md", assetsDir, "marker-inject");

      // Update snippet
      const newSnippet = "<!-- kanon-mcp-start -->\n# Updated Kanon\nNew content\n<!-- kanon-mcp-end -->";
      fs.writeFileSync(path.join(assetsDir, "templates", "test-snippet.md"), newSnippet);

      installTemplate(target, "test-snippet.md", assetsDir, "marker-inject");

      const result = fs.readFileSync(target, "utf8");
      expect(result).toContain("# Updated Kanon");
      expect(result).not.toContain("# Kanon Section");
    });
  });

  describe("installTemplate — file-copy mode", () => {
    it("should copy the template file to the destination", () => {
      const templateContent = "---\nalwaysApply: false\n---\n# Cursor rules";
      fs.writeFileSync(path.join(assetsDir, "templates", "cursor-rules.mdc"), templateContent);

      const target = path.join(tmpDir, "rules", "kanon.mdc");
      installTemplate(target, "cursor-rules.mdc", assetsDir, "file-copy");

      const result = fs.readFileSync(target, "utf8");
      expect(result).toBe(templateContent);
    });

    it("should overwrite existing file on re-run", () => {
      const templateContent = "updated content";
      fs.writeFileSync(path.join(assetsDir, "templates", "cursor-rules.mdc"), templateContent);

      const target = path.join(tmpDir, "kanon.mdc");
      fs.writeFileSync(target, "old content");

      installTemplate(target, "cursor-rules.mdc", assetsDir, "file-copy");

      expect(fs.readFileSync(target, "utf8")).toBe(templateContent);
    });
  });

  describe("removeTemplate — marker-inject mode", () => {
    it("should remove the marker section from the file", () => {
      const content = "# Before\n\n<!-- kanon-mcp-start -->\n# Kanon\n<!-- kanon-mcp-end -->\n\n# After\n";
      const target = path.join(tmpDir, "CLAUDE.md");
      fs.writeFileSync(target, content);

      const removed = removeTemplate(target, "marker-inject");

      expect(removed).toBe(true);
      const result = fs.readFileSync(target, "utf8");
      expect(result).not.toContain("<!-- kanon-mcp-start -->");
      expect(result).not.toContain("# Kanon");
      expect(result).toContain("# Before");
      expect(result).toContain("# After");
    });

    it("should return false when file has no markers", () => {
      const target = path.join(tmpDir, "CLAUDE.md");
      fs.writeFileSync(target, "# No markers here\n");

      const removed = removeTemplate(target, "marker-inject");
      expect(removed).toBe(false);
    });

    it("should return false when file does not exist", () => {
      const target = path.join(tmpDir, "nonexistent.md");
      const removed = removeTemplate(target, "marker-inject");
      expect(removed).toBe(false);
    });
  });

  describe("removeTemplate — file-copy mode", () => {
    it("should delete the copied file", () => {
      const target = path.join(tmpDir, "kanon.mdc");
      fs.writeFileSync(target, "some content");

      const removed = removeTemplate(target, "file-copy");

      expect(removed).toBe(true);
      expect(fs.existsSync(target)).toBe(false);
    });

    it("should return false when file does not exist", () => {
      const target = path.join(tmpDir, "nonexistent.mdc");
      const removed = removeTemplate(target, "file-copy");
      expect(removed).toBe(false);
    });
  });
});
