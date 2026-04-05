#!/usr/bin/env node
// ─── Kanon Setup ───────────────────────────────────────────────────────────────

import { Command } from "commander";
import chalk from "chalk";
import { isWsl, resolveWinHome } from "./detect.js";
import { resolveAuth } from "./auth.js";
import { detectTools, getToolByName } from "./registry.js";
import {
  buildMcpEntry,
  mergeConfig,
  removeConfig,
  resolveMcpServerPath,
  resolveNodeBin,
} from "./mcp-config.js";
import { installSkills, removeSkills } from "./skills.js";
import { installTemplate, removeTemplate } from "./templates.js";
import { installWorkflows, removeWorkflows } from "./workflows.js";
import type { ToolDefinition } from "./types.js";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function getAssetsDir(): string {
  // In dist: __dirname is dist/, assets are at ../assets/
  const fromDist = path.resolve(__dirname, "../assets");
  // In dev: __dirname is src/, assets are at ../assets/
  const fromSrc = path.resolve(__dirname, "../assets");
  // Both resolve to the same relative path
  return fromDist || fromSrc;
}

const program = new Command();

program
  .name("kanon-setup")
  .version("0.2.0")
  .description(
    "Configure Kanon AI tool integrations — MCP servers, skills, templates, and workflows",
  )
  .option("--api-url <url>", "Kanon API URL")
  .option("--api-key <key>", "Kanon API key")
  .option(
    "--tool <name>",
    "Target a specific tool (claude-code, cursor, antigravity)",
  )
  .option("--all", "Configure all detected tools")
  .option("--remove", "Remove Kanon configuration from tools");

program.action(async (options: {
  apiUrl?: string;
  apiKey?: string;
  tool?: string;
  all?: boolean;
  remove?: boolean;
}) => {
  try {
    await run(options);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
});

async function run(options: {
  apiUrl?: string;
  apiKey?: string;
  tool?: string;
  all?: boolean;
  remove?: boolean;
}): Promise<void> {
  const removeMode = options.remove === true;
  const assetsDir = getAssetsDir();

  // ── WSL Detection ──────────────────────────────────────────────────
  const wslMode = isWsl();
  let winHome: string | undefined;

  if (wslMode) {
    winHome = resolveWinHome();
    if (winHome) {
      console.log(
        chalk.cyan("[info]") +
          `  WSL detected — Windows home: ${chalk.bold(winHome)}`,
      );
    } else {
      console.log(
        chalk.yellow("[warn]") +
          "  WSL detected but could not resolve Windows home directory",
      );
    }
  }

  // ── Tool Detection & Selection ─────────────────────────────────────
  let selectedTools: ToolDefinition[];

  if (options.tool) {
    const tool = getToolByName(options.tool);
    if (!tool) {
      throw new Error(
        `Unknown tool: '${options.tool}'. Supported: claude-code, cursor, antigravity`,
      );
    }
    selectedTools = [tool];
  } else if (options.all) {
    selectedTools = await detectTools(wslMode, winHome);
    if (selectedTools.length === 0) {
      throw new Error(
        "No supported tools detected. Install at least one supported AI coding tool.",
      );
    }
  } else {
    // Detect and show what's available
    selectedTools = await detectTools(wslMode, winHome);
    if (selectedTools.length === 0) {
      throw new Error(
        "No supported tools detected. Install at least one supported AI coding tool.",
      );
    }
    console.log("");
    console.log(chalk.bold("Detected AI coding tools:"));
    for (const tool of selectedTools) {
      console.log(`  ${chalk.cyan("-")} ${tool.displayName}`);
    }
    console.log("");
  }

  // ── Auth Resolution (skip for --remove) ────────────────────────────
  let apiUrl = "";
  let apiKey = "";

  if (!removeMode) {
    const auth = await resolveAuth({
      apiUrl: options.apiUrl,
      apiKey: options.apiKey,
    });
    apiUrl = auth.apiUrl;
    apiKey = auth.apiKey;
  }

  // ── MCP Server Path ────────────────────────────────────────────────
  const mcpResolution = resolveMcpServerPath();
  const nodeBin = resolveNodeBin();

  // ── Apply Configuration ────────────────────────────────────────────
  console.log("");
  if (removeMode) {
    console.log(
      chalk.bold("Removing Kanon configuration from selected tools..."),
    );
  } else {
    console.log(chalk.bold("Configuring Kanon for selected tools..."));
  }
  console.log("");

  let successCount = 0;

  for (const tool of selectedTools) {
    const useWslPaths = wslMode && tool.isWindowsNative;
    const pathArg = useWslPaths ? winHome : undefined;

    if (removeMode) {
      // ── Remove Mode ──────────────────────────────────────────────
      const configPath = tool.configPath(pathArg);
      const removed = removeConfig(configPath, tool.rootKey);
      if (removed) {
        console.log(
          chalk.green("  ✓") +
            ` Removed MCP config from ${chalk.bold(tool.displayName)}`,
        );
      } else {
        console.log(
          chalk.yellow("  ⚠") +
            ` MCP config not found for ${tool.displayName} — nothing to remove`,
        );
      }

      // Remove skills
      const skillDir = tool.skillDest(pathArg);
      const removedSkills = removeSkills(skillDir);
      if (removedSkills.length > 0) {
        console.log(
          chalk.green("  ✓") +
            ` Removed ${removedSkills.length} skills from ${chalk.bold(tool.displayName)}`,
        );
      }

      // Remove template
      const templatePath = tool.templateTarget(pathArg);
      const removedTemplate = removeTemplate(templatePath, tool.templateMode);
      if (removedTemplate) {
        console.log(
          chalk.green("  ✓") +
            ` Removed template from ${chalk.bold(tool.displayName)}`,
        );
      }

      // Remove workflows
      if (tool.workflowDest) {
        const wfDir = tool.workflowDest(pathArg);
        const removedWfs = removeWorkflows(wfDir);
        if (removedWfs.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Removed ${removedWfs.length} workflows from ${chalk.bold(tool.displayName)}`,
          );
        }
      }

      successCount++;
    } else {
      // ── Install Mode ─────────────────────────────────────────────
      const configPath = tool.configPath(pathArg);
      const entry = buildMcpEntry(
        mcpResolution,
        apiUrl,
        apiKey,
        wslMode,
        tool.isWindowsNative,
        nodeBin,
      );

      // 1. MCP config
      mergeConfig(configPath, tool.rootKey, entry);
      console.log(
        chalk.green("  ✓") +
          ` Configured MCP for ${chalk.bold(tool.displayName)} (${configPath})`,
      );

      // 2. Skills
      const skillDir = tool.skillDest(pathArg);
      const installedSkills = installSkills(skillDir, assetsDir);
      if (installedSkills.length > 0) {
        console.log(
          chalk.green("  ✓") +
            ` Installed ${installedSkills.length} skills to ${chalk.cyan(skillDir)}`,
        );
      }

      // 3. Template
      const templatePath = tool.templateTarget(pathArg);
      installTemplate(
        templatePath,
        tool.templateSource,
        assetsDir,
        tool.templateMode,
      );
      console.log(
        chalk.green("  ✓") +
          ` Installed template for ${chalk.bold(tool.displayName)} (${templatePath})`,
      );

      // 4. Workflows
      if (tool.workflowDest) {
        const wfDir = tool.workflowDest(pathArg);
        const installedWfs = installWorkflows(wfDir, assetsDir);
        if (installedWfs.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Installed ${installedWfs.length} workflows to ${chalk.cyan(wfDir)}`,
          );
        }
      }

      successCount++;
    }

    console.log("");
  }

  // ── Summary ────────────────────────────────────────────────────────
  if (removeMode) {
    console.log(
      chalk.green(
        `✓ Removed Kanon configuration from ${successCount} tool(s).`,
      ),
    );
  } else {
    console.log(
      chalk.green(
        `✓ Kanon configured for ${successCount} tool(s)!`,
      ),
    );
    console.log("");
    console.log(`  API URL: ${chalk.cyan(apiUrl)}`);
    console.log(`  MCP:     ${chalk.cyan(mcpResolution.mode === "local" ? mcpResolution.path : "npx @kanon/mcp")}`);
    console.log("");
    console.log(
      chalk.yellow(
        "  Restart your AI coding tool(s) to pick up the new configuration.",
      ),
    );
  }
  console.log("");
}

program.parse();
