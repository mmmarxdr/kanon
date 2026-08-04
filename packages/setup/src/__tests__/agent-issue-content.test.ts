import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const readAsset = (relativePath: string) =>
  fs.readFileSync(path.join(root, "assets", relativePath), "utf8");

describe("shipped agent issue-content policy", () => {
  it("keeps issue descriptions PM-facing and excludes local execution metadata", () => {
    const content = [
      readAsset("skills/kanon-agent/SKILL.md"),
      readAsset("skills/kanon-agent/sections/issue-creation.md"),
      readAsset("commands/kanon-agent.md"),
    ].join("\n");

    expect(content).toMatch(/PM-facing/i);
    expect(content).toMatch(/absolute local paths/i);
    expect(content).toMatch(/worktrees/i);
    expect(content).toMatch(/temporary branches/i);
    expect(content).toMatch(/agent.*model.*session/i);
  });

  it("publishes SDD outcomes instead of local execution mechanics", () => {
    const content = readAsset("skills/kanon-agent/sections/sdd-hooks.md");

    expect(content).toMatch(/outcome summary/i);
    expect(content).toMatch(/repository-relative/i);
    expect(content).toMatch(/never.*worktree/i);
  });
});
