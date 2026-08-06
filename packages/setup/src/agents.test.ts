import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parse } from "smol-toml";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAgents, removeAgents } from "./agents.js";
import { getAssetsDir } from "./tool-surface.js";
import { parseFrontmatter } from "./utils/frontmatter.js";

const SOURCE = `---
name: kanon
description: Kanon board specialist
allowed-tools:
  - "mcp__kanon*"
model: haiku
readonly: true
---

Use kanon_start_work(issue_key).
`;

function readMarkdownTree(dir: string): string {
  return fs.readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(dir, entry.name);
      return entry.isDirectory()
        ? readMarkdownTree(entryPath)
        : entry.name.endsWith(".md") ? fs.readFileSync(entryPath, "utf8") : "";
    })
    .join("\n");
}

describe("agent installation", () => {
  let tmpDir: string;
  let assetsDir: string;
  let agentDest: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-agent-test-"));
    assetsDir = path.join(tmpDir, "assets");
    agentDest = path.join(tmpDir, "dest");
    fs.mkdirSync(path.join(assetsDir, "agents"), { recursive: true });
    fs.writeFileSync(path.join(assetsDir, "agents", "kanon.md"), SOURCE);
  });

  afterEach(() => fs.rmSync(tmpDir, { recursive: true, force: true }));

  it("renders only current documented Cursor frontmatter fields", () => {
    installAgents(agentDest, assetsDir, "cursor");
    const installed = fs.readFileSync(path.join(agentDest, "kanon.md"), "utf8");
    const parsed = parseFrontmatter(installed);

    expect(parsed.data).toEqual({
      name: "kanon",
      description: "Kanon board specialist",
      readonly: false,
      is_background: false,
    });
    expect(parsed.body).toContain("kanon_start_work(issue_key)");
    expect(installed).not.toContain("allowed-tools");
    expect(installed).not.toContain("model:");
  });

  it("copies non-Cursor agents byte-for-byte", () => {
    installAgents(agentDest, assetsDir, "claude-code");
    expect(fs.readFileSync(path.join(agentDest, "kanon.md"), "utf8")).toBe(SOURCE);
  });

  it("renders a native Codex TOML agent", () => {
    expect(installAgents(agentDest, assetsDir, "codex")).toEqual(["kanon.toml"]);

    const installed = parse(
      fs.readFileSync(path.join(agentDest, "kanon.toml"), "utf8"),
    );
    expect(installed).toEqual({
      name: "kanon",
      description: "Kanon board specialist",
      developer_instructions: "Use kanon_start_work(issue_key).",
    });
  });

  it("removes only the agent format owned for each host", () => {
    fs.mkdirSync(agentDest, { recursive: true });
    fs.writeFileSync(path.join(agentDest, "kanon.md"), "owned");
    fs.writeFileSync(path.join(agentDest, "kanon.toml"), "owned");
    fs.writeFileSync(path.join(agentDest, "kanon-notes.md"), "user-owned");

    expect(removeAgents(agentDest, "codex")).toEqual(["kanon.toml"]);
    expect(fs.existsSync(path.join(agentDest, "kanon.md"))).toBe(true);
    expect(removeAgents(agentDest, "claude-code")).toEqual(["kanon.md"]);
    expect(fs.readFileSync(path.join(agentDest, "kanon-notes.md"), "utf8")).toBe("user-owned");
  });

  it("ships no references to retired visible tool names", () => {
    const content = readMarkdownTree(getAssetsDir());
    for (const retired of [
      "kanon_who_is_working",
      "kanon_comment_issue",
      "kanon_batch_transition",
      "kanon_attach_issues_to_cycle",
      "kanon_create_document",
      "kanon_list_documents",
      "kanon_get_document",
    ]) {
      expect(content).not.toContain(retired);
    }
  });
});
