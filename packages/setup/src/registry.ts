// ─── Tool Registry ───────────────────────────────────────────────────────────

import fs from "node:fs";
import os from "node:os";
import type { ToolDefinition } from "./types.js";
import { commandExists } from "./detect.js";

const home = os.homedir();

export const toolRegistry: ToolDefinition[] = [
  // ── Claude Code ──────────────────────────────────────────────────────
  {
    name: "claude-code",
    displayName: "Claude Code",
    configPath: () => `${home}/.claude.json`,
    rootKey: "mcpServers",
    detect: async () => {
      return fs.existsSync(`${home}/.claude`) || commandExists("claude");
    },
    skillDest: () => `${home}/.claude/skills`,
    workflowDest: () => `${home}/.claude/workflows`,
    templateSource: "claude-code-snippet.md",
    templateTarget: () => `${home}/.claude/CLAUDE.md`,
    templateMode: "marker-inject",
    isWindowsNative: false,
  },

  // ── Cursor ───────────────────────────────────────────────────────────
  {
    name: "cursor",
    displayName: "Cursor",
    configPath: (winHome?: string) => {
      const base = winHome || home;
      return `${base}/.cursor/mcp.json`;
    },
    rootKey: "mcpServers",
    detect: async () => {
      return fs.existsSync(`${home}/.cursor`);
    },
    wslDetect: async (winHome: string) => {
      return fs.existsSync(`${winHome}/.cursor`);
    },
    skillDest: (winHome?: string) => {
      const base = winHome || home;
      return `${base}/.cursor/skills`;
    },
    // Cursor has no global workflows
    templateSource: "cursor-rules.mdc",
    templateTarget: (winHome?: string) => {
      const base = winHome || home;
      return `${base}/.cursor/rules/kanon.mdc`;
    },
    templateMode: "file-copy",
    isWindowsNative: true,
  },

  // ── Antigravity (Gemini) ─────────────────────────────────────────────
  {
    name: "antigravity",
    displayName: "Antigravity",
    configPath: (winHome?: string) => {
      const base = winHome || home;
      return `${base}/.gemini/antigravity/mcp_config.json`;
    },
    rootKey: "mcpServers",
    detect: async () => {
      return fs.existsSync(`${home}/.gemini`);
    },
    wslDetect: async (winHome: string) => {
      return fs.existsSync(`${winHome}/.gemini`);
    },
    skillDest: (winHome?: string) => {
      const base = winHome || home;
      return `${base}/.gemini/antigravity/skills`;
    },
    workflowDest: (winHome?: string) => {
      const base = winHome || home;
      return `${base}/.gemini/antigravity/global_workflows`;
    },
    templateSource: "gemini-instructions.md",
    templateTarget: (winHome?: string) => {
      const base = winHome || home;
      return `${base}/.gemini/GEMINI.md`;
    },
    templateMode: "marker-inject",
    isWindowsNative: true,
  },
];

/**
 * Detect which tools are available on the system.
 * In WSL mode, Windows-native tools are detected via their wslDetect method.
 */
export async function detectTools(
  wslMode: boolean,
  winHome?: string,
): Promise<ToolDefinition[]> {
  const detected: ToolDefinition[] = [];

  for (const tool of toolRegistry) {
    let found = false;

    if (wslMode && tool.isWindowsNative && tool.wslDetect && winHome) {
      found = await tool.wslDetect(winHome);
    } else if (!tool.isWindowsNative || !wslMode) {
      found = await tool.detect();
    }

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
