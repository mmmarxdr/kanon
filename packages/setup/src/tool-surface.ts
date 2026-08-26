import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { installAgents } from "./agents.js";
import { installCommands } from "./commands.js";
import {
  extractExistingWorkspaceId,
  installToolMcpConfig,
  removeToolMcpConfig,
  validateToolMcpConfig,
} from "./mcp-config.js";
import {
  resolveToolLegacyConfigPaths,
  resolveToolLegacyRulePaths,
  resolveToolTargets,
  resolveToolInventoryTargets,
  resolveCodexHome,
} from "./registry.js";
import { installSkills, removeSkills } from "./skills.js";
import { installTemplate } from "./templates.js";
import type {
  McpServerEntry,
  PlatformContext,
  PlatformPaths,
  ToolDefinition,
} from "./types.js";
import { installWorkflows } from "./workflows.js";

export interface InstalledToolTarget {
  configPath: string;
  skillDir: string;
  installedSkills: string[];
  templatePath?: string;
  workflowDir?: string;
  installedWorkflows: string[];
  agentDir?: string;
  installedAgents: string[];
  commandDir?: string;
  installedCommands: string[];
}

export function getAssetsDir(): string {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../assets");
}

/** Install every product surface for one user-facing tool and all of its targets. */
export function installToolSurface(options: {
  tool: ToolDefinition;
  ctx: PlatformContext;
  assetsDir: string;
  /** Writable targets must come from the execution plan, never from inventory. */
  targets?: readonly PlatformPaths[];
  buildEntry: (target: PlatformPaths, configPath: string) => McpServerEntry;
}): InstalledToolTarget[] {
  const { tool, ctx, assetsDir, buildEntry } = options;
  // An execution plan may intentionally authorize no writable targets. That is
  // not permission to perform side-effectful legacy cleanup on another surface.
  const targets = options.targets ?? resolveToolTargets(tool, ctx);
  if (targets.length === 0) return [];

  for (const configPath of [
    ...targets.map((target) => target.config(ctx)),
    ...resolveToolLegacyConfigPaths(tool, ctx),
  ]) {
    validateToolMcpConfig(configPath, tool);
  }

  const installed = targets.map((target) => {
    const configPath = target.config(ctx);
    const skillDir = target.skills(ctx);
    const rawEntry = buildEntry(target, configPath);
    const entry = tool.mcpType
      ? { ...rawEntry, type: tool.mcpType }
      : rawEntry;

    installToolMcpConfig(configPath, tool, entry);
    const installedSkills = installSkills(skillDir, assetsDir);

    const templatePath = target.template?.(ctx);
    if (templatePath) {
      installTemplate(
        templatePath,
        tool.templateSource,
        assetsDir,
        tool.templateMode,
      );
    }

    const workflowDir = target.workflows?.(ctx);
    const installedWorkflows = workflowDir
      ? installWorkflows(workflowDir, assetsDir)
      : [];

    const agentDir = target.agents?.(ctx);
    const installedAgents = agentDir
      ? installAgents(agentDir, assetsDir, tool.name)
      : [];

    const commandDir = target.commands?.(ctx);
    const installedCommands = commandDir
      ? installCommands(commandDir, assetsDir)
      : [];

    return {
      configPath,
      skillDir,
      installedSkills,
      templatePath,
      workflowDir,
      installedWorkflows,
      agentDir,
      installedAgents,
      commandDir,
      installedCommands,
    };
  });

  cleanupLegacyToolSurface(tool, ctx, targets);
  return installed;
}

export function cleanupLegacyToolSurface(
  tool: ToolDefinition,
  ctx: PlatformContext,
  targets: readonly PlatformPaths[] = resolveToolTargets(tool, ctx),
): void {
  for (const configPath of resolveToolLegacyConfigPaths(tool, ctx)) {
    removeToolMcpConfig(configPath, tool);
  }
  for (const rulePath of resolveToolLegacyRulePaths(tool, ctx, targets)) {
    fs.rmSync(rulePath, { force: true });
  }
  if (tool.name === "codex") {
    const legacySkillDir = resolveCodexHome(ctx, "skills");
    const currentSkillDir = tool.platforms[ctx.platform]?.skills(ctx);
    if (legacySkillDir !== currentSkillDir) removeSkills(legacySkillDir);
  }
}

export function removeToolMcpSurface(
  tool: ToolDefinition,
  ctx: PlatformContext,
): string[] {
  const targets = tool.name === "cursor"
    ? resolveToolInventoryTargets(tool, ctx)
    : resolveToolTargets(tool, ctx);
  const configPaths = targets.map((target) => target.config(ctx));
  const legacyConfigPaths = resolveToolLegacyConfigPaths(tool, ctx);
  for (const configPath of [...configPaths, ...legacyConfigPaths]) {
    validateToolMcpConfig(configPath, tool);
  }
  const removed = configPaths.filter((configPath) => removeToolMcpConfig(configPath, tool));
  cleanupLegacyToolSurface(tool, ctx, targets);
  return removed;
}

export function resolveExistingToolWorkspaceId(
  tool: ToolDefinition,
  ctx: PlatformContext,
): string | undefined {
  const targets = tool.name === "cursor"
    ? resolveToolInventoryTargets(tool, ctx)
    : resolveToolTargets(tool, ctx);
  return targets.map((target) =>
      extractExistingWorkspaceId(
        target.config(ctx),
        tool.rootKey,
        tool.configFormat,
      ),
    )
    .find((workspaceId) => workspaceId !== undefined);
}
