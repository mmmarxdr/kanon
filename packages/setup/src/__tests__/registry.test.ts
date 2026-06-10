/**
 * G5 — Registry tests for the `opencode` beta tool.
 *
 * Verifies the shape contract from `opencode-tool-integration/spec.md`:
 *   - getToolByName("opencode") exists
 *   - rootKey === "mcp"
 *   - platforms declares `darwin`, `linux`, `wsl` — NOT `win32`
 *   - no `template` (OpenCode is a product surface only; no personal-config writes)
 *   - all paths live under `~/.config/opencode/...`
 *   - `mcpMode === "direct"` for every declared platform
 */

import { describe, it, expect } from "vitest";
import { getToolByName, toolRegistry } from "../registry.js";
import type { PlatformContext } from "../types.js";

describe("registry — opencode", () => {
  it("registers an `opencode` ToolDefinition", () => {
    const tool = getToolByName("opencode");
    expect(tool).toBeDefined();
  });

  it("uses `mcp` rootKey (NOT `mcpServers`)", () => {
    const tool = getToolByName("opencode")!;
    expect(tool.rootKey).toBe("mcp");
  });

  it("declares darwin, linux, wsl platforms — NOT win32", () => {
    const tool = getToolByName("opencode")!;
    const declared = Object.keys(tool.platforms).sort();
    expect(declared).toEqual(["darwin", "linux", "wsl"]);
  });

  it("does NOT declare a win32 host branch", () => {
    const tool = getToolByName("opencode")!;
    expect(tool.platforms.win32).toBeUndefined();
  });

  it("uses `direct` mcpMode for every declared platform (no wsl-bridge)", () => {
    const tool = getToolByName("opencode")!;
    for (const [name, paths] of Object.entries(tool.platforms)) {
      expect(paths!.mcpMode, `platform ${name} should use direct`).toBe("direct");
    }
  });

  it("resolves config, skills, and commands paths under ~/.config/opencode/", () => {
    const tool = getToolByName("opencode")!;
    const ctx: PlatformContext = { platform: "linux", homedir: "/home/test" };

    const linuxPaths = tool.platforms.linux!;
    expect(linuxPaths.config(ctx)).toBe("/home/test/.config/opencode/opencode.json");
    expect(linuxPaths.skills(ctx)).toBe("/home/test/.config/opencode/skills");
    expect(linuxPaths.commands?.(ctx)).toBe("/home/test/.config/opencode/commands");
  });

  it("does NOT declare a template (no personal-config writes — product surface only)", () => {
    // Per proposal: "do not write to AGENTS.md, opencode.jsonc, or .atl/"
    // The registry must not surface a template path that would let the
    // installer write to a personal OpenCode config file.
    const tool = getToolByName("opencode")!;
    for (const [name, paths] of Object.entries(tool.platforms)) {
      expect(paths!.template, `platform ${name} should not have a template`).toBeUndefined();
    }
  });

  it("appears in the toolRegistry", () => {
    const found = toolRegistry.find((t) => t.name === "opencode");
    expect(found).toBeDefined();
  });
});
