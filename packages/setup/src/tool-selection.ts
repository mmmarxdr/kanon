import { checkbox } from "@inquirer/prompts";
import chalk from "chalk";
import { inspectToolMcpConfig, type ToolConfigState } from "./mcp-config.js";
import { getToolByName, resolveToolTargets, toolRegistry } from "./registry.js";
import type { PlatformContext, ToolDefinition } from "./types.js";

type ToolChoice = { name: string; value: string; checked: boolean };
export type SelectedTool = ToolDefinition & { selectionAuthorization?: "prompt" };

function getToolConfigState(tool: ToolDefinition, ctx: PlatformContext): ToolConfigState {
  const states = resolveToolTargets(tool, ctx).map((target) =>
    inspectToolMcpConfig(target.config(ctx), tool),
  );
  for (const state of ["invalid", "legacy", "configured"] as const) {
    if (states.includes(state)) return state;
  }
  return "unconfigured";
}

function buildToolChoice(tool: ToolDefinition, ctx: PlatformContext): ToolChoice {
  const state = getToolConfigState(tool, ctx);
  const suffix = state === "configured"
    ? " (already configured)"
    : state === "legacy"
      ? " (legacy config will be repaired)"
      : state === "invalid"
        ? " (invalid config)"
        : "";
  return {
    name: tool.displayName + suffix,
    value: tool.name,
    checked: state === "configured",
  };
}

/** Select tools by flag or from the detected-agent checklist. */
export async function selectTools(
  detected: ToolDefinition[],
  flags: { tool?: string; all?: boolean; yes?: boolean },
  isInteractive: boolean,
  ctx: PlatformContext,
  deps?: { promptTools?: (choices: ToolChoice[]) => Promise<string[]> },
): Promise<SelectedTool[]> {
  if (flags.tool) {
    const tool = getToolByName(flags.tool);
    if (!tool) {
      const supported = toolRegistry.map((candidate) => candidate.name).join(", ");
      throw new Error(`Unknown tool: '${flags.tool}'. Supported: ${supported}`);
    }
    if (!tool.platforms[ctx.platform]) {
      throw new Error(`${tool.displayName} is not supported on ${ctx.platform}`);
    }
    return [tool];
  }

  if (detected.length === 0) {
    throw new Error(
      "No supported tools detected. Install at least one supported AI coding tool.",
    );
  }

  if (flags.all || flags.yes || !isInteractive) return detected;

  const promptTools = deps?.promptTools ?? defaultPromptTools;
  console.log("");
  const selectedNames = await promptTools(
    detected.map((tool) => buildToolChoice(tool, ctx)),
  );

  if (selectedNames.length === 0) {
    console.log(chalk.yellow("No tools selected — nothing to do."));
    process.exit(0);
  }

  return detected.filter((tool) => selectedNames.includes(tool.name)).map((tool) =>
    tool.name === "cursor" ? { ...tool, selectionAuthorization: "prompt" } : tool,
  );
}

async function defaultPromptTools(choices: ToolChoice[]): Promise<string[]> {
  return checkbox({
    message: "Select tools to configure:",
    choices,
  });
}
