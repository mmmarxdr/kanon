#!/usr/bin/env node
// ─── Kanon Setup ───────────────────────────────────────────────────────────────

import { Command } from "commander";
import chalk from "chalk";
import { checkbox } from "@inquirer/prompts";
import { buildPlatformContext } from "./detect.js";
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
import type { ToolDefinition, PlatformContext, AuthResult } from "./types.js";
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
  .option("--remove", "Remove Kanon configuration from tools")
  .option("-y, --yes", "Accept all defaults without interactive prompts");

program.action(async (options: {
  apiUrl?: string;
  apiKey?: string;
  tool?: string;
  all?: boolean;
  remove?: boolean;
  yes?: boolean;
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
  yes?: boolean;
}): Promise<void> {
  const removeMode = options.remove === true;
  const assetsDir = getAssetsDir();
  const isInteractive =
    !options.yes && !options.tool && !options.all && !!process.stdin.isTTY;

  // ── 1. Platform Detection ──────────────────────────────────────────
  const ctx = await buildPlatformContext();

  const platformLabel =
    ctx.platform === "wsl" ? "WSL2" : ctx.platform.charAt(0).toUpperCase() + ctx.platform.slice(1);
  console.log(chalk.cyan("[info]") + `  Detected platform: ${chalk.bold(platformLabel)}`);

  if (ctx.platform === "wsl") {
    if (ctx.winHome) {
      console.log(
        chalk.cyan("[info]") +
          `  Windows home: ${chalk.bold(ctx.winHome)}`,
      );
    } else {
      console.log(
        chalk.yellow("[warn]") +
          "  WSL detected but could not resolve Windows home directory",
      );
    }
  }

  // ── 2. Detect all tools ────────────────────────────────────────────
  const detectedTools = await detectTools(ctx);

  // ── 3. Select tools (interactive or flag-based) ────────────────────
  const selectedTools = await selectTools(
    detectedTools,
    { tool: options.tool, all: options.all, yes: options.yes },
    isInteractive,
    ctx,
  );

  // ── 4. Auth Resolution (skip for --remove) ─────────────────────────
  let apiUrl = "";
  let apiKey = "";
  let auth: AuthResult | undefined;

  if (!removeMode) {
    auth = await resolveAuth(
      {
        apiUrl: options.apiUrl,
        apiKey: options.apiKey,
        yes: options.yes,
      },
      ctx,
    );
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
    const platformPaths = tool.platforms[ctx.platform];
    if (!platformPaths) {
      console.log(
        chalk.yellow("  ⚠") +
          ` ${tool.displayName} is not supported on ${ctx.platform} — skipping`,
      );
      console.log("");
      continue;
    }

    const configPath = platformPaths.config(ctx);
    const skillDir = platformPaths.skills(ctx);
    const templatePath = platformPaths.template(ctx);

    if (removeMode) {
      // ── Remove Mode ──────────────────────────────────────────────
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
      const removedSkills = removeSkills(skillDir);
      if (removedSkills.length > 0) {
        console.log(
          chalk.green("  ✓") +
            ` Removed ${removedSkills.length} skills from ${chalk.bold(tool.displayName)}`,
        );
      }

      // Remove template
      const removedTemplate = removeTemplate(templatePath, tool.templateMode);
      if (removedTemplate) {
        console.log(
          chalk.green("  ✓") +
            ` Removed template from ${chalk.bold(tool.displayName)}`,
        );
      }

      // Remove workflows
      if (platformPaths.workflows) {
        const wfDir = platformPaths.workflows(ctx);
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
      const entry = buildMcpEntry(
        mcpResolution,
        apiUrl,
        apiKey,
        ctx,
        platformPaths.mcpMode,
        nodeBin,
      );

      // 1. MCP config
      mergeConfig(configPath, tool.rootKey, entry);
      console.log(
        chalk.green("  ✓") +
          ` Configured MCP for ${chalk.bold(tool.displayName)} (${configPath})`,
      );

      // 2. Skills
      const installedSkills = installSkills(skillDir, assetsDir);
      if (installedSkills.length > 0) {
        console.log(
          chalk.green("  ✓") +
            ` Installed ${installedSkills.length} skills to ${chalk.cyan(skillDir)}`,
        );
      }

      // 3. Template
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
      if (platformPaths.workflows) {
        const wfDir = platformPaths.workflows(ctx);
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

  // ── 6. Summary ─────────────────────────────────────────────────────
  if (removeMode) {
    console.log(
      chalk.green(
        `✓ Removed Kanon configuration from ${successCount} tool(s).`,
      ),
    );
  } else {
    console.log(
      chalk.green(
        `✓ Configured ${successCount} tool(s)!`,
      ),
    );
    console.log("");
    if (auth) {
      const maskKey = (key: string) =>
        key.length > 4 ? "****" + key.slice(-4) : "****";
      console.log(
        `  API URL: ${chalk.cyan(apiUrl)} ${chalk.dim(`(from ${auth.urlSource})`)}`,
      );
      console.log(
        `  API Key: ${chalk.cyan(maskKey(apiKey))} ${chalk.dim(`(${auth.keySource})`)}`,
      );
    }
    console.log("");
    console.log(
      chalk.yellow(
        "  Restart your AI coding tool(s) to pick up the new configuration.",
      ),
    );
  }
  console.log("");
}

// ─── Tool Selection ──────────────────────────────────────────────────────────

/**
 * Select which tools to configure based on flags or interactive checkbox.
 *
 * - --tool <name> → single tool (validated against registry)
 * - --all or --yes → all detected tools
 * - interactive (TTY, no flags) → checkbox with all pre-selected
 * - non-interactive (no TTY, no flags) → all detected tools
 */
export async function selectTools(
  detected: ToolDefinition[],
  flags: { tool?: string; all?: boolean; yes?: boolean },
  isInteractive: boolean,
  ctx: PlatformContext,
  deps?: { promptTools?: (choices: Array<{ name: string; value: string; checked: boolean }>) => Promise<string[]> },
): Promise<ToolDefinition[]> {
  // --tool flag: single tool by name
  if (flags.tool) {
    const tool = getToolByName(flags.tool);
    if (!tool) {
      throw new Error(
        `Unknown tool: '${flags.tool}'. Supported: claude-code, cursor, antigravity`,
      );
    }
    if (!tool.platforms[ctx.platform]) {
      throw new Error(
        `${tool.displayName} is not supported on ${ctx.platform}`,
      );
    }
    return [tool];
  }

  // No tools detected → error
  if (detected.length === 0) {
    throw new Error(
      "No supported tools detected. Install at least one supported AI coding tool.",
    );
  }

  // --all or --yes → all detected
  if (flags.all || flags.yes) {
    return detected;
  }

  // Non-interactive (no TTY) → all detected
  if (!isInteractive) {
    return detected;
  }

  // Interactive → checkbox with all pre-selected
  const _promptTools = deps?.promptTools ?? defaultPromptTools;

  console.log("");
  const selectedNames = await _promptTools(
    detected.map((t) => ({
      name: t.displayName,
      value: t.name,
      checked: true,
    })),
  );

  if (selectedNames.length === 0) {
    console.log(chalk.yellow("No tools selected — nothing to do."));
    process.exit(0);
  }

  return detected.filter((t) => selectedNames.includes(t.name));
}

async function defaultPromptTools(
  choices: Array<{ name: string; value: string; checked: boolean }>,
): Promise<string[]> {
  return checkbox({
    message: "Select tools to configure:",
    choices,
  });
}

program.parse();
