// ─── Tool Registry ───────────────────────────────────────────────────────────

import fs from "node:fs";
import path from "node:path";
import type { ToolDefinition, PlatformContext, PlatformPaths } from "./types.js";
import { commandExists } from "./detect.js";

/**
 * Resolve Codex CLI home directory, respecting CODEX_HOME override.
 */
export function resolveCodexHome(ctx: PlatformContext, ...segments: string[]): string {
  const base = process.env["CODEX_HOME"] ?? path.join(ctx.homedir, ".codex");
  return segments.length ? path.join(base, ...segments) : base;
}

/**
 * OpenCode platform paths — shared across darwin/linux/wsl.
 *
 * OpenCode persists config, skills, and commands under
 * `~/.config/opencode/` (XDG-style) on every supported platform, so the
 * resolution functions are identical. Detection checks the CLI via
 * `commandExists` OR the on-disk config file.
 *
 * No `template` (OpenCode is a product surface only) and no `agents`
 * (no personal agent files) are declared here — see leakage-guard.test.ts.
 *
 * Declared BEFORE `toolRegistry` so the registry can reference it as a
 * shared const for the three byte-identical platform entries.
 */
const OPENCODE_PATHS: PlatformPaths = {
  detect: async (ctx) =>
    commandExists("opencode", ctx.platform) ||
    fs.existsSync(`${ctx.homedir}/.config/opencode/opencode.json`),
  config: (ctx) => path.join(ctx.homedir, ".config", "opencode", "opencode.json"),
  skills: (ctx) => path.join(ctx.homedir, ".config", "opencode", "skills"),
  commands: (ctx) => path.join(ctx.homedir, ".config", "opencode", "commands"),
  mcpMode: "direct",
};

/**
 * Codex CLI platform paths — shared across darwin/linux/wsl/win32.
 *
 * Codex is a product surface only: MCP config + skills. No template,
 * agents, or commands paths (see leakage-guard.test.ts).
 */
const CODEX_PATHS: PlatformPaths = {
  detect: async (ctx) =>
    commandExists("codex", ctx.platform) ||
    fs.existsSync(resolveCodexHome(ctx, "config.toml")),
  config: (ctx) => resolveCodexHome(ctx, "config.toml"),
  skills: (ctx) => resolveCodexHome(ctx, "skills"),
  mcpMode: "direct",
};

/**
 * Antigravity CLI platform paths — shared across darwin/linux/wsl/win32.
 *
 * Antigravity CLI (`agy`) is a product surface only: MCP config + skills.
 * Config lives at `~/.gemini/antigravity-cli/mcp_config.json` — sibling to
 * the IDE entry at `~/.gemini/antigravity/`, not the same directory.
 * WSL uses `direct` + Linux homedir (CLI runs in WSL, not Windows host).
 */
const ANTIGRAVITY_CLI_PATHS: PlatformPaths = {
  detect: async (ctx) =>
    commandExists("agy", ctx.platform) ||
    fs.existsSync(
      path.join(ctx.homedir, ".gemini", "antigravity-cli", "mcp_config.json"),
    ) ||
    fs.existsSync(path.join(ctx.homedir, ".gemini", "antigravity-cli")),
  config: (ctx) =>
    path.join(ctx.homedir, ".gemini", "antigravity-cli", "mcp_config.json"),
  skills: (ctx) =>
    path.join(ctx.homedir, ".gemini", "antigravity-cli", "skills"),
  mcpMode: "direct",
};

export const toolRegistry: ToolDefinition[] = [
  // ── Claude Code ──────────────────────────────────────────────────────
  {
    name: "claude-code",
    displayName: "Claude Code",
    rootKey: "mcpServers",
    templateSource: "claude-code-snippet.md",
    templateMode: "marker-inject",

    platforms: {
      // Claude Code is NOT supported on win32 — no entry
      wsl: {
        detect: async (ctx) =>
          fs.existsSync(`${ctx.homedir}/.claude`) ||
          commandExists("claude", ctx.platform),
        config: (ctx) => `${ctx.homedir}/.claude.json`,
        skills: (ctx) => `${ctx.homedir}/.claude/skills`,
        workflows: (ctx) => `${ctx.homedir}/.claude/workflows`,
        agents: (ctx) => `${ctx.homedir}/.claude/agents`,
        template: (ctx) => `${ctx.homedir}/.claude/CLAUDE.md`,
        mcpMode: "direct",
      },
      linux: {
        detect: async (ctx) =>
          fs.existsSync(`${ctx.homedir}/.claude`) ||
          commandExists("claude", ctx.platform),
        config: (ctx) => `${ctx.homedir}/.claude.json`,
        skills: (ctx) => `${ctx.homedir}/.claude/skills`,
        workflows: (ctx) => `${ctx.homedir}/.claude/workflows`,
        agents: (ctx) => `${ctx.homedir}/.claude/agents`,
        template: (ctx) => `${ctx.homedir}/.claude/CLAUDE.md`,
        mcpMode: "direct",
      },
    },
  },

  // ── Cursor ───────────────────────────────────────────────────────────
  {
    name: "cursor",
    displayName: "Cursor",
    rootKey: "mcpServers",
    templateSource: "cursor-rules.mdc",
    templateMode: "file-copy",

    platforms: {
      win32: {
        detect: async (ctx) => {
          const appData = ctx.appDataDir;
          return !!appData && fs.existsSync(`${appData}\\Cursor\\User`);
        },
        config: (ctx) => {
          const appData = ctx.appDataDir!;
          return `${appData}\\Cursor\\User\\mcp.json`;
        },
        skills: (ctx) => `${ctx.homedir}\\.cursor\\skills`,
        agents: (ctx) => `${ctx.homedir}\\.cursor\\agents`,
        template: (ctx) => `${ctx.homedir}\\.cursor\\rules\\kanon.mdc`,
        mcpMode: "direct",
      },
      wsl: {
        detect: async (ctx) => {
          return !!ctx.winHome && fs.existsSync(`${ctx.winHome}/.cursor`);
        },
        config: (ctx) => `${ctx.winHome!}/.cursor/mcp.json`,
        skills: (ctx) => `${ctx.winHome!}/.cursor/skills`,
        agents: (ctx) => `${ctx.winHome!}/.cursor/agents`,
        template: (ctx) => `${ctx.winHome!}/.cursor/rules/kanon.mdc`,
        mcpMode: "wsl-bridge",
      },
      linux: {
        detect: async (ctx) => fs.existsSync(`${ctx.homedir}/.cursor`),
        config: (ctx) => `${ctx.homedir}/.cursor/mcp.json`,
        skills: (ctx) => `${ctx.homedir}/.cursor/skills`,
        agents: (ctx) => `${ctx.homedir}/.cursor/agents`,
        template: (ctx) => `${ctx.homedir}/.cursor/rules/kanon.mdc`,
        mcpMode: "direct",
      },
    },
  },

  // ── Antigravity (Gemini) ─────────────────────────────────────────────
  {
    name: "antigravity",
    displayName: "Antigravity",
    rootKey: "mcpServers",
    templateSource: "gemini-instructions.md",
    templateMode: "marker-inject",

    platforms: {
      win32: {
        detect: async (ctx) =>
          fs.existsSync(`${ctx.homedir}\\.gemini`),
        config: (ctx) =>
          `${ctx.homedir}\\.gemini\\antigravity\\mcp_config.json`,
        skills: (ctx) =>
          `${ctx.homedir}\\.gemini\\antigravity\\skills`,
        workflows: (ctx) =>
          `${ctx.homedir}\\.gemini\\antigravity\\global_workflows`,
        agents: (ctx) => `${ctx.homedir}\\.gemini\\agents`,
        template: (ctx) => `${ctx.homedir}\\.gemini\\GEMINI.md`,
        mcpMode: "direct",
      },
      wsl: {
        detect: async (ctx) => {
          return !!ctx.winHome && fs.existsSync(`${ctx.winHome}/.gemini`);
        },
        config: (ctx) =>
          `${ctx.winHome!}/.gemini/antigravity/mcp_config.json`,
        skills: (ctx) =>
          `${ctx.winHome!}/.gemini/antigravity/skills`,
        workflows: (ctx) =>
          `${ctx.winHome!}/.gemini/antigravity/global_workflows`,
        agents: (ctx) => `${ctx.winHome!}/.gemini/agents`,
        template: (ctx) => `${ctx.winHome!}/.gemini/GEMINI.md`,
        mcpMode: "wsl-bridge",
      },
      linux: {
        detect: async (ctx) =>
          fs.existsSync(`${ctx.homedir}/.gemini`),
        config: (ctx) =>
          `${ctx.homedir}/.gemini/antigravity/mcp_config.json`,
        skills: (ctx) =>
          `${ctx.homedir}/.gemini/antigravity/skills`,
        workflows: (ctx) =>
          `${ctx.homedir}/.gemini/antigravity/global_workflows`,
        agents: (ctx) => `${ctx.homedir}/.gemini/agents`,
        template: (ctx) => `${ctx.homedir}/.gemini/GEMINI.md`,
        mcpMode: "direct",
      },
    },
  },

  // ── OpenCode (Beta) ────────────────────────────────────────────────────
  // OpenCode is a fourth supported AI tool — beta on Linux, macOS, WSL.
  // It uses a native `mcp` rootKey with an array-form command entry
  // (ADR 0005, planned in PR 3) instead of the legacy `mcpServers` object
  // form used by Claude / Cursor / Antigravity.
  //
  // OpenCode is a PRODUCT SURFACE only — we do NOT write to:
  //   - AGENTS.md        (personal harness file)
  //   - opencode.jsonc   (personal config)
  //   - .atl/            (Gentle AI internal)
  // We also do NOT register a `template` path; if a future PR adds one,
  // the leakage guard test (PR2.6) will flag it.
  //
  // The darwin/linux/wsl platform blocks are byte-identical: the on-disk
  // path layout (XDG-style `~/.config/opencode/...`) is the same on all
  // three. Reuse a single `PlatformPaths` const rather than copying
  // 12 lines three times. (OpenCode does not have a Windows host binary
  // — hence the omission of a `win32` branch; this matches the spec at
  // opencode-tool-integration/spec.md.)
  {
    name: "opencode",
    displayName: "OpenCode",
    rootKey: "mcp",
    // No templateSource / templateMode / template — OpenCode has no personal
    // template file we own. (templateSource + templateMode remain required
    // on the type, but we set them to harmless sentinels — the index.ts
    // template branch is now optional and skipped when template() is absent.)
    templateSource: "",
    templateMode: "marker-inject",

    platforms: {
      darwin: OPENCODE_PATHS,
      linux: OPENCODE_PATHS,
      wsl: OPENCODE_PATHS,
    },
  },

  // ── Codex CLI ──────────────────────────────────────────────────────────
  // OpenAI Codex CLI — global install under $CODEX_HOME (default ~/.codex).
  // Product surface only: TOML MCP config + skills. No AGENTS.md writes.
  {
    name: "codex",
    displayName: "Codex CLI",
    rootKey: "mcp_servers",
    configFormat: "toml",
    templateSource: "",
    templateMode: "marker-inject",

    platforms: {
      darwin: CODEX_PATHS,
      linux: CODEX_PATHS,
      wsl: CODEX_PATHS,
      win32: CODEX_PATHS,
    },
  },

  // ── Antigravity CLI ────────────────────────────────────────────────────
  // Google Antigravity CLI (`agy`) — global install under
  // ~/.gemini/antigravity-cli/. Product surface only: JSON MCP + skills.
  // Separate from IDE `antigravity` entry (different paths, WSL semantics).
  {
    name: "antigravity-cli",
    displayName: "Antigravity CLI",
    rootKey: "mcpServers",
    templateSource: "",
    templateMode: "marker-inject",

    platforms: {
      darwin: ANTIGRAVITY_CLI_PATHS,
      linux: ANTIGRAVITY_CLI_PATHS,
      wsl: ANTIGRAVITY_CLI_PATHS,
      win32: ANTIGRAVITY_CLI_PATHS,
    },
  },
];

/**
 * Detect which tools are available on the system.
 * Uses the per-platform paths map to check support and run detection.
 */
export async function detectTools(
  ctx: PlatformContext,
): Promise<ToolDefinition[]> {
  const detected: ToolDefinition[] = [];

  for (const tool of toolRegistry) {
    const platformPaths = tool.platforms[ctx.platform];
    if (!platformPaths) {
      // Tool doesn't support this platform — skip silently
      continue;
    }

    const found = await platformPaths.detect(ctx);
    if (found) {
      detected.push(tool);
    }
  }

  return detected;
}

/**
 * Find a tool by name from the registry.
 */
export function getToolByName(name: string): ToolDefinition | undefined {
  return toolRegistry.find((t) => t.name === name);
}
