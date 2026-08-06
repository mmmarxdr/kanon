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
import {
  getToolByName,
  resolveToolLegacyConfigPaths,
  resolveToolTargets,
  toolRegistry,
} from "../registry.js";
import type { PlatformContext } from "../types.js";

describe("registry — cursor", () => {
  const cursor = getToolByName("cursor")!;

  it("uses the documented global ~/.cursor paths on native platforms", () => {
    for (const platform of ["linux", "darwin", "win32"] as const) {
      const homedir = platform === "win32" ? "C:\\Users\\test" : "/home/test";
      const ctx: PlatformContext = { platform, homedir };
      const paths = cursor.platforms[platform]!;

      expect(paths.config(ctx)).toBe(path.join(homedir, ".cursor", "mcp.json"));
      expect(paths.skills(ctx)).toBe(path.join(homedir, ".cursor", "skills"));
      expect(paths.agents?.(ctx)).toBe(path.join(homedir, ".cursor", "agents"));
      expect(paths.template).toBeUndefined();
      expect(paths.mcpMode).toBe("direct");
    }
  });

  it("resolves Windows IDE and WSL CLI as two internal targets", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "kanon-cursor-wsl-"));
    try {
      const ctx: PlatformContext = {
        platform: "wsl",
        homedir: path.join(root, "linux-home"),
        winHome: path.join(root, "windows-home"),
      };
      fs.mkdirSync(path.join(ctx.winHome!, ".cursor"), { recursive: true });
      const targets = resolveToolTargets(cursor, ctx);

      expect(targets.map((target) => target.config(ctx))).toEqual([
        path.join(ctx.homedir, ".cursor", "mcp.json"),
        path.join(ctx.winHome!, ".cursor", "mcp.json"),
      ]);
      expect(targets.map((target) => target.mcpMode)).toEqual([
        "direct",
        "wsl-bridge",
      ]);
      for (const target of targets) {
        expect(target.agents?.(ctx)).toBeDefined();
        expect(target.skills(ctx)).toContain(path.join(".cursor", "skills"));
        expect(target.template).toBeUndefined();
      }
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });

  it("does not create a phantom Windows target when only winHome resolves", () => {
    const ctx: PlatformContext = {
      platform: "wsl",
      homedir: "/home/test",
      winHome: "/missing/windows-home",
    };
    expect(resolveToolTargets(cursor, ctx).map((target) => target.mcpMode))
      .toEqual(["direct"]);
  });

  it("declares Cursor MCP identity/type once and resolves only the win32 legacy config", () => {
    expect(cursor.mcpType).toBe("stdio");
    expect(cursor.clientIdentity).toBe("cursor");
    const ctx: PlatformContext = {
      platform: "win32",
      homedir: "C:\\Users\\test",
      appDataDir: "C:\\Users\\test\\AppData\\Roaming",
    };
    expect(resolveToolLegacyConfigPaths(cursor, ctx)).toEqual([
      path.join(ctx.appDataDir!, "Cursor", "User", "mcp.json"),
    ]);
  });

  it("stays one user-facing registry tool", () => {
    expect(toolRegistry.filter((tool) => tool.name === "cursor")).toHaveLength(1);
  });
});

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

  it("declares native agents without template or commands paths", () => {
    const tool = getToolByName("codex")!;
    for (const [name, paths] of Object.entries(tool.platforms)) {
      expect(paths!.template, `platform ${name} should not have template`).toBeUndefined();
      expect(paths!.agents, `platform ${name} should have native agents`).toBeDefined();
      expect(paths!.commands, `platform ${name} should not have commands`).toBeUndefined();
    }
  });

  it("uses current Codex config, agent, and skill locations", () => {
    const tool = getToolByName("codex")!;
    const ctx: PlatformContext = { platform: "linux", homedir: "/home/test" };
    const paths = tool.platforms.linux!;

    expect(paths.config(ctx)).toBe("/home/test/.codex/config.toml");
    expect(paths.agents?.(ctx)).toBe("/home/test/.codex/agents");
    expect(paths.skills(ctx)).toBe("/home/test/.agents/skills");
    expect(tool.clientIdentity).toBe("codex");
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
      expect(paths.agents?.(ctx)).toBe(path.join(override, "agents"));
      expect(paths.skills(ctx)).toBe("/home/test/.agents/skills");
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

/**
 * G5 — Registry tests for the `antigravity-cli` tool (KAN-130).
 */
describe("registry — antigravity-cli", () => {
  it("registers an `antigravity-cli` ToolDefinition", () => {
    const tool = getToolByName("antigravity-cli");
    expect(tool).toBeDefined();
  });

  it("uses `mcpServers` rootKey without `toml` configFormat", () => {
    const tool = getToolByName("antigravity-cli")!;
    expect(tool.rootKey).toBe("mcpServers");
    expect(tool.configFormat).not.toBe("toml");
  });

  it("declares darwin, linux, wsl, and win32 platforms", () => {
    const tool = getToolByName("antigravity-cli")!;
    const declared = Object.keys(tool.platforms).sort();
    expect(declared).toEqual(["darwin", "linux", "win32", "wsl"]);
  });

  it("uses `direct` mcpMode for every declared platform", () => {
    const tool = getToolByName("antigravity-cli")!;
    for (const [name, paths] of Object.entries(tool.platforms)) {
      expect(paths!.mcpMode, `platform ${name} should use direct`).toBe("direct");
    }
  });

  it("does NOT declare template, agents, commands, or workflows paths", () => {
    const tool = getToolByName("antigravity-cli")!;
    for (const [name, paths] of Object.entries(tool.platforms)) {
      expect(paths!.template, `platform ${name} should not have template`).toBeUndefined();
      expect(paths!.agents, `platform ${name} should not have agents`).toBeUndefined();
      expect(paths!.commands, `platform ${name} should not have commands`).toBeUndefined();
      expect(paths!.workflows, `platform ${name} should not have workflows`).toBeUndefined();
    }
  });

  it("resolves config and skills paths under ~/.gemini/antigravity-cli/", () => {
    const tool = getToolByName("antigravity-cli")!;
    const ctx: PlatformContext = { platform: "linux", homedir: "/home/test" };
    const paths = tool.platforms.linux!;

    expect(paths.config(ctx)).toBe(
      "/home/test/.gemini/antigravity-cli/mcp_config.json",
    );
    expect(paths.skills(ctx)).toBe("/home/test/.gemini/antigravity-cli/skills");
    expect(paths.skills(ctx)).not.toContain("/antigravity/skills");
  });

  it("detect returns true when mcp_config.json exists under temp homedir", async () => {
    const tmpHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "kanon-antigravity-cli-detect-"),
    );

    try {
      const cliDir = path.join(tmpHome, ".gemini", "antigravity-cli");
      fs.mkdirSync(cliDir, { recursive: true });
      fs.writeFileSync(
        path.join(cliDir, "mcp_config.json"),
        JSON.stringify({ mcpServers: {} }),
      );

      const tool = getToolByName("antigravity-cli")!;
      const ctx: PlatformContext = { platform: "linux", homedir: tmpHome };
      const detected = await tool.platforms.linux!.detect(ctx);
      expect(detected).toBe(true);
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("appears in the toolRegistry", () => {
    const found = toolRegistry.find((t) => t.name === "antigravity-cli");
    expect(found).toBeDefined();
  });
});
