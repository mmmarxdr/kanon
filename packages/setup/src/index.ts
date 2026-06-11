#!/usr/bin/env node
// ─── Kanon Setup ───────────────────────────────────────────────────────────────

import { Command } from "commander";
import chalk from "chalk";
import { checkbox } from "@inquirer/prompts";
import { buildPlatformContext } from "./detect.js";
import { resolveAuth } from "./auth.js";
import { detectTools, getToolByName, toolRegistry } from "./registry.js";
import {
  buildMcpEntry,
  buildWrapperMcpEntry,
  extractExistingWorkspaceId,
  mergeConfig,
  removeConfig,
  resolveMcpServerPath,
  resolveNodeBin,
} from "./mcp-config.js";
import { installSkills, removeSkills } from "./skills.js";
import { installTemplate, removeTemplate } from "./templates.js";
import { installWorkflows, removeWorkflows } from "./workflows.js";
import { installAgents, removeAgents } from "./agents.js";
import { installCommands, removeCommands } from "./commands.js";
import type { ToolDefinition, PlatformContext, AuthResult } from "./types.js";
import { getCredentialStore } from "./credential-store/factory.js";
import { resolveWrapperReuse } from "./wrapper-reuse.js";
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
    "Target a specific tool (claude-code, cursor, antigravity, opencode)",
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
    await dispatch(
      process.argv,
      options,
      { cascade: () => run(options) },
      // no io override — uses defaultDispatchIO() inside dispatch
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(chalk.red(`Error: ${message}`));
    process.exit(1);
  }
});

/**
 * IO seam injected into dispatch() so tests can override process.env,
 * process.stdin.isTTY, and stdin reading without spawning a subprocess.
 */
export interface DispatchIO {
  /** process.env equivalent — caller provides the env map */
  env: Record<string, string | undefined>;
  /** whether stdin is a terminal (true = do NOT read stdin, would block) */
  isTTY: boolean;
  /**
   * Read the first line from stdin (non-blocking, only called when isTTY=false).
   * Returns null if stdin is empty or read fails.
   */
  readStdin: () => Promise<string | null>;
}

/**
 * Build the default DispatchIO from the real process.
 * Reads the first stdin line via an async readline (non-blocking).
 */
function defaultDispatchIO(): DispatchIO {
  return {
    env: process.env as Record<string, string | undefined>,
    isTTY: !!process.stdin.isTTY,
    readStdin: () =>
      new Promise<string | null>((resolve) => {
        const chunks: Buffer[] = [];
        process.stdin.once("data", (chunk: Buffer) => {
          chunks.push(chunk);
          const line = (Buffer.concat(chunks).toString("utf8").split("\n")[0] ?? "").trim();
          resolve(line || null);
        });
        process.stdin.once("error", () => resolve(null));
        process.stdin.once("end", () => {
          const line = (Buffer.concat(chunks).toString("utf8").split("\n")[0] ?? "").trim();
          resolve(line || null);
        });
      }),
  };
}

/**
 * Dispatcher — routes argv to the correct handler.
 *
 * Extracted as a named export so it can be unit-tested without
 * triggering Commander's parse() or process.exit().
 *
 * Routing order (KAN-36):
 *   1. argv[2] === "login"              → login()
 *   2. argv[2] starts with kanon://     → throw deprecation error (argv link path removed)
 *   3. env KANON_ONBOARD_LINK set       → onboardFromLink(env value)
 *   4. stdin piped (!isTTY) and first
 *      line starts with kanon://        → onboardFromLink(stdin line)
 *   5. everything else                  → deps.cascade() (existing cascade resolver)
 */
export async function dispatch(
  argv: string[],
  _options: Record<string, unknown>,
  deps: { cascade: () => Promise<void> },
  io?: DispatchIO,
): Promise<void> {
  const { onboardFromLink } = await import("./onboard.js");
  const { login } = await import("./login.js");

  const resolvedIO = io ?? defaultDispatchIO();
  const positional = argv[2];

  // 1. login subcommand — unchanged
  if (positional === "login") {
    await login();
    return;
  }

  // 2. Deprecation: argv kanon:// path removed — emit clear error
  if (positional?.startsWith("kanon://")) {
    throw new Error(
      "Passing a kanon:// link as a command-line argument is deprecated and no longer supported. " +
        "Pipe the link via stdin or set the KANON_ONBOARD_LINK environment variable instead.",
    );
  }

  // 3. Env override — highest priority for non-argv link sources
  const envLink = resolvedIO.env["KANON_ONBOARD_LINK"];
  if (envLink?.startsWith("kanon://")) {
    await onboardFromLink(envLink, {});
    return;
  }

  // 4. Piped stdin — only read when stdin is NOT a TTY (would block otherwise)
  if (!resolvedIO.isTTY) {
    const stdinLine = await resolvedIO.readStdin();
    if (stdinLine?.startsWith("kanon://")) {
      await onboardFromLink(stdinLine, {});
      return;
    }
  }

  // 5. Fall through to cascade (interactive resolver)
  await deps.cascade();
}

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
  let wrapperReuse = false;

  if (!removeMode) {
    // ── 4a. Wrapper-reuse fast path ──────────────────────────────────
    // Before invoking the auth cascade, check whether this machine already has
    // valid wrapper-mode credentials (written by a previous kanon-setup run or
    // by install.sh).  In wrapper mode there is no static API key — the
    // credential store IS the durable auth artifact.  When found, skip auth
    // resolution entirely and write wrapper entries directly.
    const store = getCredentialStore();
    const reuse = await resolveWrapperReuse(store, {
      apiKey: options.apiKey,
      apiUrl: options.apiUrl,
    });

    if (reuse) {
      wrapperReuse = true;
      apiUrl = reuse.apiUrl;
      const chosenEmail = reuse.creds.email;
      console.log(
        chalk.cyan("[info]") +
          `  Reusing existing credentials for ${chalk.bold(apiUrl)} (${chosenEmail})`,
      );
    } else {
      // Normal auth cascade
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
  }

  // ── MCP Server Path ────────────────────────────────────────────────
  const nodeBin = resolveNodeBin();
  const mcpResolution = resolveMcpServerPath();

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
    // `template` is OPTIONAL on PlatformPaths — OpenCode is a product
    // surface only and does NOT write a personal harness file. When
    // absent, the install/remove template branch is skipped entirely.
    const templatePath = platformPaths.template?.(ctx);
    // `commands` is OPTIONAL — present on OpenCode. When present, setup
    // installs slash-command files from assets/commands/ into this directory.
    const commandDir = platformPaths.commands?.(ctx);

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

      // Remove template (only when the tool declares one — OpenCode doesn't)
      if (templatePath) {
        const removedTemplate = removeTemplate(templatePath, tool.templateMode);
        if (removedTemplate) {
          console.log(
            chalk.green("  ✓") +
              ` Removed template from ${chalk.bold(tool.displayName)}`,
          );
        }
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

      // Remove agents
      if (platformPaths.agents) {
        const agentDir = platformPaths.agents(ctx);
        const removedAgents = removeAgents(agentDir);
        if (removedAgents.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Removed ${removedAgents.length} agents from ${chalk.bold(tool.displayName)}`,
          );
        }
      }

      // Remove commands (OpenCode only — other tools have no commands dir)
      if (commandDir) {
        const removedCommands = removeCommands(commandDir);
        if (removedCommands.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Removed ${removedCommands.length} commands from ${chalk.bold(tool.displayName)}`,
          );
        }
      }

      successCount++;
    } else {
      // ── Install Mode ─────────────────────────────────────────────
      const entry = wrapperReuse
        ? buildWrapperMcpEntry(
            apiUrl,
            platformPaths.mcpMode,
            nodeBin,
            undefined,
            extractExistingWorkspaceId(configPath, tool.rootKey),
          )
        : buildMcpEntry(
            mcpResolution,
            apiUrl,
            apiKey,
            ctx,
            platformPaths.mcpMode,
            nodeBin,
          );

      // 1. MCP config
      // OpenCode is a product surface — do NOT write personal harness files
      // (AGENTS.md, opencode.jsonc, .atl/, kanon.md, …). The `mcp` rootKey
      // entry is the only thing written; `mergeConfig` reshapes it to the
      // OpenCode array form via `formatMcpEntry("mcp", entry)` — output is
      // `{ type: "local", command: string[]; environment?; enabled? }` per
      // OpenCode's `McpLocalConfig` schema.
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

      // 3. Template (only when the tool declares one — OpenCode is a
      //    product surface only and MUST NOT have a personal harness file
      //    written by setup).
      if (templatePath) {
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
      }

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

      // 5. Agents
      if (platformPaths.agents) {
        const agentDir = platformPaths.agents(ctx);
        const installedAgents = installAgents(agentDir, assetsDir);
        if (installedAgents.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Installed ${installedAgents.length} agents to ${chalk.cyan(agentDir)}`,
          );
        }
      }

      // 6. Commands (OpenCode only — other tools have no commands dir)
      if (commandDir) {
        const installedCommands = installCommands(commandDir, assetsDir);
        if (installedCommands.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Installed ${installedCommands.length} commands to ${chalk.cyan(commandDir)}`,
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
      const supported = toolRegistry.map((t) => t.name).join(", ");
      throw new Error(
        `Unknown tool: '${flags.tool}'. Supported: ${supported}`,
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
