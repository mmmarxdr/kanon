#!/usr/bin/env node
// ─── Kanon Setup ───────────────────────────────────────────────────────────────

import { pathToFileURL } from "node:url";
import { Command } from "commander";
import chalk from "chalk";
import { buildPlatformContext } from "./detect.js";
import { resolveAuth } from "./auth.js";
import {
  detectTools,
  getToolByName,
  resolveToolInventoryTargets,
  resolveToolLegacyConfigPaths,
  resolveToolTargets,
  toolRegistry,
} from "./registry.js";
import { discoverCursorExecutionPlan, finalizeCursorSurfaceResults, planCursorSurfaceOutcomes } from "./cursor-plan.js";
import { collectCursorOwnershipByTarget } from "./cursor-inventory.js";
import { discoverCursorSurfaces } from "./cursor-surfaces.js";
import {
  buildMcpEntry,
  buildWrapperMcpEntry,
  inspectToolMcpConfig,
  removeToolMcpConfig,
  resolveMcpServerPath,
  resolveNodeBin,
  validateToolMcpConfig,
} from "./mcp-config.js";
import { removeSkills } from "./skills.js";
import { removeTemplate } from "./templates.js";
import { removeWorkflows } from "./workflows.js";
import { removeAgents } from "./agents.js";
import { removeCommands } from "./commands.js";
import type {
  AuthResult,
  PlatformContext,
  PlatformPaths,
  ToolDefinition,
} from "./types.js";
import { getCredentialStore } from "./credential-store/factory.js";
import { resolveWrapperReuse } from "./wrapper-reuse.js";
import {
  cleanupLegacyToolSurface,
  getAssetsDir,
  installToolSurface,
  resolveExistingToolWorkspaceId,
} from "./tool-surface.js";
import { SETUP_VERSION } from "./version.js";
import { selectTools } from "./tool-selection.js";

export { selectTools } from "./tool-selection.js";

interface RemovalInventoryEntry {
  readonly tool: ToolDefinition;
  readonly targets: readonly PlatformPaths[];
  readonly configPaths: readonly string[];
}

export function inventoryConfigPaths(
  tool: ToolDefinition,
  ctx: PlatformContext,
  targets: readonly PlatformPaths[] = resolveToolInventoryTargets(tool, ctx),
): string[] {
  return [...new Set([
    ...targets.map((target) => target.config(ctx)),
    ...resolveToolLegacyConfigPaths(tool, ctx),
  ])];
}

function snapshotRemovalInventory(
  ctx: PlatformContext,
): readonly RemovalInventoryEntry[] {
  return Object.freeze(toolRegistry
    .filter((tool) => tool.platforms[ctx.platform])
    .map((tool) => {
      const targets = Object.freeze([...resolveToolInventoryTargets(tool, ctx)]);
      return Object.freeze({
        tool,
        targets,
        configPaths: Object.freeze(inventoryConfigPaths(tool, ctx, targets)),
      });
    }));
}

/** Select removal candidates from owned paths only; tool detectors are forbidden. */
export function selectRemovalTools(
  options: { tool?: string; all?: boolean },
  ctx: PlatformContext,
  inventory: readonly RemovalInventoryEntry[] = snapshotRemovalInventory(ctx),
): ToolDefinition[] {
  if (options.tool) {
    const tool = getToolByName(options.tool);
    if (!tool) throw new Error(`Unknown tool: ${options.tool}`);
    const entry = inventory.find((candidate) => candidate.tool === tool);
    if (!entry || entry.targets.length === 0) {
      throw new Error(`${tool.displayName} is not supported on ${ctx.platform}`);
    }
    return [tool];
  }

  const candidates = inventory.filter((entry) => entry.targets.length > 0);
  if (options.all) return candidates.map((entry) => entry.tool);
  return candidates
    .filter((entry) => entry.configPaths.some((configPath) => {
      const state = inspectToolMcpConfig(configPath, entry.tool);
      return state === "configured" || state === "legacy";
    }))
    .map((entry) => entry.tool);
}

const program = new Command();

program
  .name("kanon-setup")
  .version(SETUP_VERSION)
  .description(
    "Configure Kanon AI tool integrations — MCP servers, skills, templates, and workflows",
  )
  .option("--api-url <url>", "Kanon API URL")
  .option("--api-key <key>", "Kanon API key")
  .option(
    "--tool <name>",
    "Target a specific tool (claude-code, cursor, antigravity, opencode, codex, antigravity-cli)",
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

/** Remove owned tool surfaces without executable, auth, or runtime discovery. */
async function runRemoval(
  options: { tool?: string; all?: boolean },
  ctx: PlatformContext,
): Promise<void> {
  const inventory = snapshotRemovalInventory(ctx);
  const selectedTools = new Set(selectRemovalTools(options, ctx, inventory));
  const selectedInventory = inventory.filter(({ tool }) => selectedTools.has(tool));
  if (selectedInventory.length === 0) {
    console.log(chalk.yellow("No Kanon configuration found in supported AI tool configs."));
    return;
  }

  // Preflight the complete operation before the first mutation.
  for (const { tool, configPaths } of selectedInventory) {
    for (const configPath of configPaths) validateToolMcpConfig(configPath, tool);
  }

  console.log("");
  console.log(chalk.bold("Removing Kanon configuration from selected tools..."));
  console.log("");

  let successCount = 0;
  let removalFailures = 0;
  for (const { tool, targets } of selectedInventory) {
    const failuresBeforeTool = removalFailures;
    for (const target of targets) {
      const configPath = target.config(ctx);
      try {
        const removed = removeToolMcpConfig(configPath, tool);
        console.log(removed
          ? chalk.green("  ✓") + ` Removed MCP config from ${chalk.bold(tool.displayName)} (${configPath})`
          : chalk.yellow("  ⚠") + ` MCP config not found for ${tool.displayName} at ${configPath}`);
      } catch (err) {
        removalFailures++;
        console.log(chalk.red("  ✗") + ` Failed to remove MCP config from ${tool.displayName} (${configPath}): ${err instanceof Error ? err.message : String(err)}`);
        continue;
      }

      try {
        const removedSkills = removeSkills(target.skills(ctx));
        if (removedSkills.length > 0) console.log(chalk.green("  ✓") + ` Removed ${removedSkills.length} skills from ${chalk.bold(tool.displayName)}`);
        const templatePath = target.template?.(ctx);
        if (templatePath && removeTemplate(templatePath, tool.templateMode)) console.log(chalk.green("  ✓") + ` Removed template from ${chalk.bold(tool.displayName)}`);
        const workflowDir = target.workflows?.(ctx);
        const removedWorkflows = workflowDir ? removeWorkflows(workflowDir) : [];
        if (removedWorkflows.length > 0) console.log(chalk.green("  ✓") + ` Removed ${removedWorkflows.length} workflows from ${chalk.bold(tool.displayName)}`);
        const agentDir = target.agents?.(ctx);
        const removedAgentFiles = agentDir ? removeAgents(agentDir, tool.name) : [];
        if (removedAgentFiles.length > 0) console.log(chalk.green("  ✓") + ` Removed ${removedAgentFiles.length} agents from ${chalk.bold(tool.displayName)}`);
        const commandDir = target.commands?.(ctx);
        const removedCommands = commandDir ? removeCommands(commandDir) : [];
        if (removedCommands.length > 0) console.log(chalk.green("  ✓") + ` Removed ${removedCommands.length} commands from ${chalk.bold(tool.displayName)}`);
      } catch (err) {
        removalFailures++;
        console.log(chalk.red("  ✗") + ` Failed to remove ${tool.displayName} assets (${configPath}): ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    try {
      cleanupLegacyToolSurface(tool, ctx, targets);
    } catch (err) {
      removalFailures++;
      console.log(chalk.red("  ✗") + ` Failed to remove legacy ${tool.displayName} surface: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (removalFailures === failuresBeforeTool) successCount++;
    console.log("");
  }

  if (removalFailures > 0) {
    console.log(chalk.red(`✗ Removal completed with ${removalFailures} failed surface mutation(s); ${successCount} tool(s) fully removed.`));
    throw new Error(`${removalFailures} removal surface mutation(s) failed`);
  }
  console.log(chalk.green(`✓ Removed Kanon configuration from ${successCount} tool(s).`));
}

export async function run(options: {
  apiUrl?: string;
  apiKey?: string;
  tool?: string;
  all?: boolean;
  remove?: boolean;
  yes?: boolean;
}): Promise<void> {
  const removeMode = options.remove === true;
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

  if (removeMode) {
    await runRemoval(options, ctx);
    return;
  }

  const assetsDir = getAssetsDir();

  // ── 2. Detect all tools ────────────────────────────────────────────
  const cursorSurfaces = removeMode ? undefined : discoverCursorSurfaces(ctx);
  const detectedTools = removeMode
    ? await detectTools(ctx)
    : await detectTools(ctx, { cursorSurfaces });

  // ── 3. Select tools (interactive or flag-based) ────────────────────
  const selectedTools = await selectTools(
    detectedTools,
    { tool: options.tool, all: options.all, yes: options.yes },
    isInteractive,
    ctx,
  );

  // An empty auto-detection is an intentional no-op. It must return before
  // credentials, Node, or Cursor planning can touch the host.
  if (selectedTools.length === 0) {
    console.log(chalk.yellow("No supported AI tools detected. Install Cursor, Claude Code, or Antigravity, then re-run kanon-setup."));
    if (!removeMode) {
      const mcpResolution = resolveMcpServerPath();
      console.log(`  To configure Kanon manually, use MCP server: ${mcpResolution.path}`);
    }
    return;
  }

  const cursorTool = !removeMode
    ? selectedTools.find((tool) => tool.name === "cursor")
    : undefined;
  const cursorPlan = cursorTool
    ? discoverCursorExecutionPlan({
        tool: cursorTool, ctx, operation: "configure", flags: { tool: options.tool, all: options.all },
        isInteractive, promptAccepted: cursorTool.selectionAuthorization === "prompt", surfaces: cursorSurfaces!,
      })
    : undefined;
  if (cursorPlan) {
    for (const diagnostic of cursorPlan.diagnostics) console.log(chalk.yellow(`  ⚠ ${diagnostic}`));
    if (cursorPlan.invalidSelection) throw new Error(cursorPlan.invalidSelection);
  }

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
    let targets = resolveToolTargets(tool, ctx);
    let cursorOutcomes: ReturnType<typeof planCursorSurfaceOutcomes> | undefined;

    // Configure-only Cursor writes must use the execution plan. Removal stays
    // on the legacy branch until its dedicated migration slice.
    if (!removeMode && tool.name === "cursor" && cursorPlan) {
      cursorOutcomes = planCursorSurfaceOutcomes({
        operation: "configure", ctx, flags: { tool: options.tool, all: options.all },
        promptAccepted: tool.selectionAuthorization === "prompt",
        surfaces: cursorPlan.surfaces ?? cursorSurfaces!,
        ownershipByTarget: collectCursorOwnershipByTarget(tool, ctx),
        validatedBridge: cursorPlan.bridge,
      });
      for (const diagnostic of cursorOutcomes.diagnostics) console.log(chalk.yellow(`  ⚠ ${diagnostic}`));
      targets = cursorPlan.targets.filter((target) => cursorOutcomes!.results.some((result) =>
        result.outcome === "ready" && result.paths.includes(target.config(ctx)),
      ));
    }
    if (targets.length === 0) {
      console.log(
        chalk.yellow("  ⚠") +
          ` ${tool.displayName} is not supported on ${ctx.platform} — skipping`,
      );
      console.log("");
      continue;
    }

    if (removeMode) {
      for (const target of targets) {
        const configPath = target.config(ctx);
        const removed = removeToolMcpConfig(configPath, tool);
        if (removed) {
          console.log(
            chalk.green("  ✓") +
              ` Removed MCP config from ${chalk.bold(tool.displayName)} (${configPath})`,
          );
        } else {
          console.log(
            chalk.yellow("  ⚠") +
              ` MCP config not found for ${tool.displayName} at ${configPath}`,
          );
        }

        const removedSkills = removeSkills(target.skills(ctx));
        if (removedSkills.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Removed ${removedSkills.length} skills from ${chalk.bold(tool.displayName)}`,
          );
        }

        const templatePath = target.template?.(ctx);
        if (templatePath && removeTemplate(templatePath, tool.templateMode)) {
          console.log(
            chalk.green("  ✓") +
              ` Removed template from ${chalk.bold(tool.displayName)}`,
          );
        }

        const workflowDir = target.workflows?.(ctx);
        const removedWfs = workflowDir ? removeWorkflows(workflowDir) : [];
        if (removedWfs.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Removed ${removedWfs.length} workflows from ${chalk.bold(tool.displayName)}`,
          );
        }

        const agentDir = target.agents?.(ctx);
        const removedAgentFiles = agentDir ? removeAgents(agentDir, tool.name) : [];
        if (removedAgentFiles.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Removed ${removedAgentFiles.length} agents from ${chalk.bold(tool.displayName)}`,
          );
        }

        const commandDir = target.commands?.(ctx);
        const removedCommands = commandDir ? removeCommands(commandDir) : [];
        if (removedCommands.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Removed ${removedCommands.length} commands from ${chalk.bold(tool.displayName)}`,
          );
        }
      }
      cleanupLegacyToolSurface(tool, ctx);
    } else {
      const cursorBridge = tool.name === "cursor" ? cursorPlan?.bridge : undefined;
      const existingWorkspaceId = wrapperReuse
        ? resolveExistingToolWorkspaceId(tool, ctx)
        : undefined;
      const installedTargets = installToolSurface({
        tool,
        ctx,
        assetsDir,
        targets,
        buildEntry: (target) => wrapperReuse
          ? buildWrapperMcpEntry(
              apiUrl,
              target.mcpMode,
              nodeBin,
              undefined,
              existingWorkspaceId,
              tool.clientIdentity,
              cursorBridge?.distribution,
              cursorBridge?.nodePath,
            )
          : buildMcpEntry(
              mcpResolution,
              apiUrl,
              apiKey,
              ctx,
              target.mcpMode,
              nodeBin,
              "static-key",
              tool.clientIdentity,
              undefined,
              cursorBridge?.distribution,
              cursorBridge?.nodePath,
            ),
      });

      if (cursorOutcomes) {
        const results = finalizeCursorSurfaceResults(
          cursorOutcomes.results,
          new Set(installedTargets.map((target) => target.configPath)),
          "configure",
        );
        for (const result of results) {
          console.log(`  ${result.outcome === "configured" ? "✓" : "⚠"} Cursor ${result.surface}: ${result.outcome} — ${result.message}`);
        }
      }

      for (const installed of installedTargets) {
        console.log(
          chalk.green("  ✓") +
            ` Configured MCP for ${chalk.bold(tool.displayName)} (${installed.configPath})`,
        );
        if (installed.installedSkills.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Installed ${installed.installedSkills.length} skills to ${chalk.cyan(installed.skillDir)}`,
          );
        }
        if (installed.templatePath) {
          console.log(
            chalk.green("  ✓") +
              ` Installed template for ${chalk.bold(tool.displayName)} (${installed.templatePath})`,
          );
        }
        if (installed.installedWorkflows.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Installed ${installed.installedWorkflows.length} workflows to ${chalk.cyan(installed.workflowDir!)}`,
          );
        }
        if (installed.installedAgents.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Installed ${installed.installedAgents.length} agents to ${chalk.cyan(installed.agentDir!)}`,
          );
        }
        if (installed.installedCommands.length > 0) {
          console.log(
            chalk.green("  ✓") +
              ` Installed ${installed.installedCommands.length} commands to ${chalk.cyan(installed.commandDir!)}`,
          );
        }
      }
    }

    successCount++;
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  program.parse();
}
