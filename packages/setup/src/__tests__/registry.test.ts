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
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
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

/**
 * G5 — Registry tests for the `codex` tool (KAN-128).
 */
describe("registry — codex", () => {
  it("registers a `codex` ToolDefinition", () => {
    const tool = getToolByName("codex");
    expect(tool).toBeDefined();
  });

  it("uses `mcp_servers` rootKey with `toml` configFormat", () => {
    const tool = getToolByName("codex")!;
    expect(tool.rootKey).toBe("mcp_servers");
    expect(tool.configFormat).toBe("toml");
  });

  it("declares darwin, linux, wsl, and win32 platforms", () => {
    const tool = getToolByName("codex")!;
    const declared = Object.keys(tool.platforms).sort();
    expect(declared).toEqual(["darwin", "linux", "win32", "wsl"]);
  });

  it("uses `direct` mcpMode for every declared platform", () => {
    const tool = getToolByName("codex")!;
    for (const [name, paths] of Object.entries(tool.platforms)) {
      expect(paths!.mcpMode, `platform ${name} should use direct`).toBe("direct");
    }
  });

  it("does NOT declare template, agents, or commands paths", () => {
    const tool = getToolByName("codex")!;
    for (const [name, paths] of Object.entries(tool.platforms)) {
      expect(paths!.template, `platform ${name} should not have template`).toBeUndefined();
      expect(paths!.agents, `platform ${name} should not have agents`).toBeUndefined();
      expect(paths!.commands, `platform ${name} should not have commands`).toBeUndefined();
    }
  });

  it("resolves default config and skills paths under ~/.codex/", () => {
    const tool = getToolByName("codex")!;
    const ctx: PlatformContext = { platform: "linux", homedir: "/home/test" };
    const paths = tool.platforms.linux!;

    expect(paths.config(ctx)).toBe("/home/test/.codex/config.toml");
    expect(paths.skills(ctx)).toBe("/home/test/.codex/skills");
  });

  it("resolves paths under CODEX_HOME when env is set", () => {
    const prev = process.env.CODEX_HOME;
    const override = "/tmp/custom-codex-home";
    process.env.CODEX_HOME = override;

    try {
      const tool = getToolByName("codex")!;
      const ctx: PlatformContext = { platform: "linux", homedir: "/home/test" };
      const paths = tool.platforms.linux!;

      expect(paths.config(ctx)).toBe(path.join(override, "config.toml"));
      expect(paths.skills(ctx)).toBe(path.join(override, "skills"));
    } finally {
      if (prev === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prev;
      }
    }
  });

  it("detect returns true when config.toml exists under codex home", async () => {
    const prev = process.env.CODEX_HOME;
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-codex-detect-"));
    process.env.CODEX_HOME = tmpHome;

    try {
      fs.mkdirSync(tmpHome, { recursive: true });
      fs.writeFileSync(path.join(tmpHome, "config.toml"), "# codex\n");

      const tool = getToolByName("codex")!;
      const ctx: PlatformContext = { platform: "linux", homedir: "/home/test" };
      const detected = await tool.platforms.linux!.detect(ctx);
      expect(detected).toBe(true);
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
      if (prev === undefined) {
        delete process.env.CODEX_HOME;
      } else {
        process.env.CODEX_HOME = prev;
      }
    }
  });

  it("appears in the toolRegistry", () => {
    const found = toolRegistry.find((t) => t.name === "codex");
    expect(found).toBeDefined();
  });
});
