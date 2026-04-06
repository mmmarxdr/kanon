// ─── Tool Registry ───────────────────────────────────────────────────────────

import fs from "node:fs";
import type { ToolDefinition, PlatformContext } from "./types.js";
import { commandExists } from "./detect.js";

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
