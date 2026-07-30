import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { installAgents, removeAgents } from "./agents.js";
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

  it("removes only exact Kanon product files", () => {
    fs.mkdirSync(agentDest, { recursive: true });
    fs.writeFileSync(path.join(agentDest, "kanon.md"), "owned");
    fs.writeFileSync(path.join(agentDest, "kanon-notes.md"), "user-owned");

    expect(removeAgents(agentDest)).toEqual(["kanon.md"]);
    expect(fs.readFileSync(path.join(agentDest, "kanon-notes.md"), "utf8")).toBe("user-owned");
  });
});
